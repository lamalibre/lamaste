/**
 * Registry credential brokering for agents.
 *
 * Lamaste agents install plugins with `npm install` from the Lamalibre npm
 * registry (Feria). A networked Feria accepts nothing anonymously, and an
 * agent must never hold a long-lived registry token. Instead the panel holds
 * one service credential for the registry — `<stateDir>/registry-credential.json`
 * (0600) — and brokers a short-lived, read-only token per agent install:
 * the agent asks `GET /api/agents/me/registry-credential` over mTLS, the
 * panel asks Feria's broker for a one-hour token owned by `agent:<label>`,
 * and the agent writes it to a throw-away npm userconfig for that one
 * `npm install`.
 *
 * The same credential lets the panel revoke a person's registry tokens when
 * their `feria-*` group membership is removed (see `lostFeriaGroups`).
 *
 * The registry contract this module speaks is Feria's
 * (`feria/docs/design/networked-registry-and-login.md`): a `feria_…` bearer
 * token, `GET /-/whoami`, `POST /-/feria/broker/agent-token` and
 * `DELETE /-/feria/tokens?owner=…`.
 */

import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { atomicWriteJSON } from '../file-helpers.js';

export const REGISTRY_CREDENTIAL_FILENAME = 'registry-credential.json';

/** Authelia groups that grant access to the registry are named `feria-*`. */
export const FERIA_GROUP_PREFIX = 'feria-';

/** Lifetime of a brokered agent token — Feria caps it at one hour anyway. */
export const AGENT_REGISTRY_TOKEN_LIFETIME = '1h';

export const RegistryCredentialConfigSchema = z.object({
  provider: z.literal('feria'),
  /** Registry base URL, e.g. `https://feria.samplepark.tr/`. */
  registryUrl: z.string().url(),
  /** The panel's service token on the registry. Needs the `admin` scope to broker. */
  token: z
    .string()
    .min(20)
    .max(512)
    .regex(/^feria_[A-Za-z0-9_-]+$/, 'token must be a Feria registry token'),
  /** npm scope the registry serves. */
  scope: z
    .string()
    .regex(/^@[a-z0-9][a-z0-9-]*$/)
    .default('@lamalibre'),
  /** Owner string the registry reported for the token when it was configured. */
  owner: z.string().min(1).optional(),
  configuredAt: z.string().datetime(),
});

export type RegistryCredentialConfig = z.infer<typeof RegistryCredentialConfigSchema>;

/** Everything an admin may see about the configured credential — never the token. */
export interface RegistryCredentialSummary {
  provider: 'feria';
  registryUrl: string;
  scope: string;
  owner: string | null;
  configuredAt: string;
}

/** What an agent receives for one install. */
export interface AgentRegistryCredential {
  registryUrl: string;
  scope: string;
  token: string;
  /** ISO timestamp. */
  expiresAt: string;
  /** The registry's id for the token — safe to log. */
  tokenId: string;
}

export class RegistryCredentialError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = 'RegistryCredentialError';
    this.statusCode = statusCode;
  }
}

type FetchLike = typeof fetch;

// ---------------------------------------------------------------------------
// Config file
// ---------------------------------------------------------------------------

export function registryCredentialPath(stateDir: string): string {
  return path.join(stateDir, REGISTRY_CREDENTIAL_FILENAME);
}

/** Read the stored credential, or `null` when none is configured. */
export async function readRegistryCredentialConfig(
  stateDir: string,
): Promise<RegistryCredentialConfig | null> {
  let raw: string;
  try {
    raw = await readFile(registryCredentialPath(stateDir), 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const parsed = RegistryCredentialConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new RegistryCredentialError(
      `${registryCredentialPath(stateDir)} is invalid — ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      500,
    );
  }
  return parsed.data;
}

/** Store the credential atomically at mode 0600. */
export async function writeRegistryCredentialConfig(
  stateDir: string,
  config: RegistryCredentialConfig,
): Promise<void> {
  const validated = RegistryCredentialConfigSchema.parse(config);
  await atomicWriteJSON(registryCredentialPath(stateDir), validated, { mode: 0o600 });
}

/** Remove the credential. Returns `true` when a file was removed. */
export async function clearRegistryCredentialConfig(stateDir: string): Promise<boolean> {
  const file = registryCredentialPath(stateDir);
  try {
    await readFile(file);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
  await rm(file, { force: true });
  return true;
}

export function summariseRegistryCredential(
  config: RegistryCredentialConfig,
): RegistryCredentialSummary {
  return {
    provider: config.provider,
    registryUrl: config.registryUrl,
    scope: config.scope,
    owner: config.owner ?? null,
    configuredAt: config.configuredAt,
  };
}

// ---------------------------------------------------------------------------
// Registry calls
// ---------------------------------------------------------------------------

function registryBase(registryUrl: string): URL {
  return new URL(registryUrl.endsWith('/') ? registryUrl : `${registryUrl}/`);
}

async function registryRequest(
  registryUrl: string,
  token: string,
  method: 'GET' | 'POST' | 'DELETE',
  relativePath: string,
  body: unknown,
  fetchImpl: FetchLike,
): Promise<unknown> {
  const url = new URL(relativePath, registryBase(registryUrl));
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err: unknown) {
    throw new RegistryCredentialError(
      `registry ${url.origin} is unreachable: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!response.ok) {
    const detail =
      json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string'
        ? (json as { error: string }).error
        : `HTTP ${response.status}`;
    // The registry's 401/403 mean *our* credential is bad, which is a
    // server-side configuration problem, not the caller's.
    throw new RegistryCredentialError(
      `registry ${relativePath}: ${detail}`,
      response.status === 401 || response.status === 403 ? 502 : response.status,
    );
  }
  return json;
}

const WhoamiSchema = z
  .object({
    owner: z.string().min(1),
    scopes: z.array(z.enum(['read', 'publish', 'admin'])),
  })
  .passthrough();

/**
 * Check a credential against the registry before storing it: it must be
 * valid and carry the `admin` scope (the broker route requires it).
 */
export async function verifyRegistryCredential(
  input: { registryUrl: string; token: string },
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<{ owner: string; scopes: string[] }> {
  const who = WhoamiSchema.parse(
    await registryRequest(input.registryUrl, input.token, 'GET', '-/whoami', undefined, fetchImpl),
  );
  if (!who.scopes.includes('admin')) {
    throw new RegistryCredentialError(
      `the token identifies ${who.owner} with scopes [${who.scopes.join(', ')}] — brokering agent tokens needs the admin scope`,
      400,
    );
  }
  return { owner: who.owner, scopes: who.scopes };
}

const IssuedTokenSchema = z
  .object({
    id: z.string().min(1),
    token: z.string().min(1),
    expiresAt: z.string().datetime(),
    owner: z.string().min(1),
  })
  .passthrough();

/** Ask the registry for a one-hour read token owned by `agent:<label>`. */
export async function brokerAgentRegistryToken(
  config: RegistryCredentialConfig,
  agentLabel: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<AgentRegistryCredential> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(agentLabel)) {
    throw new RegistryCredentialError(
      `agent label "${agentLabel}" cannot hold a registry token`,
      400,
    );
  }
  const issued = IssuedTokenSchema.parse(
    await registryRequest(
      config.registryUrl,
      config.token,
      'POST',
      '-/feria/broker/agent-token',
      { agentLabel, expiresIn: AGENT_REGISTRY_TOKEN_LIFETIME },
      fetchImpl,
    ),
  );
  return {
    registryUrl: registryBase(config.registryUrl).href,
    scope: config.scope,
    token: issued.token,
    expiresAt: issued.expiresAt,
    tokenId: issued.id,
  };
}

const RevokedSchema = z.object({ revoked: z.array(z.object({ id: z.string() }).passthrough()) });

/** Revoke every registry token owned by `owner` (e.g. `user:alice`). Returns how many. */
export async function revokeRegistryTokensForOwner(
  config: RegistryCredentialConfig,
  owner: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<number> {
  const qs = new URLSearchParams({ owner }).toString();
  const result = RevokedSchema.parse(
    await registryRequest(
      config.registryUrl,
      config.token,
      'DELETE',
      `-/feria/tokens?${qs}`,
      undefined,
      fetchImpl,
    ),
  );
  return result.revoked.length;
}

// ---------------------------------------------------------------------------
// Group changes
// ---------------------------------------------------------------------------

/**
 * `feria-*` groups a user had before and no longer has. Scopes are granted
 * at login, so losing a group must revoke the user's existing tokens.
 */
export function lostFeriaGroups(before: readonly string[], after: readonly string[]): string[] {
  const kept = new Set(after);
  return before.filter((g) => g.startsWith(FERIA_GROUP_PREFIX) && !kept.has(g));
}
