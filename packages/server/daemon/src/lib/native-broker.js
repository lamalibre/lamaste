/**
 * The token broker — the domain's token and revocation endpoints in front
 * of Authelia (native-apps-design.md D4, review R1, R5, R7–R9, R16).
 *
 * nginx sends `auth.<domain>/api/oidc/token` and `/api/oidc/revocation`
 * here (`routes/native-oauth.js`). A request is **native** when its body
 * `client_id` or its HTTP Basic username names a native client
 * (`lamaste-native-*`), or when the token it carries hashes to a refresh
 * token the broker recorded — whatever the client fields say (R1: Authelia
 * accepts a public client authenticated by `Basic base64("<id>:")` with no
 * `client_id` in the body). Any other request is passed to Authelia byte for
 * byte and its answer returned as it came — but only a form: a request
 * whose body is anything but `application/x-www-form-urlencoded` (RFC 6749
 * §3.2), or that is content-encoded, is refused for every client before it
 * is classified (security review H1 — Authelia also reads a multipart body,
 * which the broker would not see into, so a native client's refresh could
 * pass it unseen).
 *
 * A native request is answered by the broker's rules: the client must be a
 * served native client of the portal's own domain (R5); it is public, so
 * any `Authorization` header is refused; a code exchange makes a grant
 * (standing checked, the refresh token revoked at Authelia when it fails);
 * a refresh is forwarded only for the grant's current token, within its
 * lifetimes and standing, and committed by compare-and-swap (R7); a spent
 * token within 30 seconds of its rotation gets the same answer again (R8),
 * after that it is a reuse that ends the grant; Authelia's 5xx while it is
 * up end the grant on the third (R9). Rate limits apply to native requests
 * only (R16).
 *
 * Nothing about a token is stored but its SHA-256; nothing about a request
 * is logged but metadata.
 */

import http from 'node:http';

import {
  NATIVE_REFRESH_GRACE_MS,
  isLamasteUsername,
  isNativeClientId,
  nativeAudience,
  nativeDeviceName,
  nativeUserAgentSummary,
  openGraceAnswer,
  sealGraceAnswer,
} from '@lamalibre/lamaste';

import { recordAuditBestEffort } from './audit.js';
import { activeDomainNames } from './domains.js';
import { findResolvedNativeClient } from './native-apps.js';
import {
  commitNativeRotation,
  countIssuerFailure,
  createNativeGrant,
  findRefreshToken,
  grantExpiry,
  nativeSignIns,
  nativeStanding,
  revokeNativeGrants,
  standingContext,
  tokenSha256,
  withGrantLock,
} from './native-grants.js';
import { notifyAdminsBestEffort } from './notifications.js';

/** The longest body the broker reads (nginx says the same). */
export const NATIVE_BROKER_BODY_LIMIT = 16 * 1024;

/** How long Authelia has to answer a forwarded request. */
const AUTHELIA_TIMEOUT_MS = 10_000;

/** How long Authelia has to answer the liveness check. */
const AUTHELIA_LIVENESS_TIMEOUT_MS = 3_000;

/** Consecutive 5xx from a live Authelia that end a grant (R9). */
const ISSUER_FAILURE_LIMIT = 3;

/** Native requests per client address per minute, and per refresh token per minute (R16). */
const NATIVE_RATE_PER_ADDRESS = 120;
const NATIVE_RATE_PER_TOKEN = 30;
const RATE_WINDOW_MS = 60_000;

/** The broker's endpoints, and where Authelia serves them. */
export const NATIVE_BROKER_ENDPOINTS = Object.freeze({
  token: '/api/oidc/token',
  revocation: '/api/oidc/revocation',
});

/** Request headers a pass-through carries to Authelia. */
const PASSED_REQUEST_HEADERS = ['content-type', 'accept', 'authorization', 'user-agent'];

/** Response headers never copied back (hop by hop, or the broker's own framing). */
const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'upgrade',
  'proxy-connection',
  'trailer',
  'te',
]);

// ---------------------------------------------------------------------------
// Authelia on loopback
// ---------------------------------------------------------------------------

/**
 * One request to Authelia on 127.0.0.1:9091: `{ status, headers, body }`
 * (the body a Buffer), or throws on a network failure or a timeout.
 *
 * @param {{ method: string, path: string, headers: Record<string, string>, body?: Buffer, timeoutMs?: number }} req
 * @returns {Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders, body: Buffer }>}
 */
function realAutheliaRequest({ method, path, headers, body, timeoutMs = AUTHELIA_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: 9091,
        method,
        path,
        headers: { ...headers, ...(body ? { 'content-length': String(body.length) } : {}) },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 1024 * 1024) {
            req.destroy(new Error('Authelia answered more than 1 MiB'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 502,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('Authelia did not answer in time')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

let autheliaRequest = realAutheliaRequest;

/**
 * Answer the broker's calls to Authelia with `transport` instead (tests);
 * `null` restores Authelia on loopback.
 *
 * @param {typeof realAutheliaRequest | null} transport
 */
export function setNativeBrokerForTests(transport) {
  autheliaRequest = transport ?? realAutheliaRequest;
  rateCounters.clear();
}

/** The headers Authelia takes the issuer and the client address from. */
function forwardedHeaders(domain, clientIp) {
  return {
    'x-forwarded-proto': 'https',
    'x-forwarded-host': `auth.${domain}`,
    ...(clientIp ? { 'x-forwarded-for': clientIp } : {}),
  };
}

/** Whether Authelia answers its discovery document for the domain now (R9). */
async function autheliaIsUp(domain) {
  try {
    const answer = await autheliaRequest({
      method: 'GET',
      path: '/.well-known/openid-configuration',
      headers: forwardedHeaders(domain, null),
      timeoutMs: AUTHELIA_LIVENESS_TIMEOUT_MS,
    });
    return answer.status === 200;
  } catch {
    return false;
  }
}

/**
 * Revoke a refresh token at Authelia (RFC 7009) — the broker holds one it
 * must not let live: a sign-in whose standing failed, a rotation that lost
 * to a revocation. Best effort.
 */
async function revokeAtAuthelia(domain, clientId, refreshToken, logger) {
  try {
    const answer = await autheliaRequest({
      method: 'POST',
      path: NATIVE_BROKER_ENDPOINTS.revocation,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        ...forwardedHeaders(domain, null),
      },
      body: Buffer.from(
        new URLSearchParams({
          token: refreshToken,
          token_type_hint: 'refresh_token',
          client_id: clientId,
        }).toString(),
      ),
    });
    if (answer.status !== 200) {
      logger?.warn({ clientId, status: answer.status }, 'Authelia did not revoke a refresh token');
    }
  } catch (err) {
    logger?.warn({ clientId, err: err.message }, 'Authelia did not revoke a refresh token');
  }
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

const NO_STORE = Object.freeze({ 'cache-control': 'no-store', pragma: 'no-cache' });

/** An OAuth error answer (RFC 6749 §5.2). */
function oauthError(status, error, description, extraHeaders = {}) {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE, ...extraHeaders },
    body: Buffer.from(
      JSON.stringify(description ? { error, error_description: description } : { error }),
    ),
  };
}

const invalidGrant = () =>
  oauthError(
    400,
    'invalid_grant',
    'The refresh token or authorization code is invalid, expired or revoked.',
  );
const invalidClient = (basic) =>
  oauthError(
    401,
    'invalid_client',
    'Client authentication failed.',
    basic ? { 'www-authenticate': 'Basic realm="lamaste"' } : {},
  );
const unavailable = () =>
  oauthError(503, 'temporarily_unavailable', 'Try again shortly.', { 'retry-after': '5' });

/** Authelia's answer as it came (hop-by-hop headers dropped). */
function passAnswer(answer) {
  const headers = {};
  for (const [name, value] of Object.entries(answer.headers)) {
    if (value === undefined || DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
    headers[name] = value;
  }
  return { status: answer.status, headers, body: answer.body };
}

// ---------------------------------------------------------------------------
// Rate limits (native requests only)
// ---------------------------------------------------------------------------

const rateCounters = new Map();

/** Whether one more hit on `key` stays within `max` this window. */
function withinRate(key, max, now = Date.now()) {
  const counter = rateCounters.get(key);
  if (!counter || counter.until <= now) {
    rateCounters.set(key, { count: 1, until: now + RATE_WINDOW_MS });
    if (rateCounters.size > 10_000) {
      for (const [k, c] of rateCounters) if (c.until <= now) rateCounters.delete(k);
    }
    return true;
  }
  counter.count += 1;
  return counter.count <= max;
}

const tooMany = () =>
  oauthError(429, 'temporarily_unavailable', 'Too many requests.', { 'retry-after': '60' });

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * The client a request names over HTTP Basic: the username of
 * `Basic base64(<id>:<secret>)`, form-urlencoded-decoded as Authelia
 * decodes it (RFC 6749 §2.3.1); null without Basic, `false` for a header
 * that does not decode.
 */
export function basicClientId(header) {
  if (typeof header !== 'string') return null;
  const match = /^Basic\s+([A-Za-z0-9+/=._~-]+)\s*$/i.exec(header);
  // A Basic header the broker cannot read is one it cannot classify:
  // refused, never passed on for Authelia to read its own way.
  if (!match) return /^\s*basic(?:\s|$)/i.test(header) ? false : null;
  let decoded;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf-8');
  } catch {
    return false;
  }
  const colon = decoded.indexOf(':');
  const raw = colon === -1 ? decoded : decoded.slice(0, colon);
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return false;
  }
}

/**
 * The form a request carries: its parameters (each name → every value), or
 * null when its body is not a form.
 *
 * @param {string | undefined} contentType
 * @param {Buffer | undefined} body
 */
export function parseForm(contentType, body) {
  if (!body || body.length === 0) return new Map();
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return null;
  const params = new Map();
  for (const [name, value] of new URLSearchParams(body.toString('utf-8'))) {
    params.set(name, [...(params.get(name) ?? []), value]);
  }
  return params;
}

/**
 * Why a request's body is not one the endpoints take, or null: a media type
 * other than `application/x-www-form-urlencoded` (parameters and case
 * ignored; none at all is refused too), or a `Content-Encoding` other than
 * `identity`. Checked before anything else, for every client (H1).
 *
 * @param {string | undefined} contentType
 * @param {string | undefined} contentEncoding
 */
export function bodyRefusal(contentType, contentEncoding) {
  if (contentEncoding !== undefined && contentEncoding.trim().toLowerCase() !== 'identity') {
    return 'The body must not be content-encoded.';
  }
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') {
    return 'The body must be application/x-www-form-urlencoded.';
  }
  return null;
}

/**
 * The clients a request's `client_assertion` names (RFC 7523 §3: its `iss`
 * and `sub`), read without checking it — the broker only classifies; an
 * unreadable assertion names none (Authelia refuses it).
 */
function assertionClients(params) {
  const out = [];
  for (const assertion of params.get('client_assertion') ?? []) {
    const payload = typeof assertion === 'string' ? assertion.split('.')[1] : undefined;
    if (payload === undefined) continue;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
      for (const name of ['iss', 'sub']) {
        if (typeof claims?.[name] === 'string') out.push(claims[name]);
      }
    } catch {
      // not a JWT: names no client
    }
  }
  return out;
}

/** The one value of `name`, undefined when absent, null when repeated. */
function single(params, name) {
  const values = params.get(name);
  if (values === undefined) return undefined;
  return values.length === 1 ? values[0] : null;
}

/** The form without Lamaste's own parameters (`device_name`), as Authelia gets it. */
function formForAuthelia(params) {
  const out = new URLSearchParams();
  for (const [name, values] of params) {
    if (name === 'device_name') continue;
    for (const value of values) out.append(name, value);
  }
  return Buffer.from(out.toString());
}

/**
 * The domain whose portal a request reached: its raw `Host` (nginx writes
 * `auth.<domain>` literally) under an active domain — or null.
 */
async function portalDomain(host) {
  if (typeof host !== 'string') return null;
  const name = host.toLowerCase();
  if (!name.startsWith('auth.')) return null;
  const domain = name.slice('auth.'.length);
  return (await activeDomainNames()).includes(domain) ? domain : null;
}

// ---------------------------------------------------------------------------
// The access token Authelia just issued
// ---------------------------------------------------------------------------

/**
 * The claims of an access token Authelia issued to the broker on loopback,
 * checked as the bearer path checks them (iss, aud, client, a username, an
 * expiry) — a misrendered client must not make a grant. Its signature is
 * Authelia's own, received over loopback; null when anything is off.
 */
export function issuedAccessTokenClaims(token, { domain, fqdn, clientId }) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  if (!claims || typeof claims !== 'object') return null;
  if (claims.iss !== `https://auth.${domain}`) return null;
  const aud = typeof claims.aud === 'string' ? [claims.aud] : claims.aud;
  if (!Array.isArray(aud) || !aud.includes(nativeAudience(fqdn))) return null;
  if (claims.client_id !== clientId) return null;
  if (!isLamasteUsername(claims.preferred_username)) return null;
  if (!Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= Date.now()) return null;
  return { username: claims.preferred_username, expiresAt: claims.exp * 1000 };
}

/** The JSON body of Authelia's 200, or null. */
function tokenAnswerOf(answer) {
  try {
    const parsed = JSON.parse(answer.body.toString('utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The endpoints
// ---------------------------------------------------------------------------

/**
 * Answer one request to the domain's token or revocation endpoint.
 *
 * @param {{ endpoint: 'token' | 'revocation', host: string | undefined, contentType: string | undefined, contentEncoding?: string | undefined, authorization: string | undefined, userAgent: string | undefined, accept: string | undefined, clientIp: string | undefined, body: Buffer | undefined, logger?: import('pino').Logger }} req
 * @returns {Promise<{ status: number, headers: Record<string, string | string[]>, body: Buffer }>}
 */
export async function handleBrokerRequest(req) {
  const domain = await portalDomain(req.host);
  if (!domain) {
    return oauthError(404, 'invalid_request', 'Not found.');
  }
  const refusedBody = bodyRefusal(req.contentType, req.contentEncoding);
  if (refusedBody !== null) return oauthError(400, 'invalid_request', refusedBody);
  const params = parseForm(req.contentType, req.body);
  const basic = basicClientId(req.authorization);
  if (basic === false) return invalidClient(true);
  const bodyClients = [
    ...(params?.get('client_id') ?? []),
    ...(params ? assertionClients(params) : []),
  ];
  const tokenParam = params
    ? single(params, req.endpoint === 'token' ? 'refresh_token' : 'token')
    : undefined;
  const known =
    typeof tokenParam === 'string' && tokenParam.length > 0
      ? await findRefreshToken(tokenSha256(tokenParam))
      : null;
  const native =
    known !== null ||
    bodyClients.some(isNativeClientId) ||
    (typeof basic === 'string' && isNativeClientId(basic));

  if (!native) return passThrough(req, domain);

  // A native request from here on.
  if (!withinRate(`ip:${req.clientIp ?? '-'}`, NATIVE_RATE_PER_ADDRESS)) return tooMany();
  if (params === null) return oauthError(400, 'invalid_request', 'The body must be a form.');
  // Native clients are public: any client authentication is refused.
  if (req.authorization !== undefined || params.has('client_assertion')) {
    return invalidClient(basic !== null);
  }
  const clientId = single(params, 'client_id');
  if (clientId === null) return oauthError(400, 'invalid_request', 'client_id repeated.');

  if (req.endpoint === 'revocation') return revocation(req, domain, params, clientId, known);

  const grantType = single(params, 'grant_type');
  if (grantType === 'refresh_token') {
    if (typeof tokenParam !== 'string' || tokenParam.length === 0) {
      return oauthError(400, 'invalid_request', 'refresh_token is required.');
    }
    if (!withinRate(`rt:${tokenSha256(tokenParam)}`, NATIVE_RATE_PER_TOKEN)) return tooMany();
    return refresh(req, domain, params, clientId, tokenParam, known);
  }
  if (grantType === 'authorization_code') {
    if (!isNativeClientId(clientId)) return invalidClient(false);
    return codeExchange(req, domain, params, clientId);
  }
  return oauthError(
    400,
    'unsupported_grant_type',
    'Native clients use authorization_code and refresh_token.',
  );
}

/** Pass a request that is no native client's to Authelia unchanged. */
async function passThrough(req, domain) {
  const headers = { ...forwardedHeaders(domain, req.clientIp) };
  for (const name of PASSED_REQUEST_HEADERS) {
    const value =
      name === 'content-type'
        ? req.contentType
        : name === 'authorization'
          ? req.authorization
          : name === 'user-agent'
            ? req.userAgent
            : req.accept;
    if (typeof value === 'string') headers[name] = value;
  }
  try {
    return passAnswer(
      await autheliaRequest({
        method: 'POST',
        path: NATIVE_BROKER_ENDPOINTS[req.endpoint],
        headers,
        body: req.body ?? Buffer.alloc(0),
      }),
    );
  } catch (err) {
    req.logger?.warn({ err: err.message }, 'Authelia did not answer a token request');
    return oauthError(502, 'server_error', 'The authorization server did not answer.');
  }
}

/** The served native client `clientId` of `domain` (R5), or null. */
async function clientOfPortal(clientId, domain) {
  if (!isNativeClientId(clientId)) return null;
  const client = await findResolvedNativeClient(clientId);
  if (!client || client.domain !== domain) return null;
  return client;
}

/** Forward a native request's form (Lamaste's own parameters removed) to Authelia. */
function forwardNative(req, domain, params) {
  return autheliaRequest({
    method: 'POST',
    path: NATIVE_BROKER_ENDPOINTS[req.endpoint],
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      ...(typeof req.userAgent === 'string' ? { 'user-agent': req.userAgent } : {}),
      ...forwardedHeaders(domain, req.clientIp),
    },
    body: formForAuthelia(params),
  });
}

/** `grant_type=authorization_code` for a native client: a grant, or a refusal. */
async function codeExchange(req, domain, params, clientId) {
  const client = await clientOfPortal(clientId, domain);
  if (!client || !client.served) return invalidClient(false);
  let answer;
  try {
    answer = await forwardNative(req, domain, params);
  } catch (err) {
    req.logger?.warn({ clientId, err: err.message }, 'Authelia did not answer a code exchange');
    return unavailable();
  }
  if (answer.status !== 200) return passAnswer(answer);
  const issued = tokenAnswerOf(answer);
  const refreshToken = issued?.refresh_token;
  const claims = issuedAccessTokenClaims(issued?.access_token, {
    domain,
    fqdn: client.fqdn,
    clientId,
  });
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    req.logger?.warn({ clientId }, 'A native sign-in without offline_access was refused');
    return oauthError(400, 'invalid_scope', 'offline_access is required.');
  }
  if (!claims) {
    await revokeAtAuthelia(domain, clientId, refreshToken, req.logger);
    req.logger?.error({ clientId }, 'Authelia issued an access token the client should not have');
    return oauthError(500, 'server_error', 'The token could not be accepted.');
  }

  const { findDirectoryUser } = await import('./directory.js');
  const user = await findDirectoryUser(claims.username);
  const ctx = await standingContext({ checkHostGrant: true });
  // The client again, as the standing reads the hosts: deleted or no longer
  // served while Authelia answered, the tokens it just issued must not live
  // (security review L1).
  const current = await findResolvedNativeClient(clientId, ctx.state);
  if (!current?.served || current.domain !== domain) {
    await revokeAtAuthelia(domain, clientId, refreshToken, req.logger);
    return invalidClient(false);
  }
  const standing = user
    ? await nativeStanding(user.userId, current, ctx)
    : { ok: false, reason: 'standing:removed' };
  if (standing.ok !== true) {
    await revokeAtAuthelia(domain, clientId, refreshToken, req.logger);
    if (standing.unavailable) return unavailable();
    req.logger?.info(
      { clientId, reason: standing.reason, ...(user ? { user: `user:${user.userId}` } : {}) },
      'Native sign-in refused',
    );
    return oauthError(400, 'invalid_grant', 'This person may not use this application.');
  }
  const grant = await createNativeGrant({
    clientId,
    userId: user.userId,
    absoluteDays: client.absoluteDays,
    deviceName: nativeDeviceName(single(params, 'device_name')),
    userAgent: nativeUserAgentSummary(req.userAgent),
    refreshSha256: tokenSha256(refreshToken),
    accessSha256: tokenSha256(issued.access_token),
    accessExpiresAt: claims.expiresAt,
  });
  if (!grant) {
    await revokeAtAuthelia(domain, clientId, refreshToken, req.logger);
    return oauthError(400, 'invalid_grant', 'This person may not use this application.');
  }
  await recordAuditBestEffort(
    {
      actor: `user:${user.userId}`,
      action: 'native-app.grant.created',
      details: { clientId, grantId: grant.grantId, userId: user.userId },
    },
    req.logger,
  );
  req.logger?.info({ clientId, user: `user:${user.userId}` }, 'Native sign-in');
  nativeSignIns.emit('sign-in', {
    grantId: grant.grantId,
    clientId,
    userId: user.userId,
    at: grant.createdAt,
  });
  return passAnswer(answer);
}

/** `grant_type=refresh_token` for a native client. */
async function refresh(req, domain, params, clientId, refreshToken, known) {
  if (!known) return invalidGrant();
  const sha = tokenSha256(refreshToken);
  const { grant: seen } = known;

  if (known.token.state === 'spent') {
    // Within the grace window, the answer this token's rotation got (R8) —
    // on the client's own portal, within the grant's lifetimes and the
    // person's standing, as a refresh would be (security review L2).
    if (
      seen.revokedAt === null &&
      seen.clientId === clientId &&
      known.token.graceAnswer !== null &&
      known.token.graceUntil !== null &&
      Date.now() <= known.token.graceUntil
    ) {
      const refused = await graceRefusal(seen, clientId, domain, req.logger);
      if (refused) return refused;
      let sealed = null;
      try {
        sealed = JSON.parse(known.token.graceAnswer);
      } catch {
        sealed = null;
      }
      const answer = sealed
        ? openGraceAnswer({ spentRefreshToken: refreshToken, grantId: seen.grantId, sealed })
        : null;
      if (answer !== null) {
        return {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE },
          body: Buffer.from(answer),
        };
      }
    }
    if (seen.revokedAt === null) await reuseDetected(seen, req.logger);
    return invalidGrant();
  }

  if (seen.clientId !== clientId) return invalidGrant();
  const client = await clientOfPortal(clientId, domain);
  if (!client) return invalidClient(false);

  // The person's standing — Gatekeeper's answer included — before the
  // grant's lock, which holds nothing but state.db and Authelia's loopback
  // (R14, security review L5); a revocation meanwhile loses to the commit's
  // compare-and-swap (R7).
  const ctx = await standingContext({ checkHostGrant: true });
  const standing = await nativeStanding(
    seen.userId,
    await findResolvedNativeClient(clientId, ctx.state),
    ctx,
  );
  if (standing.ok === false) {
    await revokeNativeGrants({ grantId: seen.grantId }, standing.reason, { logger: req.logger });
    return invalidGrant();
  }
  if (standing.ok !== true) return unavailable();

  return withGrantLock(seen.grantId, async () => {
    // Read again under the lock: another refresh may have rotated it.
    const fresh = await findRefreshToken(sha);
    if (!fresh) return invalidGrant();
    const grant = fresh.grant;
    if (fresh.token.state !== 'current' || grant.revokedAt !== null) {
      // Rotated meanwhile by a request that held the lock first: its
      // answer within the window, a reuse after (one more pass).
      return fresh.token.state === 'spent' && grant.revokedAt === null
        ? refresh(req, domain, params, clientId, refreshToken, fresh)
        : invalidGrant();
    }
    const end = async (reason) => {
      await revokeNativeGrants({ grantId: grant.grantId }, reason, { logger: req.logger });
      return invalidGrant();
    };
    const expiry = grantExpiry(grant, client);
    if (expiry) return end(expiry);

    let answer;
    try {
      answer = await forwardNative(req, domain, params);
    } catch (err) {
      req.logger?.warn({ clientId, err: err.message }, 'Authelia did not answer a refresh');
      return issuerFailed(grant, domain, req.logger);
    }
    if (answer.status >= 500) return issuerFailed(grant, domain, req.logger);
    if (answer.status === 400 || answer.status === 401) {
      const body = tokenAnswerOf(answer);
      if (body?.error === 'invalid_grant' || body?.error === 'invalid_client') {
        return end('issuer_refused');
      }
      return passAnswer(answer);
    }
    if (answer.status !== 200) return passAnswer(answer);

    const issued = tokenAnswerOf(answer);
    const claims = issuedAccessTokenClaims(issued?.access_token, {
      domain,
      fqdn: client.fqdn,
      clientId,
    });
    const next = issued?.refresh_token;
    if (!claims || typeof next !== 'string' || next.length === 0) {
      if (typeof next === 'string' && next.length > 0) {
        await revokeAtAuthelia(domain, clientId, next, req.logger);
      }
      req.logger?.error({ clientId }, 'Authelia answered a refresh the broker cannot accept');
      return end('issuer_refused');
    }
    const committed = await commitNativeRotation({
      grantId: grant.grantId,
      version: grant.version,
      oldSha256: sha,
      newSha256: tokenSha256(next),
      accessSha256: tokenSha256(issued.access_token),
      accessExpiresAt: claims.expiresAt,
      graceUntil: Date.now() + NATIVE_REFRESH_GRACE_MS,
      graceAnswer: JSON.stringify(
        sealGraceAnswer({
          spentRefreshToken: refreshToken,
          grantId: grant.grantId,
          answer: answer.body.toString('utf-8'),
        }),
      ),
    });
    if (!committed) {
      // Revoked while Authelia answered: the new token must not live (R7).
      await revokeAtAuthelia(domain, clientId, next, req.logger);
      return invalidGrant();
    }
    return passAnswer(answer);
  });
}

/**
 * Why a spent token's grace answer may not be given, as a response, or null
 * (L2): another domain's portal (R5), a client not served, the grant past
 * its lifetimes, or the person's standing — directory and audience, the
 * cheap part (the restricted host's grant waits for the next refresh or the
 * tick). Ends the grant when its time or standing is over.
 */
async function graceRefusal(grant, clientId, domain, logger) {
  const client = await clientOfPortal(clientId, domain);
  if (!client) return invalidClient(false);
  const end = async (reason) => {
    await revokeNativeGrants({ grantId: grant.grantId }, reason, { logger });
    return invalidGrant();
  };
  const expiry = grantExpiry(grant, client);
  if (expiry) return end(expiry);
  const ctx = await standingContext({ checkHostGrant: false });
  const standing = await nativeStanding(grant.userId, client, ctx);
  if (standing.ok === false) return end(standing.reason);
  if (standing.ok !== true) return unavailable();
  return null;
}

/** A 5xx or no answer from Authelia for a grant's current token (R9). */
async function issuerFailed(grant, domain, logger) {
  if (!(await autheliaIsUp(domain))) return unavailable();
  const failures = await countIssuerFailure(grant.grantId);
  if (failures >= ISSUER_FAILURE_LIMIT) {
    await revokeNativeGrants({ grantId: grant.grantId }, 'issuer_refused', { logger });
    return invalidGrant();
  }
  return unavailable();
}

/** A spent refresh token presented after its grace window: the grant ends. */
async function reuseDetected(grant, logger) {
  const ended = await revokeNativeGrants({ grantId: grant.grantId }, 'reuse', { logger });
  if (ended.length === 0) return;
  await recordAuditBestEffort(
    {
      actor: 'lamaste',
      action: 'native-app.grant.reuse-detected',
      details: { clientId: grant.clientId, grantId: grant.grantId, userId: grant.userId },
    },
    logger,
  );
  await notifyAdminsBestEffort(
    {
      source: 'native-apps',
      level: 'warning',
      message: `A spent refresh token of the native client ${grant.clientId} was used again; that sign-in (grant ${grant.grantId}) was ended. A copied token, or an app that refreshed twice.`,
    },
    logger,
  );
  logger?.warn({ clientId: grant.clientId, grantId: grant.grantId }, 'Refresh token reuse');
}

/** The revocation endpoint for a native client: the grant ends; always 200 (RFC 7009 §2.2). */
async function revocation(req, domain, params, clientId, known) {
  const token = single(params, 'token');
  if (typeof token !== 'string' || token.length === 0) {
    return oauthError(400, 'invalid_request', 'token is required.');
  }
  if (!isNativeClientId(clientId)) return invalidClient(false);
  if (known && known.grant.clientId === clientId && known.grant.revokedAt === null) {
    await revokeNativeGrants({ grantId: known.grant.grantId }, 'revoked_by_client', {
      actor: `user:${known.grant.userId}`,
      logger: req.logger,
    });
  }
  try {
    await forwardNative(req, domain, params);
  } catch (err) {
    req.logger?.warn({ clientId, err: err.message }, 'Authelia did not answer a revocation');
  }
  return { status: 200, headers: { ...NO_STORE }, body: Buffer.alloc(0) };
}
