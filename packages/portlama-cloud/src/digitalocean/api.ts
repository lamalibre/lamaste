/**
 * Low-level DigitalOcean API client using undici.
 *
 * All requests include a Bearer token and a 30-second timeout.
 * Response validation follows the assertObject/assertField pattern
 * from portlama-tickets/src/client.ts.
 */

import { fetch } from 'undici';
import { CloudHttpError } from '../errors.js';

const BASE_URL = 'https://api.digitalocean.com';

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export function assertObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected ${label} to be an object, got ${typeof value}`);
  }
}

export function assertField(
  obj: Record<string, unknown>,
  field: string,
  type: string,
  label: string,
): void {
  if (type === 'array') {
    if (!Array.isArray(obj[field])) {
      throw new Error(`${label} missing ${field} array`);
    }
  } else if (typeof obj[field] !== type) {
    throw new Error(`${label} missing ${field} (expected ${type})`);
  }
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export interface DOApiOptions {
  readonly token: string;
  readonly timeoutMs?: number;
}

/**
 * Make an authenticated GET request to the DO API.
 * Returns the parsed JSON body and the response headers.
 */
export async function doGet(
  path: string,
  options: DOApiOptions,
): Promise<{ body: unknown; headers: Headers }> {
  const { token, timeoutMs = 30_000 } = options;
  const url = `${BASE_URL}${path}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new CloudHttpError(
      `DO API GET ${path}: HTTP ${response.status} ${response.statusText}${text ? ` — ${text}` : ''}`,
      response.status,
    );
  }

  const body: unknown = await response.json();
  return { body, headers: response.headers };
}

/**
 * Make an authenticated POST request to the DO API.
 */
export async function doPost(
  path: string,
  payload: unknown,
  options: DOApiOptions,
): Promise<{ body: unknown; headers: Headers }> {
  const { token, timeoutMs = 30_000 } = options;
  const url = `${BASE_URL}${path}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new CloudHttpError(
      `DO API POST ${path}: HTTP ${response.status} ${response.statusText}${text ? ` — ${text}` : ''}`,
      response.status,
    );
  }

  const body: unknown = await response.json();
  return { body, headers: response.headers };
}

/**
 * Make an authenticated PUT request to the DO API.
 */
export async function doPut(
  path: string,
  payload: unknown,
  options: DOApiOptions,
): Promise<{ body: unknown; headers: Headers }> {
  const { token, timeoutMs = 30_000 } = options;
  const url = `${BASE_URL}${path}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new CloudHttpError(
      `DO API PUT ${path}: HTTP ${response.status} ${response.statusText}${text ? ` — ${text}` : ''}`,
      response.status,
    );
  }

  const body: unknown = await response.json();
  return { body, headers: response.headers };
}

/**
 * Make an authenticated DELETE request to the DO API.
 * Returns void — DELETE responses typically have no body.
 */
export async function doDelete(
  path: string,
  options: DOApiOptions,
): Promise<void> {
  const { token, timeoutMs = 30_000 } = options;
  const url = `${BASE_URL}${path}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new CloudHttpError(
      `DO API DELETE ${path}: HTTP ${response.status} ${response.statusText}${text ? ` — ${text}` : ''}`,
      response.status,
    );
  }
}
