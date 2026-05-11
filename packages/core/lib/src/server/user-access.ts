/**
 * User plugin-access grants + OTP tokens.
 *
 * Maintains `<dataDir>/user-plugin-access.json` with two collections:
 *   - `grants`: admin-issued grants mapping Authelia users to plugins
 *   - `otpTokens`: one-time tokens used by the OAuth-like authorize/exchange
 *                  flow that brings a user session into the desktop app
 *
 * Pure core: all paths come from the caller. The daemon wires a `dataDir`
 * resolved from env/config.
 */

import crypto from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PromiseChainMutex, atomicWriteJSON } from '../file-helpers.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OTP_EXPIRY_MS = 60 * 1000;
const OTP_CLEANUP_MS = 5 * 60 * 1000;
const MAX_ACTIVE_OTPS = 50;
const MAX_ACTIVE_GRANTS = 200;
const GRANT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserAccessLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
}

export interface UserAccessGrant {
  grantId: string;
  username: string;
  pluginName: string;
  target: string;
  used: boolean;
  createdAt: string;
  usedAt: string | null;
}

/**
 * One-time password entry. The plaintext `token` is NEVER stored on disk —
 * the persistence map is keyed by `sha256(token)` (base64url, treated as a
 * non-secret index). Lookups recompute the index, so the persisted form is
 * useless to an attacker who reads the file: the only way back to a usable
 * session is to present the original token AND the matching PKCE verifier.
 *
 * `challenge` is the PKCE code challenge (S256) submitted at /authorize. The
 * desktop later submits the matching `verifier` to /exchange, which the panel
 * hashes and compares (timing-safe) against `challenge`. This binds the OTP
 * to the desktop process that initiated the flow — a malicious local app
 * intercepting the deep link cannot exchange without the verifier.
 *
 * `nonce` round-trips through the deep link so the desktop can correlate the
 * callback with its own pending login state.
 */
export interface OtpToken {
  username: string;
  challenge: string;
  nonce: string;
  createdAt: string;
  expiresAt: string;
  used: boolean;
  usedAt?: string;
}

export interface UserAccessState {
  grants: UserAccessGrant[];
  /**
   * OTP store, keyed by `sha256(token)` base64url-encoded. The token itself
   * is intentionally absent from the entry value so a disk read cannot leak
   * usable credentials. O(1) lookup, no linear timing-safe scan.
   */
  otpTokens: Record<string, OtpToken>;
}

/** PKCE S256 verifier shape. Base64url, 32–64 chars (256–384 bits of entropy). */
const VERIFIER_REGEX = /^[A-Za-z0-9_-]{32,64}$/;
/** PKCE S256 challenge: base64url-encoded SHA-256 (43 chars, no padding). */
const CHALLENGE_REGEX = /^[A-Za-z0-9_-]{43}$/;
/** Nonce: 16 random bytes, hex-encoded → 32 chars. */
const NONCE_REGEX = /^[a-f0-9]{32}$/;

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sha256Base64Url(input: string): string {
  return base64url(crypto.createHash('sha256').update(input, 'utf-8').digest());
}

/** Stable index key for the OTP token. Not secret — derived from the token. */
function otpIndex(token: string): string {
  return sha256Base64Url(token);
}

export interface CreateGrantOptions {
  readonly target?: string;
}

export class UserAccessError extends Error {
  readonly statusCode: number;
  readonly code: 'NOT_FOUND' | 'INVALID' | 'CONSUMED' | 'CAP_EXCEEDED';
  constructor(message: string, code: UserAccessError['code'], statusCode: number) {
    super(message);
    this.name = 'UserAccessError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Per-dataDir mutex + compare key
// ---------------------------------------------------------------------------

const mutexByDir = new Map<string, PromiseChainMutex>();

function getMutex(dataDir: string): PromiseChainMutex {
  let m = mutexByDir.get(dataDir);
  if (!m) {
    m = new PromiseChainMutex();
    mutexByDir.set(dataDir, m);
  }
  return m;
}

/**
 * Constant-time compare for two equal-length base64url strings (the PKCE
 * challenge and the recomputed-verifier hash). Both sides are produced by
 * `sha256Base64Url` and therefore always 43 chars — no length-leak window.
 * Returns false on any mismatch, including length differences.
 */
function constantTimeStringEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
}

// ---------------------------------------------------------------------------
// State I/O
// ---------------------------------------------------------------------------

function statePath(dataDir: string): string {
  return path.join(dataDir, 'user-plugin-access.json');
}

async function loadState(dataDir: string): Promise<UserAccessState> {
  try {
    const raw = await readFile(statePath(dataDir), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<UserAccessState> & {
      otpTokens?: unknown;
    };
    // PKCE refactor: previous on-disk shape was `OtpToken[]` (with plaintext
    // token in each entry). That format is incompatible with the new map
    // (no challenge, no nonce, plaintext-token-as-credential). Any pre-PKCE
    // state file is dropped — pending logins from before an upgrade simply
    // expire (≤60 s window). Grants are unaffected.
    let otpTokens: Record<string, OtpToken> = {};
    if (
      parsed.otpTokens &&
      typeof parsed.otpTokens === 'object' &&
      !Array.isArray(parsed.otpTokens)
    ) {
      otpTokens = parsed.otpTokens as Record<string, OtpToken>;
    }
    return {
      grants: Array.isArray(parsed.grants) ? parsed.grants : [],
      otpTokens,
    };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { grants: [], otpTokens: {} };
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read user-plugin-access state: ${message}`);
  }
}

async function saveState(dataDir: string, state: UserAccessState): Promise<void> {
  await mkdir(path.dirname(statePath(dataDir)), { recursive: true });
  await atomicWriteJSON(statePath(dataDir), state, { mode: 0o600 });
}

function cleanExpiredOTPs(tokens: Record<string, OtpToken>): Record<string, OtpToken> {
  const cutoff = Date.now() - OTP_CLEANUP_MS;
  const fresh: Record<string, OtpToken> = {};
  for (const [key, entry] of Object.entries(tokens)) {
    if (new Date(entry.createdAt).getTime() > cutoff) {
      fresh[key] = entry;
    }
  }
  return fresh;
}

function countActiveOTPs(tokens: Record<string, OtpToken>): number {
  let n = 0;
  for (const entry of Object.values(tokens)) {
    if (!entry.used) n++;
  }
  return n;
}

function cleanOldGrants(grants: UserAccessGrant[]): UserAccessGrant[] {
  const cutoff = Date.now() - GRANT_RETENTION_MS;
  return grants.filter((g) => !g.used || new Date(g.usedAt || g.createdAt).getTime() > cutoff);
}

// ---------------------------------------------------------------------------
// Grant CRUD
// ---------------------------------------------------------------------------

export interface CreatedGrant {
  readonly grantId: string;
  readonly username: string;
  readonly pluginName: string;
  readonly target: string;
  readonly used: boolean;
  readonly createdAt: string;
  readonly usedAt: string | null;
}

/**
 * Create a user-plugin access grant.
 *
 * Local grants (`target = 'local'`) start as `used: false` — they are consumed
 * when the user enrolls a desktop session. Agent-side grants (`target` starts
 * with `'agent:'`) are auto-consumed on creation because they grant browser
 * access, not an enrollment ceremony.
 */
export function createGrant(
  dataDir: string,
  username: string,
  pluginName: string,
  logger: UserAccessLogger,
  options: CreateGrantOptions = {},
): Promise<CreatedGrant> {
  const target = options.target ?? 'local';
  return getMutex(dataDir).run(async () => {
    const state = await loadState(dataDir);

    state.grants = cleanOldGrants(state.grants);

    if (state.grants.length >= MAX_ACTIVE_GRANTS) {
      throw new UserAccessError('Too many active grants', 'CAP_EXCEEDED', 503);
    }

    const grantId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const isAgentTarget = target.startsWith('agent:');

    const grant: UserAccessGrant = {
      grantId,
      username,
      pluginName,
      target,
      used: isAgentTarget,
      createdAt,
      usedAt: isAgentTarget ? createdAt : null,
    };

    state.grants.push(grant);
    await saveState(dataDir, state);
    logger.info({ grantId, username, pluginName, target }, 'Created user plugin access grant');

    return {
      grantId,
      username,
      pluginName,
      target,
      used: grant.used,
      createdAt,
      usedAt: grant.usedAt,
    };
  });
}

/** List all grants. */
export function listGrants(dataDir: string): Promise<UserAccessGrant[]> {
  return getMutex(dataDir).run(async () => {
    const state = await loadState(dataDir);
    return state.grants;
  });
}

/** List grants for a specific user. */
export function listGrantsForUser(dataDir: string, username: string): Promise<UserAccessGrant[]> {
  return getMutex(dataDir).run(async () => {
    const state = await loadState(dataDir);
    return state.grants.filter((g) => g.username === username);
  });
}

/**
 * Revoke a grant. Local grants can only be revoked if unused; agent-side
 * grants can always be revoked (they are auto-consumed on creation).
 */
export function revokeGrant(
  dataDir: string,
  grantId: string,
  logger: UserAccessLogger,
): Promise<{ ok: true; grant: UserAccessGrant }> {
  return getMutex(dataDir).run(async () => {
    const state = await loadState(dataDir);
    const idx = state.grants.findIndex((g) => g.grantId === grantId);

    if (idx === -1) {
      throw new UserAccessError('Grant not found', 'NOT_FOUND', 404);
    }

    const grant = state.grants[idx]!;
    const isAgentTarget = (grant.target || 'local').startsWith('agent:');

    if (grant.used && !isAgentTarget) {
      throw new UserAccessError('Cannot revoke a consumed grant', 'CONSUMED', 409);
    }

    state.grants.splice(idx, 1);
    await saveState(dataDir, state);
    logger.info({ grantId, target: grant.target }, 'Revoked user plugin access grant');

    return { ok: true, grant };
  });
}

/**
 * Remove all grants belonging to a username. Used by the user delete cascade
 * so deleted Authelia users do not leave dangling grants.
 *
 * Returns the number of grants removed.
 */
export function removeGrantsForUser(
  dataDir: string,
  username: string,
  logger: UserAccessLogger,
): Promise<number> {
  return getMutex(dataDir).run(async () => {
    const state = await loadState(dataDir);
    const before = state.grants.length;
    state.grants = state.grants.filter((g) => g.username !== username);
    const removed = before - state.grants.length;
    if (removed > 0) {
      await saveState(dataDir, state);
      logger.info(
        { username, removed },
        'Cascade-removed user-plugin-access grants for deleted user',
      );
    }
    return removed;
  });
}

/**
 * Consume a grant (mark as used). Returns the grant data.
 */
export function consumeGrant(
  dataDir: string,
  grantId: string,
  username: string,
  logger: UserAccessLogger,
): Promise<{ grantId: string; username: string; pluginName: string }> {
  return getMutex(dataDir).run(async () => {
    const state = await loadState(dataDir);
    const grant = state.grants.find((g) => g.grantId === grantId);

    if (!grant) {
      throw new UserAccessError('Invalid grant', 'INVALID', 401);
    }

    if (grant.username !== username) {
      throw new UserAccessError('Invalid grant', 'INVALID', 401);
    }

    if (grant.used) {
      throw new UserAccessError('Invalid grant', 'INVALID', 401);
    }

    grant.used = true;
    grant.usedAt = new Date().toISOString();

    await saveState(dataDir, state);
    logger.info(
      { grantId, username, pluginName: grant.pluginName },
      'Consumed user plugin access grant',
    );

    return {
      grantId: grant.grantId,
      username: grant.username,
      pluginName: grant.pluginName,
    };
  });
}

// ---------------------------------------------------------------------------
// OTP tokens
// ---------------------------------------------------------------------------

export interface CreateOtpInput {
  /** PKCE S256 challenge (base64url SHA-256 of the verifier — 43 chars). */
  readonly challenge: string;
  /** 16-byte random nonce, hex-encoded (32 chars). Round-trips to the desktop. */
  readonly nonce: string;
}

/**
 * Create a one-time password bound to a PKCE challenge.
 *
 * The desktop generates a random 32-byte verifier, derives the S256
 * `challenge`, and hands it to /authorize. Authelia validates identity, then
 * the panel mints an OTP and stores `{username, challenge, nonce}` keyed by
 * `sha256(token)`. The deep link delivers the OTP + nonce back to the
 * desktop, which calls /exchange with `{token, verifier}`. The panel hashes
 * the verifier and constant-time-compares against the stored challenge.
 */
export function createOTP(
  dataDir: string,
  username: string,
  input: CreateOtpInput,
  logger: UserAccessLogger,
): Promise<{ token: string; nonce: string; expiresAt: string }> {
  if (!CHALLENGE_REGEX.test(input.challenge)) {
    throw new UserAccessError('Invalid PKCE challenge', 'INVALID', 400);
  }
  if (!NONCE_REGEX.test(input.nonce)) {
    throw new UserAccessError('Invalid nonce', 'INVALID', 400);
  }
  return getMutex(dataDir).run(async () => {
    const state = await loadState(dataDir);

    state.otpTokens = cleanExpiredOTPs(state.otpTokens);

    if (countActiveOTPs(state.otpTokens) >= MAX_ACTIVE_OTPS) {
      throw new UserAccessError('Too many pending login attempts', 'CAP_EXCEEDED', 503);
    }

    const token = crypto.randomBytes(32).toString('hex');
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS).toISOString();
    const key = otpIndex(token);

    state.otpTokens[key] = {
      username,
      challenge: input.challenge,
      nonce: input.nonce,
      createdAt,
      expiresAt,
      used: false,
    };

    await saveState(dataDir, state);
    logger.info({ username }, 'Created user access OTP');

    return { token, nonce: input.nonce, expiresAt };
  });
}

/**
 * Validate and consume a one-time password.
 *
 * Lookup is O(1) via the sha256 index — no linear scan, no per-process random
 * compare key needed (the index is derived deterministically from the token).
 * The PKCE verifier is hashed and constant-time-compared against the stored
 * challenge: a missing or wrong verifier returns the same generic error as
 * an unknown token, so an attacker who only has the OTP cannot distinguish
 * "verifier wrong" from "token wrong".
 *
 * Single-use: the entry is marked `used` inside the mutex. A concurrent second
 * call observing the same token sees `used = true` and rejects.
 */
export function validateAndConsumeOTP(
  dataDir: string,
  token: string,
  verifier: string,
): Promise<{ username: string }> {
  return getMutex(dataDir).run(async () => {
    const state = await loadState(dataDir);

    state.otpTokens = cleanExpiredOTPs(state.otpTokens);

    // Generic-failure helper: every rejection path uses the same message and
    // status so timing-/text-distinguishability between failure modes is
    // limited to the work each path does (lookup is constant-time by design).
    const fail = (): never => {
      throw new UserAccessError('Invalid or expired token', 'INVALID', 401);
    };

    if (typeof token !== 'string' || token.length !== 64 || !/^[a-f0-9]{64}$/.test(token)) {
      fail();
    }
    if (typeof verifier !== 'string' || !VERIFIER_REGEX.test(verifier)) {
      fail();
    }

    const key = otpIndex(token);
    const entry = state.otpTokens[key];

    if (!entry) fail();

    // Re-narrow after `fail` (which always throws) to satisfy strict null checks.
    const otp = entry as OtpToken;

    if (otp.used) fail();
    if (new Date(otp.expiresAt).getTime() < Date.now()) fail();

    const verifierHash = sha256Base64Url(verifier);
    if (!constantTimeStringEqual(verifierHash, otp.challenge)) fail();

    otp.used = true;
    otp.usedAt = new Date().toISOString();

    await saveState(dataDir, state);

    return { username: otp.username };
  });
}
