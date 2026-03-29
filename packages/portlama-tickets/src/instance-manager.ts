/**
 * Source-side ticket instance and lifecycle manager.
 *
 * When a plugin's server runs as a Portlama plugin, the TicketInstanceManager
 * handles the source-side of the ticket lifecycle:
 *
 * 1. Read mTLS certificates and create an undici dispatcher
 * 2. Register a ticket instance for the configured scope
 * 3. Heartbeat the instance periodically to stay active
 * 4. Request tickets for target agents (with cooldown)
 *
 * The manager delegates all HTTP calls to a TicketClient, eliminating
 * raw fetch duplication.
 */

import type { Agent as UndiciAgent } from 'undici';
import { TicketClient, createTicketDispatcher } from './client.js';
import { TicketHttpError } from './types.js';
import type { TicketLogger, TicketCertConfig, TransportConfig } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TicketInstanceManagerOptions {
  /** Panel base URL. */
  readonly panelUrl: string;
  /** mTLS certificate configuration (PEM or P12). */
  readonly certs: TicketCertConfig;
  /** Ticket scope to register (e.g., 'sync:connect'). */
  readonly scope: string;
  /** Transport configuration for the registered instance. */
  readonly transport: TransportConfig;
  readonly logger: TicketLogger;
  /**
   * Verify the panel's TLS server certificate.
   * Default: false (panel uses a self-signed server cert).
   */
  readonly rejectUnauthorized?: boolean;

  // Timing overrides (all in ms)
  /** Instance heartbeat interval. Default: 60000. */
  readonly instanceHeartbeatIntervalMs?: number;
  /** Minimum interval between ticket requests for the same agent. Default: 120000. */
  readonly ticketCooldownMs?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_INSTANCE_HEARTBEAT_INTERVAL_MS = 60_000;
const DEFAULT_TICKET_COOLDOWN_MS = 120_000;

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class TicketInstanceManager {
  private readonly panelUrl: string;
  private readonly certs: TicketCertConfig;
  private readonly scope: string;
  private readonly transport: TransportConfig;
  private readonly logger: TicketLogger;
  private readonly rejectUnauthorized: boolean;
  private readonly instanceHeartbeatIntervalMs: number;
  private readonly ticketCooldownMs: number;

  private dispatcher: UndiciAgent | null = null;
  private client: TicketClient | null = null;
  private instanceId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /**
   * Tracks the last time a ticket was requested for each agent label.
   * Used to enforce a cooldown period between requests to avoid exhausting
   * the panel's global ticket cap.
   */
  private readonly lastTicketRequest = new Map<string, number>();

  constructor(options: TicketInstanceManagerOptions) {
    this.panelUrl = options.panelUrl.endsWith('/')
      ? options.panelUrl.replace(/\/+$/, '')
      : options.panelUrl;
    this.certs = options.certs;
    this.scope = options.scope;
    this.transport = options.transport;
    this.logger = options.logger.child({ component: 'ticket-instance-manager' });
    this.rejectUnauthorized = options.rejectUnauthorized ?? false;
    this.instanceHeartbeatIntervalMs =
      options.instanceHeartbeatIntervalMs ?? DEFAULT_INSTANCE_HEARTBEAT_INTERVAL_MS;
    this.ticketCooldownMs = options.ticketCooldownMs ?? DEFAULT_TICKET_COOLDOWN_MS;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start the instance manager.
   * Reads certificates, registers the instance, and begins heartbeating.
   */
  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    this.logger.info({ scope: this.scope }, 'Starting ticket instance manager');

    // Read certificates and create mTLS dispatcher
    this.dispatcher = (await createTicketDispatcher({
      certs: this.certs,
      rejectUnauthorized: this.rejectUnauthorized,
    })) as UndiciAgent;

    this.client = new TicketClient({
      panelUrl: this.panelUrl,
      dispatcher: this.dispatcher,
      logger: this.logger,
    });

    // Register the instance
    try {
      const result = await this.client.registerInstance(this.scope, this.transport);
      this.instanceId = result.instanceId;
      this.logger.info(
        { instanceId: this.instanceId, instanceScope: result.instanceScope },
        'Ticket instance registered',
      );
    } catch (err: unknown) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Failed to register ticket instance — tickets will not be available',
      );
      // Clean up dispatcher allocated above to avoid leaking open sockets.
      // Null-safe: stop() may have already closed and nulled the dispatcher.
      await this.dispatcher?.close();
      this.dispatcher = null;
      this.client = null;
      this.running = false;
      return;
    }

    // Guard against concurrent stop() during the await above.
    // If stop() ran while registerInstance() was in flight, clean up and bail.
    if (!this.running) {
      this.instanceId = null;
      await this.dispatcher?.close();
      this.dispatcher = null;
      this.client = null;
      return;
    }

    // Start instance heartbeat
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, this.instanceHeartbeatIntervalMs);

    this.logger.info('Ticket instance manager started');
  }

  /**
   * Stop the instance manager.
   */
  async stop(): Promise<void> {
    // Allow stop() to clean up even if start() failed partway through,
    // so a leaked dispatcher is still closed.
    if (!this.running && !this.dispatcher) return;

    this.running = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Deregister the instance from the panel so it is immediately
    // removed rather than lingering until the heartbeat timeout.
    if (this.client && this.instanceId) {
      try {
        await this.client.deregisterInstance(this.instanceId);
      } catch (err: unknown) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'Failed to deregister instance on shutdown',
        );
      }
    }

    if (this.dispatcher) {
      await this.dispatcher.close();
      this.dispatcher = null;
    }

    this.client = null;
    this.instanceId = null;
    this.logger.info('Ticket instance manager stopped');
  }

  /** Whether the instance manager has a registered instance. */
  isReady(): boolean {
    return this.running && this.instanceId !== null;
  }

  /** The registered instance ID (null if not registered). */
  getInstanceId(): string | null {
    return this.instanceId;
  }

  /** The underlying TicketClient (null before start). */
  getClient(): TicketClient | null {
    return this.client;
  }

  // -------------------------------------------------------------------------
  // Public: Ticket operations
  // -------------------------------------------------------------------------

  /**
   * Request a ticket for a target agent, respecting a cooldown period.
   *
   * To avoid exhausting the panel's global ticket cap (1000), this method
   * enforces a minimum interval between requests for the same agent. Tickets
   * expire after 30s, so re-issuing more frequently than the cooldown is
   * wasteful.
   *
   * @param targetAgentLabel - The target agent's label
   * @param force - Skip the cooldown check (e.g., for initial registration)
   * @returns The ticket ID, or null if not ready or cooldown not elapsed
   */
  async requestTicketForAgent(targetAgentLabel: string, force = false): Promise<string | null> {
    if (!this.client || !this.instanceId) {
      this.logger.warn('Cannot request ticket: instance not registered');
      return null;
    }

    // Prune stale cooldown entries to prevent unbounded map growth
    if (this.lastTicketRequest.size > 100) {
      const cutoff = Date.now() - this.ticketCooldownMs;
      for (const [key, ts] of this.lastTicketRequest) {
        if (ts < cutoff) this.lastTicketRequest.delete(key);
      }
    }

    // Enforce cooldown to prevent ticket flooding
    if (!force) {
      const lastRequest = this.lastTicketRequest.get(targetAgentLabel);
      if (lastRequest !== undefined && Date.now() - lastRequest < this.ticketCooldownMs) {
        this.logger.debug(
          { target: targetAgentLabel },
          'Skipping ticket request — cooldown not elapsed',
        );
        return null;
      }
    }

    this.logger.info({ target: targetAgentLabel }, 'Requesting ticket for agent');

    try {
      const result = await this.client.requestTicket(this.scope, this.instanceId, targetAgentLabel);
      this.lastTicketRequest.set(targetAgentLabel, Date.now());
      this.logger.info(
        { target: targetAgentLabel, ticketId: result.ticket.id.slice(0, 8) + '...' },
        'Ticket requested successfully',
      );
      return result.ticket.id;
    } catch (err: unknown) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), target: targetAgentLabel },
        'Error requesting ticket for agent',
      );
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Private: Heartbeat
  // -------------------------------------------------------------------------

  private async sendHeartbeat(): Promise<void> {
    if (!this.client || !this.instanceId) return;

    try {
      await this.client.sendInstanceHeartbeat(this.instanceId);
    } catch (err: unknown) {
      const statusCode = err instanceof TicketHttpError ? err.statusCode : undefined;

      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), statusCode },
        'Instance heartbeat failed',
      );

      // If instance is gone (404), try to re-register
      if (statusCode === 404) {
        this.logger.info('Instance not found, attempting re-registration');
        try {
          const result = await this.client.registerInstance(this.scope, this.transport);
          this.instanceId = result.instanceId;
          this.logger.info({ instanceId: this.instanceId }, 'Instance re-registered');
        } catch (reregErr: unknown) {
          this.logger.error(
            { err: reregErr instanceof Error ? reregErr.message : String(reregErr) },
            'Failed to re-register instance',
          );
        }
      }
    }
  }
}
