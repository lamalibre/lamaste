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
 * The panel authenticates to Feria in one of two ways (`auth.kind`):
 *
 * - `token` — a long-lived Feria token an admin pasted in.
 * - `oidc` — the panel's own service principal: a confidential OIDC client
 *   `lamaste-server` on the relay's Authelia (client-credentials grant,
 *   scope `lamaste.registry`, audience = the registry). At broker time the
 *   panel obtains a JWT access token from Authelia, posts it to Feria's
 *   `/-/feria/login` for a short-lived registry token, and caches that
 *   token per process until five minutes before it expires. Nothing
 *   long-lived is stored on the panel but the client secret, which Lamaste
 *   generated itself (`oidc-clients.json`).
 *
 * The same credential lets the panel revoke a person's registry tokens when
 * their `feria-*` group membership is removed (see `lostFeriaGroups`).
 *
 * The registry contract this module speaks is Feria's
 * (`feria/docs/design/networked-registry-and-login.md`): a `feria_…` bearer
 * token, `GET /-/whoami`, `POST /-/feria/login`,
 * `POST /-/feria/broker/agent-token` and `DELETE /-/feria/tokens?owner=…`.
 */

import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { atomicWriteJSON } from '../file-helpers.js';
import type { AutheliaOidcClient, OidcScopeDefinitions } from './authelia.js';

export const REGISTRY_CREDENTIAL_FILENAME = 'registry-credential.json';

/** Authelia groups that grant access to the registry are named `feria-*`. */
export const FERIA_GROUP_PREFIX = 'feria-';

/** Lifetime of a brokered agent token — Feria caps it at one hour anyway. */
export const AGENT_REGISTRY_TOKEN_LIFETIME = '1h';

/** The panel's own confidential OIDC client on the relay's Authelia. */
export const LAMASTE_SERVER_OIDC_CLIENT_ID = 'lamaste-server';

/** The one custom scope that client requests; defined under `identity_providers.oidc.scopes`. */
export const LAMASTE_REGISTRY_OIDC_SCOPE = 'lamaste.registry';

export const LAMASTE_REGISTRY_OIDC_SCOPES: OidcScopeDefinitions = {
  [LAMASTE_REGISTRY_OIDC_SCOPE]: { claims: [] },
};

/**
 * Authelia's token endpoint, reached directly (it binds 127.0.0.1:9091).
 * The issuer Authelia writes into the token comes from the forwarded
 * headers, so the JWT says `https://auth.<domain>` as if it had come
 * through nginx — see {@link requestClientCredentialsToken}.
 */
export const AUTHELIA_LOCAL_TOKEN_ENDPOINT = 'http://127.0.0.1:9091/api/oidc/token';

const FeriaTokenSchema = z
  .string()
  .min(20)
  .max(512)
  .regex(/^feria_[A-Za-z0-9_-]+$/, 'token must be a Feria registry token');

export const RegistryAuthSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('token'),
    /** The panel's service token on the registry. Needs the `admin` scope to broker. */
    token: FeriaTokenSchema,
  }),
  z.object({
    kind: z.literal('oidc'),
    clientId: z.literal(LAMASTE_SERVER_OIDC_CLIENT_ID),
  }),
]);

export type RegistryAuth = z.infer<typeof RegistryAuthSchema>;

export const RegistryCredentialConfigSchema = z.object({
  provider: z.literal('feria'),
  /** Registry base URL, e.g. `https://feria.samplepark.tr/`. */
  registryUrl: z.string().url(),
  /** npm scope the registry serves. */
  scope: z
    .string()
    .regex(/^@[a-z0-9][a-z0-9-]*$/)
    .default('@lamalibre'),
  auth: RegistryAuthSchema,
  /** Owner string the registry reported for the credential when it was configured. */
  owner: z.string().min(1).optional(),
  configuredAt: z.string().datetime(),
});

export type RegistryCredentialConfig = z.infer<typeof RegistryCredentialConfigSchema>;

/** The shape the first release wrote: the token at the top level. */
const LegacyRegistryCredentialConfigSchema = z.object({
  provider: z.literal('feria'),
  registryUrl: z.string().url(),
  token: FeriaTokenSchema,
  scope: z
    .string()
    .regex(/^@[a-z0-9][a-z0-9-]*$/)
    .default('@lamalibre'),
  owner: z.string().min(1).optional(),
  configuredAt: z.string().datetime(),
});

/** Everything an admin may see about the configured credential — never a token. */
export interface RegistryCredentialSummary {
  provider: 'feria';
  registryUrl: string;
  scope: string;
  auth: 'token' | 'oidc';
  /** `oidc` only: the Authelia client id. */
  clientId: string | null;
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

/**
 * Parse an on-disk credential in either its current shape or the first
 * release's (`token` at the top level, now `auth: { kind: 'token', token }`).
 * Pure; throws a `RegistryCredentialError` (500) for anything else.
 */
export function migrateRegistryCredentialConfig(raw: unknown): RegistryCredentialConfig {
  const current = RegistryCredentialConfigSchema.safeParse(raw);
  if (current.success) return current.data;
  const legacy = LegacyRegistryCredentialConfigSchema.safeParse(raw);
  if (legacy.success) {
    const { token, ...rest } = legacy.data;
    return { ...rest, auth: { kind: 'token', token } };
  }
  throw new RegistryCredentialError(
    `registry credential is invalid — ${current.error.issues.map((i) => i.message).join('; ')}`,
    500,
  );
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
  try {
    return migrateRegistryCredentialConfig(JSON.parse(raw));
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new RegistryCredentialError(`${registryCredentialPath(stateDir)}: ${detail}`, 500);
  }
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
    auth: config.auth.kind,
    clientId: config.auth.kind === 'oidc' ? config.auth.clientId : null,
    owner: config.owner ?? null,
    configuredAt: config.configuredAt,
  };
}

// ---------------------------------------------------------------------------
// The panel's own OIDC client
// ---------------------------------------------------------------------------

function registryBase(registryUrl: string): URL {
  return new URL(registryUrl.endsWith('/') ? registryUrl : `${registryUrl}/`);
}

/**
 * The audience the panel requests from Authelia and Feria must accept: the
 * registry URL without a trailing slash (`https://feria.example.com`), so
 * it equals Feria's own `audience` for a registry served at its origin.
 */
export function registryAudience(registryUrl: string): string {
  return registryBase(registryUrl).href.replace(/\/$/, '');
}

/** Authelia issuer of the relay: `https://auth.<domain>`. */
export function autheliaIssuer(domain: string): string {
  return `https://auth.${domain}`;
}

/**
 * The confidential client Lamaste registers for itself when the registry
 * credential uses `auth.kind: 'oidc'`. Lives next to the plugin clients in
 * Authelia's configuration; its secret in `oidc-clients.json`.
 */
export function lamasteServerOidcClient(registryUrl: string): AutheliaOidcClient {
  return {
    id: LAMASTE_SERVER_OIDC_CLIENT_ID,
    name: 'Lamaste panel (registry broker)',
    plugin: 'lamaste',
    grantTypes: ['client_credentials'],
    scopes: [LAMASTE_REGISTRY_OIDC_SCOPE],
    audience: [registryAudience(registryUrl)],
    redirectUris: [],
    accessTokenSignedResponseAlg: 'RS256',
    accessTokenClaims: [],
    // No end user: Authelia requires one_factor on a client-credentials client.
    authorizationPolicy: 'one_factor',
    requirePkce: false,
    confidential: true,
  };
}

// ---------------------------------------------------------------------------
// Registry calls
// ---------------------------------------------------------------------------

async function registryRequest(
  registryUrl: string,
  token: string | null,
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
        ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
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

const IssuedTokenSchema = z
  .object({
    id: z.string().min(1),
    token: z.string().min(1),
    expiresAt: z.string().datetime(),
    owner: z.string().min(1),
    scopes: z.array(z.string()).optional(),
  })
  .passthrough();

/** A registry token with when it stops working. */
export interface RegistryServiceToken {
  token: string;
  /** Unix milliseconds; `Number.POSITIVE_INFINITY` for a pasted long-lived token. */
  expiresAt: number;
  owner: string | null;
}

/** What `auth.kind: 'oidc'` needs from the daemon to reach Authelia. */
export interface OidcBrokerDeps {
  /** Relay domain: the issuer is `https://auth.<domain>`. */
  domain: string;
  /** Plaintext secret of the `lamaste-server` client (from `oidc-clients.json`). */
  clientSecret: string;
  /** Default {@link AUTHELIA_LOCAL_TOKEN_ENDPOINT}. */
  tokenEndpoint?: string;
}

export interface RegistryServiceTokenDeps {
  fetchImpl?: FetchLike;
  /** Required when the configured credential is `auth.kind: 'oidc'`. */
  oidc?: OidcBrokerDeps;
  now?: () => number;
}

export interface ClientCredentialsRequest {
  tokenEndpoint: string;
  /** `https://auth.<domain>` — sent as forwarded headers so the JWT's `iss` says so. */
  issuer: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  audience: string;
}

const TokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string(),
    expires_in: z.number().int().positive().optional(),
  })
  .passthrough();

/**
 * OAuth 2.0 client-credentials grant against Authelia, authenticated with
 * `client_secret_basic`. Authelia derives the issuer from
 * `X-Forwarded-Proto` and `X-Forwarded-Host` (falling back to `Host`), so
 * calling it on 127.0.0.1:9091 with those headers yields a token whose
 * `iss` is `https://auth.<domain>` — the same a client coming through nginx
 * would get, and the issuer Feria is configured to trust.
 */
export async function requestClientCredentialsToken(
  request: ClientCredentialsRequest,
  fetchImpl: FetchLike = globalThis.fetch,
  now: () => number = Date.now,
): Promise<{ accessToken: string; expiresAt: number }> {
  const issuer = new URL(request.issuer);
  const basic = Buffer.from(
    `${encodeURIComponent(request.clientId)}:${encodeURIComponent(request.clientSecret)}`,
  ).toString('base64');
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: request.scope,
    audience: request.audience,
  });
  let response: Response;
  try {
    response = await fetchImpl(request.tokenEndpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-proto': issuer.protocol.replace(/:$/, ''),
        'x-forwarded-host': issuer.host,
      },
      body: form.toString(),
    });
  } catch (err: unknown) {
    throw new RegistryCredentialError(
      `Authelia token endpoint ${request.tokenEndpoint} is unreachable: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const body = (json ?? {}) as { error?: unknown; error_description?: unknown };
    const detail = [body.error, body.error_description]
      .filter((v): v is string => typeof v === 'string')
      .join(': ');
    throw new RegistryCredentialError(
      `Authelia refused the client-credentials request for client "${request.clientId}" (HTTP ${response.status}${detail ? `, ${detail}` : ''}) — ` +
        'the panel registers this client in Authelia when the registry credential is set to oidc; ' +
        'check that Authelia is running and that its configuration carries the client',
      502,
    );
  }
  const parsed = TokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new RegistryCredentialError('Authelia returned a malformed token response', 502);
  }
  const lifetimeMs = (parsed.data.expires_in ?? 3600) * 1000;
  return { accessToken: parsed.data.access_token, expiresAt: now() + lifetimeMs };
}

/** `POST /-/feria/login` with a JWT from a trusted issuer → a Feria token. */
export async function loginToRegistry(
  registryUrl: string,
  assertion: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<RegistryServiceToken & { scopes: string[]; tokenId: string }> {
  let issued: z.infer<typeof IssuedTokenSchema>;
  try {
    issued = IssuedTokenSchema.parse(
      await registryRequest(
        registryUrl,
        null,
        'POST',
        '-/feria/login',
        { assertion, label: LAMASTE_SERVER_OIDC_CLIENT_ID },
        fetchImpl,
      ),
    );
  } catch (err: unknown) {
    if (err instanceof RegistryCredentialError) {
      throw new RegistryCredentialError(
        `${err.message}${feriaRulesHint(registryUrl)}`,
        err.statusCode,
      );
    }
    throw err;
  }
  return {
    token: issued.token,
    expiresAt: Date.parse(issued.expiresAt),
    owner: issued.owner,
    scopes: issued.scopes ?? [],
    tokenId: issued.id,
  };
}

/** Appended to every failure of the OIDC login: what the operator must configure on Feria. */
function feriaRulesHint(registryUrl: string): string {
  return (
    ' — Feria (0.3.2 or later) accepts the panel only through a "workloads" rule on the relay Authelia\'s ' +
    `"groups" issuer in its auth.json (issuer https://auth.<domain>, audience ${registryAudience(registryUrl)}) ` +
    `that grants the admin scope when the claim client_id — or sub, which carries the same value — is "${LAMASTE_SERVER_OIDC_CLIENT_ID}"`
  );
}

/**
 * A usable registry token for the configured credential: the pasted token
 * itself, or — for `auth.kind: 'oidc'` — a fresh JWT from Authelia exchanged
 * at Feria's login. Never cached here; see {@link RegistryServiceTokenCache}.
 */
export async function obtainRegistryServiceToken(
  config: RegistryCredentialConfig,
  deps: RegistryServiceTokenDeps = {},
): Promise<RegistryServiceToken> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  if (config.auth.kind === 'token') {
    return { token: config.auth.token, expiresAt: Number.POSITIVE_INFINITY, owner: null };
  }
  if (!deps.oidc) {
    throw new RegistryCredentialError(
      `the registry credential uses the ${LAMASTE_SERVER_OIDC_CLIENT_ID} OIDC client but its secret is not available`,
      500,
    );
  }
  const { accessToken } = await requestClientCredentialsToken(
    {
      tokenEndpoint: deps.oidc.tokenEndpoint ?? AUTHELIA_LOCAL_TOKEN_ENDPOINT,
      issuer: autheliaIssuer(deps.oidc.domain),
      clientId: config.auth.clientId,
      clientSecret: deps.oidc.clientSecret,
      scope: LAMASTE_REGISTRY_OIDC_SCOPE,
      audience: registryAudience(config.registryUrl),
    },
    fetchImpl,
    deps.now ?? Date.now,
  );
  const login = await loginToRegistry(config.registryUrl, accessToken, fetchImpl);
  return { token: login.token, expiresAt: login.expiresAt, owner: login.owner };
}

/** How long before a token's expiry it is considered spent. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Per-process cache of the panel's registry service token. A pasted token
 * is returned as is; an OIDC-obtained one is reused until five minutes
 * before it expires, then obtained again. The cache is keyed by the
 * credential it was obtained for, so a reconfiguration never serves a token
 * from the previous registry.
 */
export class RegistryServiceTokenCache {
  #entry: { key: string; token: RegistryServiceToken } | null = null;
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  static keyFor(config: RegistryCredentialConfig): string {
    return JSON.stringify([config.registryUrl, config.auth]);
  }

  async resolve(
    config: RegistryCredentialConfig,
    deps: RegistryServiceTokenDeps = {},
  ): Promise<RegistryServiceToken> {
    const key = RegistryServiceTokenCache.keyFor(config);
    const cached = this.#entry;
    if (
      cached &&
      cached.key === key &&
      cached.token.expiresAt - this.#now() > TOKEN_REFRESH_MARGIN_MS
    ) {
      return cached.token;
    }
    const token = await obtainRegistryServiceToken(config, { ...deps, now: deps.now ?? this.#now });
    this.#entry = { key, token };
    return token;
  }

  /** Forget the cached token (the credential was changed or removed). */
  invalidate(): void {
    this.#entry = null;
  }
}

/**
 * Check a credential against the registry before storing it: the whole
 * chain must work (for `oidc`: Authelia token endpoint → Feria login) and
 * the resulting identity must carry the `admin` scope, which the broker
 * route requires.
 */
export async function verifyRegistryCredential(
  config: Pick<RegistryCredentialConfig, 'registryUrl' | 'auth'>,
  deps: RegistryServiceTokenDeps = {},
): Promise<{ owner: string; scopes: string[] }> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const service = await obtainRegistryServiceToken(
    { provider: 'feria', scope: '@lamalibre', configuredAt: new Date(0).toISOString(), ...config },
    deps,
  );
  const who = WhoamiSchema.parse(
    await registryRequest(
      config.registryUrl,
      service.token,
      'GET',
      '-/whoami',
      undefined,
      fetchImpl,
    ),
  );
  if (!who.scopes.includes('admin')) {
    throw new RegistryCredentialError(
      `the credential identifies ${who.owner} with scopes [${who.scopes.join(', ')}] — brokering agent tokens needs the admin scope` +
        (config.auth.kind === 'oidc' ? feriaRulesHint(config.registryUrl) : ''),
      400,
    );
  }
  return { owner: who.owner, scopes: who.scopes };
}

export interface RegistryCallDeps {
  fetchImpl?: FetchLike;
  /** The panel's registry token (see {@link RegistryServiceTokenCache}). */
  serviceToken: string;
}

/** Ask the registry for a one-hour read token owned by `agent:<label>`. */
export async function brokerAgentRegistryToken(
  config: RegistryCredentialConfig,
  agentLabel: string,
  deps: RegistryCallDeps,
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
      deps.serviceToken,
      'POST',
      '-/feria/broker/agent-token',
      { agentLabel, expiresIn: AGENT_REGISTRY_TOKEN_LIFETIME },
      deps.fetchImpl ?? globalThis.fetch,
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
  deps: RegistryCallDeps,
): Promise<number> {
  const qs = new URLSearchParams({ owner }).toString();
  const result = RevokedSchema.parse(
    await registryRequest(
      config.registryUrl,
      deps.serviceToken,
      'DELETE',
      `-/feria/tokens?${qs}`,
      undefined,
      deps.fetchImpl ?? globalThis.fetch,
    ),
  );
  return result.revoked.length;
}

// ---------------------------------------------------------------------------
// Per-agent issuance: cache and rate limit
// ---------------------------------------------------------------------------

export interface AgentTokenBrokerOptions {
  /** New tokens an agent may be issued per window. Default 10. */
  maxPerWindow?: number;
  /** Default one hour. */
  windowMs?: number;
  /** A cached token is reused while it has at least this long left. Default 5 minutes. */
  refreshMarginMs?: number;
  now?: () => number;
}

export type AgentTokenAcquisition =
  | { ok: true; credential: AgentRegistryCredential; cached: boolean }
  | { ok: false; retryAfterSeconds: number };

/**
 * One brokered token per agent, reused for every install until five
 * minutes before it expires, and at most `maxPerWindow` new tokens per
 * agent per hour. Pure in-memory state; the registry's own limits remain
 * the backstop. Failed broker attempts count too, so a broken registry is
 * not hammered on every install.
 */
export class AgentTokenBroker {
  readonly #maxPerWindow: number;
  readonly #windowMs: number;
  readonly #refreshMarginMs: number;
  readonly #now: () => number;
  readonly #cache = new Map<string, AgentRegistryCredential>();
  readonly #issued = new Map<string, number[]>();

  constructor(options: AgentTokenBrokerOptions = {}) {
    this.#maxPerWindow = options.maxPerWindow ?? 10;
    this.#windowMs = options.windowMs ?? 60 * 60 * 1000;
    this.#refreshMarginMs = options.refreshMarginMs ?? TOKEN_REFRESH_MARGIN_MS;
    this.#now = options.now ?? Date.now;
  }

  /** The cached token for `label` if it is still good for an install. */
  cached(label: string): AgentRegistryCredential | null {
    const credential = this.#cache.get(label);
    if (!credential) return null;
    if (Date.parse(credential.expiresAt) - this.#now() <= this.#refreshMarginMs) {
      this.#cache.delete(label);
      return null;
    }
    return credential;
  }

  /** Issuances of `label` inside the current window, oldest first. */
  #recent(label: string): number[] {
    const since = this.#now() - this.#windowMs;
    const kept = (this.#issued.get(label) ?? []).filter((t) => t > since);
    if (kept.length > 0) this.#issued.set(label, kept);
    else this.#issued.delete(label);
    return kept;
  }

  /**
   * Return the cached token, or — within the limit — broker a new one with
   * `broker` and cache it. Over the limit, says when to retry.
   */
  async acquire(
    label: string,
    broker: () => Promise<AgentRegistryCredential>,
  ): Promise<AgentTokenAcquisition> {
    const cached = this.cached(label);
    if (cached) return { ok: true, credential: cached, cached: true };

    const recent = this.#recent(label);
    if (recent.length >= this.#maxPerWindow) {
      const oldest = recent[0] ?? this.#now();
      const retryAfterMs = Math.max(oldest + this.#windowMs - this.#now(), 1000);
      return { ok: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
    }
    recent.push(this.#now());
    this.#issued.set(label, recent);

    const credential = await broker();
    this.#cache.set(label, credential);
    return { ok: true, credential, cached: false };
  }

  /** Drop every cached token and issuance record (the credential was reconfigured). */
  reset(): void {
    this.#cache.clear();
    this.#issued.clear();
  }
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
