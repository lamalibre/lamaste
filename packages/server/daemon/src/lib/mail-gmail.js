/**
 * The `gmail-api` transport (packages/core/docs/mail-design.md §3.2–§3.4):
 * Google's OAuth token endpoint and the Gmail API's `messages.send`, over
 * HTTPS only — the ports Google's SMTP relay listens on are blocked where
 * relays run.
 *
 * The relay holds one OAuth client (id + secret) and one Workspace user's
 * refresh token, scopes `gmail.send openid email` and nothing wider:
 * listing the account's send-as addresses would need a scope that reads the
 * mailbox or edits its settings, so a sender is never checked against them
 * (§3.2) — the account is read from the `id_token`, the granted scope from
 * the token response.
 *
 * Every failure is a {@link MailDeliveryError} naming what the relay does
 * about it — never a provider's message, which may quote what was sent.
 */

import crypto from 'node:crypto';

import { parseMailAddress } from '@lamalibre/lamaste';

import { MailDeliveryError } from './mail-errors.js';

/** The scope a transport must hold, and what consent asks for. */
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const GOOGLE_CONSENT_SCOPES = Object.freeze(['openid', 'email', GMAIL_SEND_SCOPE]);

/** The issuers Google's `id_token`s carry. */
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** An access token is renewed this long before Google says it expires. */
const TOKEN_EARLY_RENEWAL_MS = 5 * 60_000;

/** At most this many bytes of a Google answer are read. */
const GOOGLE_RESPONSE_MAX_BYTES = 256 * 1024;

/**
 * Where Google is. Tests — the rodeo specs' fake Google and the unit
 * tests' — point every endpoint at one base URL through
 * `LAMALIBRE_LAMASTE_TEST_GOOGLE_BASE_URL` (a unit drop-in on a test VM,
 * §8): an `https://` URL or a loopback `http://` one. Read on every call.
 */
export function googleEndpoints() {
  const base = process.env.LAMALIBRE_LAMASTE_TEST_GOOGLE_BASE_URL;
  if (!base) {
    return {
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      revoke: 'https://oauth2.googleapis.com/revoke',
      gmail: 'https://gmail.googleapis.com',
    };
  }
  const url = new URL(base);
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('LAMALIBRE_LAMASTE_TEST_GOOGLE_BASE_URL is https:// or a loopback http://');
  }
  const root = url.href.replace(/\/+$/, '');
  return {
    authorize: `${root}/o/oauth2/v2/auth`,
    token: `${root}/token`,
    revoke: `${root}/revoke`,
    gmail: root,
  };
}

/** `fetch` with a deadline; a network failure or timeout is transient. */
async function googleFetch(url, init, signal) {
  try {
    return await fetch(url, { ...init, redirect: 'error', signal });
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new MailDeliveryError('transient', timeout ? 'timeout' : 'network', { cause: err });
  }
}

/** A Google answer's JSON (capped), or null when it is not JSON. */
async function readJson(res) {
  const text = await res.text().catch(() => '');
  if (Buffer.byteLength(text) > GOOGLE_RESPONSE_MAX_BYTES) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** POST a form to the token endpoint. */
function postForm(url, fields, signal) {
  return googleFetch(
    url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams(fields).toString(),
    },
    signal,
  );
}

/** What a failed token request means: the grant or the client gone, or try again. */
function tokenFailure(status, body) {
  const error = typeof body?.error === 'string' ? body.error : null;
  if (error === 'invalid_grant') return new MailDeliveryError('down', 'invalid_grant');
  if (error === 'invalid_client' || error === 'unauthorized_client') {
    return new MailDeliveryError('down', 'invalid_client');
  }
  if (status === 429 || status >= 500) return new MailDeliveryError('transient', `http_${status}`);
  return new MailDeliveryError('down', 'token_refused');
}

/** The scopes a token response granted. */
function grantedScopes(body) {
  return typeof body?.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : [];
}

/**
 * The account an `id_token` names: its `email`, lower-cased, when
 * `email_verified` is true. The token came straight from Google's token
 * endpoint over TLS in answer to this client's authenticated request, so —
 * as OpenID Connect Core §3.1.3.7 allows — the TLS server check stands in
 * for the signature check; `iss`, `aud` (the client id) and `exp` are
 * checked here. Throws a `down` {@link MailDeliveryError} `id_token`
 * otherwise.
 *
 * @param {unknown} idToken
 * @param {string} clientId
 * @param {Date} [now]
 */
export function accountOfIdToken(idToken, clientId, now = new Date()) {
  const refuse = () => new MailDeliveryError('down', 'id_token');
  if (typeof idToken !== 'string') throw refuse();
  const parts = idToken.split('.');
  if (parts.length !== 3) throw refuse();
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch {
    throw refuse();
  }
  const audiences = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
  if (
    !GOOGLE_ISSUERS.has(claims?.iss) ||
    !audiences.includes(clientId) ||
    typeof claims.exp !== 'number' ||
    claims.exp * 1000 <= now.getTime() ||
    claims.email_verified !== true
  ) {
    throw refuse();
  }
  const parsed = parseMailAddress(claims.email);
  if (parsed === null) throw refuse();
  return `${parsed.local}@${parsed.domain}`;
}

/**
 * Access tokens by credential (a hash of client id and refresh token, so
 * nothing secret is a key), each until five minutes before it expires.
 * @type {Map<string, { token: string, expiresAt: number }>}
 */
const accessTokens = new Map();

function cacheKey(clientId, refreshToken) {
  return crypto.createHash('sha256').update(`${clientId}\0${refreshToken}`).digest('hex');
}

/** Forget every cached access token (tests; a transport cleared). */
export function forgetGmailAccessTokens() {
  accessTokens.clear();
}

/**
 * Refresh: a new access token for `credentials`, the scopes it carries and
 * the account its `id_token` names (null when Google sent none).
 *
 * @param {{ clientId: string, clientSecret: string, refreshToken: string }} credentials
 * @param {AbortSignal} signal
 */
export async function refreshGmailToken(credentials, signal) {
  const res = await postForm(
    googleEndpoints().token,
    {
      grant_type: 'refresh_token',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
    },
    signal,
  );
  const body = await readJson(res);
  if (!res.ok) throw tokenFailure(res.status, body);
  if (typeof body?.access_token !== 'string' || body.access_token.length === 0) {
    throw new MailDeliveryError('transient', 'token_malformed');
  }
  const expiresIn = Number.isFinite(body.expires_in) ? body.expires_in : 3600;
  accessTokens.set(cacheKey(credentials.clientId, credentials.refreshToken), {
    token: body.access_token,
    expiresAt: Date.now() + expiresIn * 1000 - TOKEN_EARLY_RENEWAL_MS,
  });
  return {
    accessToken: body.access_token,
    scopes: grantedScopes(body),
    account:
      body.id_token === undefined ? null : accountOfIdToken(body.id_token, credentials.clientId),
  };
}

/** A cached access token, or a refreshed one. */
async function accessTokenFor(credentials, signal) {
  const cached = accessTokens.get(cacheKey(credentials.clientId, credentials.refreshToken));
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  return (await refreshGmailToken(credentials, signal)).accessToken;
}

/**
 * Admission (§3.4), sending nothing: the refresh token still works, the
 * grant includes `gmail.send`, and the account is the one stored (when
 * one is). Answers the account. `down` errors: `invalid_grant`,
 * `invalid_client`, `scope`, `id_token`, `account_changed`.
 *
 * @param {{ clientId: string, clientSecret: string, refreshToken: string }} credentials
 * @param {{ account?: string | null, signal: AbortSignal }} opts
 */
export async function checkGmailCredentials(credentials, { account = null, signal }) {
  const refreshed = await refreshGmailToken(credentials, signal);
  if (!refreshed.scopes.includes(GMAIL_SEND_SCOPE)) {
    throw new MailDeliveryError('down', 'scope');
  }
  if (refreshed.account === null) throw new MailDeliveryError('down', 'id_token');
  if (account !== null && refreshed.account !== account) {
    throw new MailDeliveryError('down', 'account_changed');
  }
  return { account: refreshed.account };
}

/** The reasons Gmail gives for an account that sent too much — 24 h without sending. */
const LIMIT_REASONS = new Set(['dailyLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']);

/** What a failed `messages.send` means. */
function sendFailure(status, body) {
  const errors = Array.isArray(body?.error?.errors) ? body.error.errors : [];
  const reasons = errors.map((e) => e?.reason).filter((r) => typeof r === 'string');
  const message = typeof body?.error?.message === 'string' ? body.error.message : '';
  if (
    (status === 403 || status === 429) &&
    (reasons.some((r) => LIMIT_REASONS.has(r)) || /sending limit exceeded/i.test(message))
  ) {
    return new MailDeliveryError('limited', 'provider_limit');
  }
  if (status === 429 || status >= 500) return new MailDeliveryError('transient', `http_${status}`);
  if (status === 401) return new MailDeliveryError('transient', 'token_expired');
  if (status === 403) return new MailDeliveryError('down', 'scope');
  return new MailDeliveryError('refused', `http_${status}`);
}

/**
 * Send one RFC 5322 message as the account (`users/me/messages/send`). An
 * access token Google refuses (401) is dropped from the cache and the send
 * is tried once more with a new one.
 *
 * @param {{ clientId: string, clientSecret: string, refreshToken: string }} credentials
 * @param {Buffer} raw the whole message
 * @param {AbortSignal} signal
 */
export async function sendGmailMessage(credentials, raw, signal) {
  const key = cacheKey(credentials.clientId, credentials.refreshToken);
  for (let attempt = 0; ; attempt++) {
    const token = await accessTokenFor(credentials, signal);
    const res = await googleFetch(
      `${googleEndpoints().gmail}/gmail/v1/users/me/messages/send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ raw: raw.toString('base64url') }),
      },
      signal,
    );
    if (res.ok) {
      await res.body?.cancel().catch(() => {});
      return;
    }
    const failure = sendFailure(res.status, await readJson(res));
    if (res.status === 401 && attempt === 0) {
      accessTokens.delete(key);
      continue;
    }
    throw failure;
  }
}

/** A PKCE pair: the verifier kept, its S256 challenge sent. */
export function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Google's consent URL (§3.3): offline access (a refresh token), consent
 * asked every time (a new refresh token even for an account that consented
 * before), PKCE S256, the state Google returns.
 */
export function googleAuthorizeUrl({ clientId, redirectUri, state, challenge }) {
  const url = new URL(googleEndpoints().authorize);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_CONSENT_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.href;
}

/**
 * The code Google returned, exchanged for tokens with the PKCE verifier:
 * the refresh token, the granted scopes and the account. `down` errors
 * when Google refuses or leaves something out.
 */
export async function exchangeGoogleCode(
  { clientId, clientSecret, code, verifier, redirectUri },
  signal,
) {
  const res = await postForm(
    googleEndpoints().token,
    {
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    },
    signal,
  );
  const body = await readJson(res);
  if (!res.ok) throw tokenFailure(res.status, body);
  if (typeof body?.refresh_token !== 'string' || body.refresh_token.length === 0) {
    throw new MailDeliveryError('down', 'no_refresh_token');
  }
  if (!grantedScopes(body).includes(GMAIL_SEND_SCOPE)) {
    throw new MailDeliveryError('down', 'scope');
  }
  return {
    refreshToken: body.refresh_token,
    account: accountOfIdToken(body.id_token, clientId),
  };
}

/** Revoke a refresh token at Google — best effort: false when it could not be. */
export async function revokeGoogleToken(refreshToken, signal) {
  try {
    const res = await postForm(googleEndpoints().revoke, { token: refreshToken }, signal);
    await res.body?.cancel().catch(() => {});
    return res.ok;
  } catch {
    return false;
  }
}
