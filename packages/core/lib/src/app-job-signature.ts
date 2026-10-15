/**
 * Relay-signed app jobs — how the agent's root helper `lamaste-apphost`
 * knows that an `app-install`, `app-activate` or `app-remove` it is asked
 * to run is one the relay issued, not one the agent's user made up.
 *
 * The helper runs as root on the agent's behalf (one sudoers rule), so
 * whatever the agent's user can hand it — a service spec naming system
 * packages, a version to activate, a purge — it would otherwise do as
 * root. Approval of what an agent half brings happens on the relay; the
 * relay therefore signs every app job when it creates it, and the helper
 * refuses anything the relay did not sign. The agent carries the signature
 * from `agent-config` to the helper and can neither make nor change one.
 *
 * The signed bytes are the canonical JSON (keys sorted at every level, no
 * whitespace) of the envelope
 *
 *     { v: 1, typ: "lamaste.apphost.job", kid, agent, route, jobId, kind,
 *       payload, issuedAt, expiresAt }
 *
 * where `agent` is the label the relay knows the agent by, `kind` the job's
 * kind and `payload` what the helper does: `{ spec }` (the pinned agent
 * half, version and integrity included) for `app-install`,
 * `{ version, package }` for `app-activate`, `{ purge, package }` for
 * `app-remove` — the package lets the helper refuse to switch or purge an
 * agent half another package owns. `issuedAt` and `expiresAt` are ISO 8601
 * (`toISOString`); `expiresAt` is the job's deadline. The relay signs with
 * its Ed25519 relay key (`relay-assertion.ts`), and the signature travels
 * as `{ envelope: base64url(canonical JSON), sig: base64url(signature) }`.
 *
 * **Domain separation.** A relay assertion signs the base64url text of its
 * payload; an app job signs JSON bytes, which start with `{` — a character
 * base64url never contains — so neither ever verifies as the other, and
 * each carries its own type (`typ` here, the assertion's fields there).
 *
 * The helper verifies with the key `sudo lamaste-agent apphost enable`
 * pinned for the agent (`APPHOST_PATHS.relayPinFile`) and implements this
 * format again with Node.js built-ins only (it trusts no code the agent's
 * user can change); the agent CLI's tests check that the two agree.
 */

import crypto from 'node:crypto';

import { z } from 'zod';

import {
  APPHOST_ROUTE_RE,
  AgentHalfPackageNameSchema,
  AgentHalfSpecSchema,
  AgentHalfVersionSchema,
} from './agent-half.js';
import type { AgentHalfSpec } from './agent-half.js';
import { AGENT_LABEL_REGEX } from './constants.js';
import type { RelaySigningKey } from './relay-assertion.js';

/** What sets an app job's envelope apart from anything else the relay key signs. */
export const APP_JOB_SIGNATURE_TYPE = 'lamaste.apphost.job';

export const APP_JOB_SIGNATURE_VERSION = 1;

/** The jobs the app host helper runs only when the relay signed them. */
export const APP_JOB_KINDS = ['app-install', 'app-activate', 'app-remove'] as const;
export type AppJobKind = (typeof APP_JOB_KINDS)[number];

/**
 * The longest an envelope may be valid. The relay signs a job for its
 * deadline (its timeout plus delivery slack, minutes); this bounds what a
 * signature can be worth and how long the helper remembers a job id.
 */
export const APP_JOB_SIGNATURE_MAX_LIFETIME_MS = 60 * 60_000;

/** Clock difference tolerated between the relay and the agent for `issuedAt`. */
export const APP_JOB_SIGNATURE_CLOCK_SKEW_MS = 5_000;

/** Longest `envelope` (base64url characters) — an agent half spec is a few KiB. */
export const APP_JOB_ENVELOPE_MAX_CHARS = 32 * 1024;

const KID_RE = /^[a-f0-9]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
/** An Ed25519 signature: 64 bytes, 86 base64url characters without padding. */
const SIG_RE = /^[A-Za-z0-9_-]{86}$/;

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/** `app-install`: the agent half the relay pinned, version and tarball integrity included. */
export interface AppInstallPayload {
  readonly spec: AgentHalfSpec;
}

/** `app-activate`: the kept version to point `current` at, and the package it must be. */
export interface AppActivatePayload {
  readonly version: string;
  readonly package: string;
}

/** `app-remove`: whether its data and account go too, and the package it must be. */
export interface AppRemovePayload {
  readonly purge: boolean;
  readonly package: string;
}

export interface AppJobPayloads {
  readonly 'app-install': AppInstallPayload;
  readonly 'app-activate': AppActivatePayload;
  readonly 'app-remove': AppRemovePayload;
}

const PAYLOAD_SCHEMAS = {
  'app-install': z.object({ spec: AgentHalfSpecSchema }).strict(),
  'app-activate': z
    .object({ version: AgentHalfVersionSchema, package: AgentHalfPackageNameSchema })
    .strict(),
  'app-remove': z.object({ purge: z.boolean(), package: AgentHalfPackageNameSchema }).strict(),
} as const;

export function isAppJobKind(value: unknown): value is AppJobKind {
  return typeof value === 'string' && (APP_JOB_KINDS as readonly string[]).includes(value);
}

/** The payload of an app job of `kind`, validated (unknown fields refused); throws when it is not one. */
export function appJobPayload<K extends AppJobKind>(kind: K, params: unknown): AppJobPayloads[K] {
  const parsed = PAYLOAD_SCHEMAS[kind].safeParse(params);
  if (!parsed.success) {
    throw new TypeError(
      `Not an ${kind} payload (${parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')})`,
    );
  }
  return parsed.data as AppJobPayloads[K];
}

// ---------------------------------------------------------------------------
// The envelope and its canonical form
// ---------------------------------------------------------------------------

interface AppJobEnvelopeBase {
  readonly v: typeof APP_JOB_SIGNATURE_VERSION;
  readonly typ: typeof APP_JOB_SIGNATURE_TYPE;
  /** Id of the relay key that signed it (`relayKeyId`). */
  readonly kid: string;
  /** The label the relay knows the agent by. */
  readonly agent: string;
  readonly route: string;
  readonly jobId: string;
  /** ISO 8601, as `toISOString` writes it. */
  readonly issuedAt: string;
  /** The job's deadline, ISO 8601. */
  readonly expiresAt: string;
}

/** What the relay signs for one app job. */
export type AppJobEnvelope = {
  [K in AppJobKind]: AppJobEnvelopeBase & { readonly kind: K; readonly payload: AppJobPayloads[K] };
}[AppJobKind];

/** How a signed app job travels: the signed bytes and the signature, both base64url. */
export interface AppJobSignature {
  readonly envelope: string;
  readonly sig: string;
}

/**
 * Canonical JSON: keys sorted at every level, no whitespace. Only what JSON
 * carries is accepted — strings, finite numbers, booleans, null, arrays and
 * plain objects — so the text is the value, with nothing dropped.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON has no non-finite numbers');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    // fromEntries defines each key as data — a "__proto__" key stays a key.
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue((value as Record<string, unknown>)[key])]),
    );
  }
  throw new TypeError(`Canonical JSON cannot hold a ${typeof value}`);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ISO_RE.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

function hasExactly(object: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(object);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(object, k));
}

const ENVELOPE_KEYS = [
  'v',
  'typ',
  'kid',
  'agent',
  'route',
  'jobId',
  'kind',
  'payload',
  'issuedAt',
  'expiresAt',
] as const;

/**
 * Validate a decoded envelope, strictly: every field, no other, a payload
 * of its kind, and a validity of at most {@link APP_JOB_SIGNATURE_MAX_LIFETIME_MS}.
 * Null when it is not one.
 */
export function parseAppJobEnvelope(raw: unknown): AppJobEnvelope | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  if (!hasExactly(e, ENVELOPE_KEYS)) return null;
  const { v, typ, kid, agent, route, jobId, kind, payload, issuedAt, expiresAt } = e;
  if (
    v !== APP_JOB_SIGNATURE_VERSION ||
    typ !== APP_JOB_SIGNATURE_TYPE ||
    typeof kid !== 'string' ||
    !KID_RE.test(kid) ||
    typeof agent !== 'string' ||
    !AGENT_LABEL_REGEX.test(agent) ||
    typeof route !== 'string' ||
    !APPHOST_ROUTE_RE.test(route) ||
    typeof jobId !== 'string' ||
    !UUID_RE.test(jobId) ||
    !isAppJobKind(kind) ||
    !isTimestamp(issuedAt) ||
    !isTimestamp(expiresAt)
  ) {
    return null;
  }
  const lifetime = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (lifetime <= 0 || lifetime > APP_JOB_SIGNATURE_MAX_LIFETIME_MS) return null;
  const parsed = PAYLOAD_SCHEMAS[kind].safeParse(payload);
  if (!parsed.success) return null;
  return {
    v: APP_JOB_SIGNATURE_VERSION,
    typ: APP_JOB_SIGNATURE_TYPE,
    kid,
    agent,
    route,
    jobId,
    kind,
    payload: parsed.data,
    issuedAt,
    expiresAt,
  } as AppJobEnvelope;
}

/** What the relay signs, before the key and the constant fields are added. */
export type AppJobSigningInput = {
  [K in AppJobKind]: Omit<AppJobEnvelopeBase, 'v' | 'typ' | 'kid'> & {
    readonly kind: K;
    readonly payload: AppJobPayloads[K];
  };
}[AppJobKind];

/**
 * Sign an app job with the relay's key. Throws when the input would not
 * make a valid envelope (the helper would refuse it anyway).
 */
export function signAppJob(input: AppJobSigningInput, key: RelaySigningKey): AppJobSignature {
  const envelope = parseAppJobEnvelope({
    v: APP_JOB_SIGNATURE_VERSION,
    typ: APP_JOB_SIGNATURE_TYPE,
    kid: key.kid,
    agent: input.agent,
    route: input.route,
    jobId: input.jobId,
    kind: input.kind,
    payload: input.payload,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  });
  if (!envelope) throw new TypeError(`Not a valid ${input.kind} job to sign`);
  const bytes = Buffer.from(canonicalJson(envelope), 'utf-8');
  const encoded = bytes.toString('base64url');
  if (encoded.length > APP_JOB_ENVELOPE_MAX_CHARS) {
    throw new TypeError('The app job envelope is too large');
  }
  const sig = crypto.sign(null, bytes, key.privateKey);
  return { envelope: encoded, sig: sig.toString('base64url') };
}

/** A signature decoded, not verified: the envelope, the bytes it was made from, the signature. */
export interface DecodedAppJobSignature {
  readonly envelope: AppJobEnvelope;
  readonly bytes: Buffer;
  readonly sig: Buffer;
}

function isBase64Url(value: string): boolean {
  return (
    BASE64URL_RE.test(value) && Buffer.from(value, 'base64url').toString('base64url') === value
  );
}

/**
 * Decode a signature as it travels — exactly `{ envelope, sig }`, both
 * canonical base64url, the envelope canonical JSON and a valid envelope —
 * WITHOUT verifying it. Null when it is not one. The agent uses this to
 * check that a job and its signature agree; only verification
 * ({@link verifyAppJobSignature}) makes it trustworthy.
 */
export function decodeAppJobSignature(signature: unknown): DecodedAppJobSignature | null {
  if (signature === null || typeof signature !== 'object' || Array.isArray(signature)) {
    return null;
  }
  const s = signature as Record<string, unknown>;
  if (!hasExactly(s, ['envelope', 'sig'])) return null;
  const { envelope, sig } = s;
  if (
    typeof envelope !== 'string' ||
    envelope.length === 0 ||
    envelope.length > APP_JOB_ENVELOPE_MAX_CHARS ||
    !isBase64Url(envelope) ||
    typeof sig !== 'string' ||
    !SIG_RE.test(sig) ||
    !isBase64Url(sig)
  ) {
    return null;
  }
  const bytes = Buffer.from(envelope, 'base64url');
  const text = bytes.toString('utf-8');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = parseAppJobEnvelope(raw);
  // Canonical bytes only: what was signed is exactly what is read.
  if (!parsed || canonicalJson(raw) !== text) return null;
  return { envelope: parsed, bytes, sig: Buffer.from(sig, 'base64url') };
}

export type AppJobSignatureRejection =
  | 'malformed'
  | 'unknown_key'
  | 'bad_signature'
  | 'future'
  | 'expired';

export type VerifyAppJobSignatureResult =
  | { readonly ok: true; readonly envelope: AppJobEnvelope }
  | { readonly ok: false; readonly reason: AppJobSignatureRejection };

export interface VerifyAppJobSignatureOptions {
  /** The pinned verification key and its id. */
  readonly key: { readonly kid: string; readonly publicKey: crypto.KeyObject };
  readonly now?: number | undefined;
}

/**
 * Verify a signed app job: its shape, that the pinned key made it, and
 * that it is current (`issuedAt` not ahead by more than
 * {@link APP_JOB_SIGNATURE_CLOCK_SKEW_MS}, `expiresAt` not passed). What it
 * is for — agent, route, kind, payload, and that its id was not used
 * before — is the caller's to check.
 */
export function verifyAppJobSignature(
  signature: unknown,
  opts: VerifyAppJobSignatureOptions,
): VerifyAppJobSignatureResult {
  const decoded = decodeAppJobSignature(signature);
  if (!decoded) return { ok: false, reason: 'malformed' };
  if (decoded.envelope.kid !== opts.key.kid) return { ok: false, reason: 'unknown_key' };
  let valid = false;
  try {
    valid = crypto.verify(null, decoded.bytes, opts.key.publicKey, decoded.sig);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };
  const now = opts.now ?? Date.now();
  if (Date.parse(decoded.envelope.issuedAt) > now + APP_JOB_SIGNATURE_CLOCK_SKEW_MS) {
    return { ok: false, reason: 'future' };
  }
  if (Date.parse(decoded.envelope.expiresAt) <= now) return { ok: false, reason: 'expired' };
  return { ok: true, envelope: decoded.envelope };
}

/** The job an envelope must describe: what the agent was handed beside it. */
export interface AppJobExpectation {
  readonly jobId: string;
  readonly route: string;
  readonly kind: AppJobKind;
  readonly payload: unknown;
  readonly expiresAt: string;
}

/**
 * Whether `envelope` describes exactly the job `expected` — its id, route,
 * kind, deadline and payload (compared canonically).
 */
export function appJobEnvelopeMatches(
  envelope: AppJobEnvelope,
  expected: AppJobExpectation,
): boolean {
  if (
    envelope.jobId !== expected.jobId ||
    envelope.route !== expected.route ||
    envelope.kind !== expected.kind ||
    envelope.expiresAt !== expected.expiresAt
  ) {
    return false;
  }
  try {
    return canonicalJson(envelope.payload) === canonicalJson(expected.payload);
  } catch {
    return false;
  }
}
