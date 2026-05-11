/**
 * Tiny gatekeeper admin-API client for callers other than the
 * /api/gatekeeper/* proxy routes.
 *
 * Reads the shared secret on first use (cached for the process lifetime)
 * and forwards a request to http://127.0.0.1:9294/api/...
 *
 * Used by the user-delete route to cascade-revoke grants belonging to a
 * deleted Authelia user, and by other internal callers that need to talk
 * to gatekeeper without going through the panel's own mTLS layer.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getConfigPath } from './config.js';

const GATEKEEPER_BASE = 'http://127.0.0.1:9294';
let cachedSecret = null;
let secretLoaded = false;

/**
 * Load the gatekeeper API secret. Supports both the new JSON envelope
 * (`gatekeeper-secret.json`) written by the gatekeeper service and the
 * legacy plain-text file (`gatekeeper-secret`). Returns null if neither
 * exists — callers must treat this as "gatekeeper not installed".
 */
async function loadSecret() {
  if (secretLoaded) return cachedSecret;
  secretLoaded = true;

  const configDir = path.dirname(getConfigPath());

  // Prefer the JSON envelope written by recent gatekeeper builds
  try {
    const raw = await readFile(path.join(configDir, 'gatekeeper-secret.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.secret === 'string' && parsed.secret.length > 0) {
      cachedSecret = parsed.secret;
      return cachedSecret;
    }
  } catch {
    // Fall through to legacy
  }

  // Legacy plain-text fallback
  try {
    const raw = (await readFile(path.join(configDir, 'gatekeeper-secret'), 'utf-8')).trim();
    if (raw.length > 0) {
      cachedSecret = raw;
      return cachedSecret;
    }
  } catch {
    // No secret available
  }

  cachedSecret = null;
  return cachedSecret;
}

/**
 * Result envelope.
 *
 * @typedef {{ ok: true, statusCode: number, data: unknown }
 *          | { ok: false, statusCode: number, error: string, reason: 'unreachable' | 'no-secret' | 'http-error' }
 *          } GatekeeperResult
 */

/**
 * Forward a request to the gatekeeper service.
 *
 * Network failures (ECONNREFUSED, etc.) and missing-secret conditions
 * are reported as `{ ok: false, reason: ... }` rather than thrown — the
 * panel server treats gatekeeper as best-effort during cascade operations.
 *
 * @param {string} method
 * @param {string} apiPath - e.g. "/api/grants?principalType=user&principalId=alice"
 * @param {unknown} [body]
 * @returns {Promise<GatekeeperResult>}
 */
export async function gatekeeperRequest(method, apiPath, body) {
  const secret = await loadSecret();
  if (!secret) {
    return {
      ok: false,
      statusCode: 503,
      error: 'gatekeeper secret not available',
      reason: 'no-secret',
    };
  }

  const url = `${GATEKEEPER_BASE}${apiPath}`;
  // Only set Content-Type when we actually have a body. Fastify rejects
  // `Content-Type: application/json` with an empty body (e.g. DELETE) as
  // 400 Bad Request.
  const headers = { 'X-Gatekeeper-Secret': secret };
  const options = { method, headers };
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    return {
      ok: false,
      statusCode: 503,
      error: `gatekeeper unreachable: ${err.message}`,
      reason: 'unreachable',
    };
  }

  const text = await response.text();
  let data;
  try {
    data = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (response.status >= 400) {
    return {
      ok: false,
      statusCode: response.status,
      error:
        data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
          ? data.error
          : `gatekeeper returned HTTP ${response.status}`,
      reason: 'http-error',
    };
  }

  return { ok: true, statusCode: response.status, data };
}
