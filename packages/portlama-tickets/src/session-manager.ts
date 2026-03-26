/**
 * Ticket session lifecycle manager (target side).
 *
 * In Portlama plugin mode, the target agent must obtain a valid ticket
 * session before performing operations. This manager handles the full
 * lifecycle:
 *
 * 1. Poll the ticket inbox for tickets matching the configured scope
 * 2. Validate incoming tickets
 * 3. Create a session from the validated ticket
 * 4. Heartbeat the session periodically
 * 5. Handle authorization revocation (pause operations)
 * 6. Re-acquire sessions after revocation or expiry
 *
 * The consuming plugin gates its operations on `isAuthorized()`.
 */

import type { TicketClient } from './client.js';
import type {
  TicketLogger,
  TicketInboxEntry,
  SessionInfo,
  TerminationReason,
} from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionState =
  | 'waiting'       // No session, polling inbox
  | 'authorized'    // Active session, operations permitted
  | 'grace'         // Temporary disconnection, awaiting reconnect
  | 'terminated'    // Session terminated, need new ticket
  | 'stopped';      // Manager stopped

export interface TicketSessionManagerOptions {
  readonly ticketClient: TicketClient;
  /** Ticket scope to accept (e.g., 'sync:connect', 'shell:connect'). */
  readonly scope: string;
  readonly logger: TicketLogger;
  /**
   * Called when session state changes. The plugin uses this to
   * start/pause/stop its operations.
   */
  readonly onStateChange?: (state: SessionState, reason?: TerminationReason) => void;

  // Timing overrides (all in ms) — defaults match the sync-agent values
  /** How often to poll the ticket inbox. Default: 3000. */
  readonly inboxPollIntervalMs?: number;
  /** How often to send session heartbeats. Default: 60000. */
  readonly sessionHeartbeatIntervalMs?: number;
  /** Delay before retrying after a failed inbox poll. Default: 10000. */
  readonly inboxRetryDelayMs?: number;
  /** Max consecutive heartbeat failures before force-termination. Default: 5. */
  readonly maxConsecutiveHeartbeatFailures?: number;
  /** Minimum remaining TTL for a ticket to be worth processing. Default: 5000. */
  readonly minTicketTtlMs?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_INBOX_POLL_INTERVAL_MS = 3_000;
const DEFAULT_SESSION_HEARTBEAT_INTERVAL_MS = 60_000;
const DEFAULT_INBOX_RETRY_DELAY_MS = 10_000;
const DEFAULT_MAX_CONSECUTIVE_HEARTBEAT_FAILURES = 5;
const DEFAULT_MIN_TICKET_TTL_MS = 5_000;

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class TicketSessionManager {
  private readonly client: TicketClient;
  private readonly scope: string;
  private readonly logger: TicketLogger;
  private readonly onStateChange?: (state: SessionState, reason?: TerminationReason) => void;

  // Timing
  private readonly inboxPollIntervalMs: number;
  private readonly sessionHeartbeatIntervalMs: number;
  private readonly inboxRetryDelayMs: number;
  private readonly maxConsecutiveHeartbeatFailures: number;
  private readonly minTicketTtlMs: number;

  // State
  private state: SessionState = 'waiting';
  private sessionId: string | null = null;
  private sessionInfo: SessionInfo | null = null;
  private inboxPollTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private consecutiveHeartbeatFailures = 0;

  constructor(options: TicketSessionManagerOptions) {
    this.client = options.ticketClient;
    this.scope = options.scope;
    this.logger = options.logger.child({ component: 'ticket-session' });
    this.onStateChange = options.onStateChange;

    this.inboxPollIntervalMs = options.inboxPollIntervalMs ?? DEFAULT_INBOX_POLL_INTERVAL_MS;
    this.sessionHeartbeatIntervalMs = options.sessionHeartbeatIntervalMs ?? DEFAULT_SESSION_HEARTBEAT_INTERVAL_MS;
    this.inboxRetryDelayMs = options.inboxRetryDelayMs ?? DEFAULT_INBOX_RETRY_DELAY_MS;
    this.maxConsecutiveHeartbeatFailures = options.maxConsecutiveHeartbeatFailures ?? DEFAULT_MAX_CONSECUTIVE_HEARTBEAT_FAILURES;
    this.minTicketTtlMs = options.minTicketTtlMs ?? DEFAULT_MIN_TICKET_TTL_MS;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Whether the agent is currently authorized to perform operations. */
  isAuthorized(): boolean {
    return this.state === 'authorized';
  }

  /** Current session state. */
  getState(): SessionState {
    return this.state;
  }

  /** Current session ID (null if no active session). */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Current session info (null if no active session). */
  getSessionInfo(): SessionInfo | null {
    return this.sessionInfo;
  }

  /**
   * Start the ticket session manager.
   * Begins polling the inbox for tickets.
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.consecutiveHeartbeatFailures = 0;
    this.logger.info('Ticket session manager started, polling for tickets');
    this.setState('waiting');
    this.scheduleInboxPoll(0);
  }

  /**
   * Stop the ticket session manager.
   * Clears all timers and sets state to stopped.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    this.logger.info('Stopping ticket session manager');

    if (this.inboxPollTimer !== null) {
      clearTimeout(this.inboxPollTimer);
      this.inboxPollTimer = null;
    }
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Signal grace period if we have an active session
    if (this.sessionId && this.state === 'authorized') {
      try {
        await this.client.updateSessionStatus(this.sessionId, 'grace');
      } catch (err: unknown) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'Failed to signal grace period on shutdown',
        );
      }
    }

    this.setState('stopped');
    this.sessionId = null;
    this.sessionInfo = null;
  }

  // -------------------------------------------------------------------------
  // Private: State management
  // -------------------------------------------------------------------------

  private setState(newState: SessionState, reason?: TerminationReason): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;
    this.logger.info({ oldState, newState, reason }, 'Session state changed');

    this.onStateChange?.(newState, reason);
  }

  // -------------------------------------------------------------------------
  // Private: Inbox polling
  // -------------------------------------------------------------------------

  private scheduleInboxPoll(delayMs: number): void {
    if (!this.running) return;

    this.inboxPollTimer = setTimeout(() => {
      void this.pollInbox();
    }, delayMs);
  }

  private async pollInbox(): Promise<void> {
    if (!this.running) return;

    try {
      const tickets = await this.client.fetchInbox();
      const matchingTicket = this.findMatchingTicket(tickets);

      if (matchingTicket) {
        this.logger.info(
          { ticketId: matchingTicket.id.slice(0, 8) + '...', source: matchingTicket.source },
          `Received ${this.scope} ticket`,
        );
        await this.processTicket(matchingTicket);
        return; // Session established, heartbeat takes over
      }

      // No ticket yet, continue polling
      this.scheduleInboxPoll(this.inboxPollIntervalMs);
    } catch (err: unknown) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Failed to poll ticket inbox, retrying',
      );
      this.scheduleInboxPoll(this.inboxRetryDelayMs);
    }
  }

  /**
   * Find the best matching ticket in the inbox.
   *
   * Filters by scope, discards tickets that are about to expire, and
   * picks the one with the most remaining TTL so the agent has maximum
   * time to validate and create a session.
   */
  private findMatchingTicket(
    tickets: readonly TicketInboxEntry[],
  ): TicketInboxEntry | undefined {
    const now = Date.now();
    const candidates = tickets.filter((t) => {
      if (t.scope !== this.scope && !t.scope.startsWith(`${this.scope}:`)) {
        return false;
      }
      const ttl = new Date(t.expiresAt).getTime() - now;
      return ttl >= this.minTicketTtlMs;
    });

    if (candidates.length === 0) return undefined;

    // Pick the freshest (latest expiresAt) ticket
    return candidates.reduce((best, t) =>
      new Date(t.expiresAt).getTime() > new Date(best.expiresAt).getTime() ? t : best,
    );
  }

  // -------------------------------------------------------------------------
  // Private: Ticket processing
  // -------------------------------------------------------------------------

  private async processTicket(ticket: TicketInboxEntry): Promise<void> {
    try {
      const validation = await this.client.validateTicket(ticket.id);

      if (!this.running) return;

      if (!validation.valid) {
        this.logger.warn('Ticket validation returned invalid, resuming inbox poll');
        this.scheduleInboxPoll(this.inboxPollIntervalMs);
        return;
      }

      this.logger.info(
        { scope: validation.scope, source: validation.source, target: validation.target },
        'Ticket validated successfully',
      );

      const { session } = await this.client.reportSessionCreation(ticket.id);

      if (!this.running) return;

      this.sessionId = session.sessionId;
      this.sessionInfo = session;
      this.consecutiveHeartbeatFailures = 0;

      this.logger.info(
        { sessionId: session.sessionId, source: session.source, target: session.target },
        'Session created, agent is authorized',
      );

      this.setState('authorized');
      this.startSessionHeartbeat();
    } catch (err: unknown) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Failed to process ticket, resuming inbox poll',
      );
      this.scheduleInboxPoll(this.inboxRetryDelayMs);
    }
  }

  // -------------------------------------------------------------------------
  // Private: Session heartbeat
  // -------------------------------------------------------------------------

  private startSessionHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.consecutiveHeartbeatFailures = 0;

    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, this.sessionHeartbeatIntervalMs);
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.running || !this.sessionId) return;

    try {
      const result = await this.client.sendSessionHeartbeat(this.sessionId);

      if (!result.authorized) {
        this.logger.warn(
          { sessionId: this.sessionId, reason: result.reason },
          'Session authorization revoked',
        );
        this.handleTermination(result.reason);
        return;
      }

      this.consecutiveHeartbeatFailures = 0;
      if (this.state === 'grace') {
        this.setState('authorized');
      }
      this.logger.debug({ sessionId: this.sessionId }, 'Session heartbeat OK');
    } catch (err: unknown) {
      this.consecutiveHeartbeatFailures++;
      this.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          consecutiveFailures: this.consecutiveHeartbeatFailures,
        },
        'Session heartbeat failed',
      );

      if (this.state === 'authorized') {
        this.setState('grace');
        try {
          await this.client.updateSessionStatus(this.sessionId, 'grace');
        } catch (graceErr: unknown) {
          this.logger.debug(
            { err: graceErr instanceof Error ? graceErr.message : String(graceErr) },
            'Failed to report grace status to panel',
          );
        }
      }

      if (this.consecutiveHeartbeatFailures >= this.maxConsecutiveHeartbeatFailures) {
        this.logger.warn(
          { consecutiveFailures: this.consecutiveHeartbeatFailures },
          'Too many consecutive heartbeat failures — force-terminating session',
        );
        this.handleTermination();
      }
    }
  }

  private handleTermination(reason?: TerminationReason): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.consecutiveHeartbeatFailures = 0;
    this.sessionId = null;
    this.sessionInfo = null;

    // Emit 'terminated' with the reason, then transition to 'waiting' if
    // the manager is still running. Consumers should treat 'terminated' as
    // a transient notification — 'waiting' follows immediately.
    this.setState('terminated', reason);

    if (this.running) {
      this.logger.info('Resuming inbox poll for new ticket');
      // Defer the waiting transition so consumers can process termination first.
      // Use setTimeout (macrotask) rather than queueMicrotask to ensure
      // consumer-scheduled microtasks from the onStateChange callback complete first.
      setTimeout(() => {
        if (this.running && this.state === 'terminated') {
          this.setState('waiting');
          this.scheduleInboxPoll(this.inboxPollIntervalMs);
        }
      }, 0);
    }
  }
}
