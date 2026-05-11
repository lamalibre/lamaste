/**
 * HTTP client for the Lamaste panel identity API.
 *
 * Makes authenticated HTTP requests to the panel's identity endpoints
 * using an undici Dispatcher configured with mTLS certificates.
 */

import { readFile } from 'node:fs/promises';
import { Agent as UndiciAgent, fetch, type Dispatcher } from 'undici';
import type {
  IdentityLogger,
  IdentityCertConfig,
  UserMetadata,
} from './types.js';
import { IdentityHttpError } from './types.js';

// ---------------------------------------------------------------------------
// Dispatcher factory
// ---------------------------------------------------------------------------

export interface CreateIdentityDispatcherOptions {
  /** PEM or P12 certificate configuration. */
  readonly certs: IdentityCertConfig;
  /**
   * Verify the panel's TLS server certificate.
   *
   * Default: `false` — the panel uses a self-signed server certificate
   * that is separate from the mTLS CA. Set to `true` only if you have
   * the server's CA in the trust chain (e.g., via the `caPath` in PEM mode).
   */
  readonly rejectUnauthorized?: boolean;
}

/**
 * Create an undici dispatcher configured with mTLS client certificates.
 *
 * Supports both PEM (cert + key + CA files) and P12 (single .p12 bundle).
 * The returned dispatcher can be passed to `IdentityClient` or used directly.
 *
 * The caller is responsible for closing the dispatcher when done
 * (`await dispatcher.close()`).
 */
export async function createIdentityDispatcher(
  options: CreateIdentityDispatcherOptions,
): Promise<UndiciAgent> {
  const { certs, rejectUnauthorized = false } = options;

  if ('p12Path' in certs) {
    const pfx = await readFile(certs.p12Path);
    if (pfx.length === 0) {
      throw new Error(`P12 certificate file is empty: ${certs.p12Path}`);
    }
    return new UndiciAgent({
      connect: { pfx, passphrase: certs.p12Password, rejectUnauthorized },
    });
  }

  const [cert, key, ca] = await Promise.all([
    readFile(certs.certPath, 'utf-8'),
    readFile(certs.keyPath, 'utf-8'),
    readFile(certs.caPath, 'utf-8'),
  ]);
  return new UndiciAgent({
    connect: { cert, key, ca, rejectUnauthorized },
  });
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface IdentityClientOptions {
  /** Panel base URL (e.g., https://panel.example.com:9292). */
  readonly panelUrl: string;
  /** undici Dispatcher configured with mTLS client certificates. */
  readonly dispatcher: Dispatcher;
  readonly logger: IdentityLogger;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected ${label} to be an object, got ${typeof value}`);
  }
}

function assertField(
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
// Client
// ---------------------------------------------------------------------------

/**
 * Client for the panel identity API endpoints.
 *
 * Used by plugins to query user metadata and group membership
 * from the panel's Authelia user store.
 */
export class IdentityClient {
  private readonly panelUrl: string;
  private readonly dispatcher: Dispatcher;
  private readonly logger: IdentityLogger;

  constructor(options: IdentityClientOptions) {
    let url = options.panelUrl;
    while (url.endsWith('/')) url = url.slice(0, -1);
    this.panelUrl = url;
    this.dispatcher = options.dispatcher;
    this.logger = options.logger.child({ component: 'identity-client' });
  }

  /**
   * List all users from the panel identity API.
   * GET /api/identity/users
   */
  async listUsers(): Promise<UserMetadata[]> {
    const url = `${this.panelUrl}/api/identity/users`;
    this.logger.debug({ url }, 'Listing users');

    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
      dispatcher: this.dispatcher,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new IdentityHttpError(
        `Failed to list users: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
        response.status,
      );
    }

    const data: unknown = await response.json();
    assertObject(data, 'listUsers response');
    assertField(data, 'users', 'array', 'listUsers response');
    return (data as unknown as { users: UserMetadata[] }).users;
  }

  /**
   * Get a single user by username.
   * GET /api/identity/users/:username
   */
  async getUser(username: string): Promise<UserMetadata> {
    const url = `${this.panelUrl}/api/identity/users/${encodeURIComponent(username)}`;
    this.logger.debug({ url, username }, 'Getting user');

    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
      dispatcher: this.dispatcher,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new IdentityHttpError(
        `Failed to get user: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
        response.status,
      );
    }

    const data: unknown = await response.json();
    assertObject(data, 'getUser response');
    assertField(data, 'user', 'object', 'getUser response');
    return (data as unknown as { user: UserMetadata }).user;
  }

  /**
   * List all groups from the panel identity API.
   * GET /api/identity/groups
   */
  async listGroups(): Promise<string[]> {
    const url = `${this.panelUrl}/api/identity/groups`;
    this.logger.debug({ url }, 'Listing groups');

    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
      dispatcher: this.dispatcher,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new IdentityHttpError(
        `Failed to list groups: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
        response.status,
      );
    }

    const data: unknown = await response.json();
    assertObject(data, 'listGroups response');
    assertField(data, 'groups', 'array', 'listGroups response');
    return (data as unknown as { groups: string[] }).groups;
  }
}
