/**
 * HTTP client for the Portlama panel ticket API.
 *
 * Makes authenticated HTTP requests to the panel's ticket endpoints
 * using an undici Dispatcher configured with mTLS certificates.
 */

import { readFile } from 'node:fs/promises';
import { Agent as UndiciAgent, fetch, type Dispatcher } from 'undici';
import type {
  TicketLogger,
  TicketCertConfig,
  TransportConfig,
  RegisterInstanceResult,
  RequestTicketResult,
  TicketInboxEntry,
  TicketValidationResult,
  SessionInfo,
  SessionHeartbeatResult,
} from './types.js';
import { TicketHttpError } from './types.js';

// ---------------------------------------------------------------------------
// Dispatcher factory
// ---------------------------------------------------------------------------

export interface CreateTicketDispatcherOptions {
  /** PEM or P12 certificate configuration. */
  readonly certs: TicketCertConfig;
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
 * The returned dispatcher can be passed to `TicketClient` or used directly.
 *
 * The caller is responsible for closing the dispatcher when done
 * (`await dispatcher.close()`).
 */
export async function createTicketDispatcher(
  options: CreateTicketDispatcherOptions,
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

export interface TicketClientOptions {
  /** Panel base URL (e.g., https://panel.example.com:9292). */
  readonly panelUrl: string;
  /** undici Dispatcher configured with mTLS client certificates. */
  readonly dispatcher: Dispatcher;
  readonly logger: TicketLogger;
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
 * Client for the panel ticket API endpoints.
 *
 * Used by the target side (TicketSessionManager) to poll the ticket inbox,
 * validate tickets, create sessions, and send session heartbeats.
 *
 * Used by the source side (TicketInstanceManager) to register instances,
 * send instance heartbeats, and request tickets.
 */
export class TicketClient {
  private readonly panelUrl: string;
  private readonly dispatcher: Dispatcher;
  private readonly logger: TicketLogger;

  constructor(options: TicketClientOptions) {
    this.panelUrl = options.panelUrl.endsWith('/')
      ? options.panelUrl.replace(/\/+$/, '')
      : options.panelUrl;
    this.dispatcher = options.dispatcher;
    this.logger = options.logger.child({ component: 'ticket-client' });
  }

  // -------------------------------------------------------------------------
  // Source-side: Instance management
  // -------------------------------------------------------------------------

  /**
   * Register a ticket instance declaring this agent implements a scope.
   * POST /api/tickets/instances
   */
  async registerInstance(
    scope: string,
    transport: TransportConfig,
  ): Promise<RegisterInstanceResult> {
    const url = `${this.panelUrl}/api/tickets/instances`;
    this.logger.debug({ url, scope }, 'Registering ticket instance');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, transport }),
      signal: AbortSignal.timeout(30_000),
      dispatcher: this.dispatcher,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new TicketHttpError(
        `Failed to register ticket instance: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
        response.status,
      );
    }

    const data: unknown = await response.json();
    assertObject(data, 'registerInstance response');
    assertField(data, 'instanceId', 'string', 'registerInstance response');
    return data as unknown as RegisterInstanceResult;
  }

  /**
   * Deregister a ticket instance.
   * DELETE /api/tickets/instances/:instanceId
   */
  async deregisterInstance(instanceId: string): Promise<void> {
    const url = `${this.panelUrl}/api/tickets/instances/${encodeURIComponent(instanceId)}`;
    this.logger.debug({ instanceId }, 'Deregistering ticket instance');

    const response = await fetch(url, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10_000),
      dispatcher: this.dispatcher,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new TicketHttpError(
        `Failed to deregister instance: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
        response.status,
      );
    }
  }

  /**
   * Send a heartbeat for a registered instance.
   * POST /api/tickets/instances/:instanceId/heartbeat
   */
  async sendInstanceHeartbeat(instanceId: string): Promise<void> {
    const url = `${this.panelUrl}/api/tickets/instances/${encodeURIComponent(instanceId)}/heartbeat`;
    this.logger.debug({ instanceId }, 'Sending instance heartbeat');

    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      dispatcher: this.dispatcher,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new TicketHttpError(
        `Instance heartbeat failed: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
        response.status,
      );
    }
  }

  /**
   * Request a ticket for a target agent to access an instance.
   * POST /api/tickets
   */
  async requestTicket(
    scope: string,
    instanceId: string,
    target: string,
  ): Promise<RequestTicketResult> {
    const url = `${this.panelUrl}/api/tickets`;
    this.logger.debug({ scope, instanceId, target }, 'Requesting ticket');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, instanceId, target }),
      signal: AbortSignal.timeout(30_000),
      dispatcher: this.dispatcher,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new TicketHttpError(
        `Failed to request ticket: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
        response.status,
      );
    }

    const data: unknown = await response.json();
    assertObject(data, 'requestTicket response');
    assertField(data, 'ticket', 'object', 'requestTicket response');
    return data as unknown as RequestTicketResult;
  }

  // -------------------------------------------------------------------------
  // Target-side: Ticket inbox, validation, sessions
  // -------------------------------------------------------------------------

  /**
   * Fetch the ticket inbox for this agent.
   * GET /api/tickets/inbox
   */
  async fetchInbox(): Promise<readonly TicketInboxEntry[]> {
    const url = `${this.panelUrl}/api/tickets/inbox`;
    this.logger.debug('Fetching ticket inbox');

    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
      dispatcher: this.dispatcher,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new TicketHttpError(
        `Failed to fetch ticket inbox: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
        response.status,
      );
    }

    const data: unknown = await response.json();
    assertObject(data, 'fetchInbox response');
    assertField(data, 'tickets', 'array', 'fetchInbox response');
    return (data as unknown as { tickets: readonly TicketInboxEntry[] }).tickets;
  }

  /**
   * Validate a ticket. Marks the ticket as used (cannot be validated again).
   * POST /api/tickets/validate
   */
  async validateTicket(ticketId: string): Promise<TicketValidationResult> {
    const url = `${this.panelUrl}/api/tickets/validate`;
    this.logger.debug('Validating ticket');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId }),
      signal: AbortSignal.timeout(10_000),
      dispatcher: this.dispatcher,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new TicketHttpError(
        `Failed to validate ticket: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
        response.status,
      );
    }

    const data: unknown = await response.json();
    assertObject(data, 'validateTicket response');
    assertField(data, 'valid', 'boolean', 'validateTicket response');
    return data as unknown as TicketValidationResult;
  }

  /**
   * Report a new session after ticket validation.
   * The server generates the session ID.
   * POST /api/tickets/sessions
   */
  async reportSessionCreation(ticketId: string): Promise<{ ok: boolean; session: SessionInfo }> {
    const url = `${this.panelUrl}/api/tickets/sessions`;
    this.logger.debug('Reporting session creation');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId }),
      signal: AbortSignal.timeout(10_000),
      dispatcher: this.dispatcher,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new TicketHttpError(
        `Failed to report session creation: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
        response.status,
      );
    }

    const data: unknown = await response.json();
    assertObject(data, 'reportSessionCreation response');
    assertField(data, 'session', 'object', 'reportSessionCreation response');
    return data as unknown as { ok: boolean; session: SessionInfo };
  }

  /**
   * Send a session heartbeat. Re-validates authorization.
   * POST /api/tickets/sessions/:sessionId/heartbeat
   */
  async sendSessionHeartbeat(sessionId: string): Promise<SessionHeartbeatResult> {
    const url = `${this.panelUrl}/api/tickets/sessions/${encodeURIComponent(sessionId)}/heartbeat`;
    this.logger.debug({ sessionId }, 'Sending session heartbeat');

    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      dispatcher: this.dispatcher,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new TicketHttpError(
        `Session heartbeat failed: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
        response.status,
      );
    }

    const data: unknown = await response.json();
    assertObject(data, 'sessionHeartbeat response');
    return data as unknown as SessionHeartbeatResult;
  }

  /**
   * Update session status (e.g., grace period on temporary disconnection).
   * PATCH /api/tickets/sessions/:sessionId
   */
  async updateSessionStatus(sessionId: string, status: 'active' | 'grace'): Promise<void> {
    const url = `${this.panelUrl}/api/tickets/sessions/${encodeURIComponent(sessionId)}`;
    this.logger.debug({ sessionId, status }, 'Updating session status');

    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
      signal: AbortSignal.timeout(10_000),
      dispatcher: this.dispatcher,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new TicketHttpError(
        `Failed to update session status: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
        response.status,
      );
    }
  }
}
