/**
 * Types for the Lamaste ticket system SDK.
 *
 * The ticket system provides panel-mediated authorization between agents.
 * The source agent registers instances and requests tickets.
 * The target agent validates tickets and maintains sessions.
 */

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/**
 * Pino-compatible logger interface.
 *
 * Consumers pass any logger that satisfies this shape — pino, Fastify's
 * built-in logger, or a simple console wrapper all work.
 */
export interface TicketLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  info(msg: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  error(msg: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
  debug(msg: string): void;
  child(bindings: Record<string, unknown>): TicketLogger;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * HTTP error from the panel ticket API.
 *
 * Carries the HTTP status code so callers can distinguish retriable
 * errors (503) from permanent ones (404 for instance re-registration).
 */
export class TicketHttpError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TicketHttpError';
    this.statusCode = statusCode;
    // Ensure instanceof works across bundler/transpiler boundaries
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

/** PEM certificate configuration (cert + key + CA files). */
export interface PemCertConfig {
  readonly certPath: string;
  readonly keyPath: string;
  readonly caPath: string;
}

/** P12/PFX certificate configuration. */
export interface P12CertConfig {
  readonly p12Path: string;
  readonly p12Password: string;
}

/**
 * Certificate configuration for mTLS — PEM or P12.
 *
 * PEM: used by plugins that receive extracted cert/key/ca files (sync-server).
 * P12: used by agents and servers that have the original .p12 bundle (shell).
 */
export type TicketCertConfig = PemCertConfig | P12CertConfig;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/** Transport strategy for agent-to-agent connections. */
export type TransportStrategy = 'tunnel' | 'relay' | 'direct';

/** Transport configuration for ticket instances. */
export interface TransportConfig {
  readonly strategies: readonly TransportStrategy[];
  readonly preferred?: TransportStrategy;
  readonly direct?: {
    readonly host: string;
    readonly port: number;
  };
}

/**
 * Transport info returned by ticket inbox and validation.
 *
 * This is the instance-level transport (from registration), not the
 * scope-level transport (which also includes port and protocol).
 * The server passes the registering instance's transport verbatim.
 */
export interface TransportInfo {
  readonly strategies: readonly TransportStrategy[];
  readonly preferred?: TransportStrategy;
  readonly direct?: {
    readonly host: string;
    readonly port: number;
  };
}

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------

/** Response from registering a ticket instance. */
export interface RegisterInstanceResult {
  readonly ok: boolean;
  readonly instanceId: string;
  readonly instanceScope: string;
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

/** A ticket from the inbox. */
export interface TicketInboxEntry {
  readonly id: string;
  readonly scope: string;
  readonly instanceId: string;
  readonly source: string;
  readonly expiresAt: string;
  readonly transport: TransportInfo;
}

/** Response from requesting a ticket. */
export interface RequestTicketResult {
  readonly ok: boolean;
  readonly ticket: {
    readonly id: string;
    readonly scope: string;
    readonly instanceId: string;
    readonly source: string;
    readonly target: string;
    readonly expiresAt: string;
  };
}

/**
 * Discriminated reason for a denied ticket validation.
 *
 * The panel always returns the generic "Invalid ticket" HTTP error for the
 * caller; this type exists for the SDK consumer's logs only when (in a future
 * shape) the panel chooses to expose the reason via a 200/{valid:false} body
 * rather than a 401. Present here so logging code can be written defensively.
 */
export type TicketValidationDeniedReason =
  | 'not_found'
  | 'expired'
  | 'already_used'
  | 'source_mismatch'
  | 'target_mismatch'
  | 'scope_not_granted'
  | 'agent_revoked';

/** Result of validating a ticket. */
export interface TicketValidationResult {
  readonly valid: boolean;
  readonly scope: string;
  readonly instanceId: string;
  readonly source: string;
  readonly target: string;
  readonly transport: TransportInfo;
  /**
   * Server-supplied reason when `valid === false`. The current panel returns
   * 401 (no body) on denial, so this is only populated by future panel
   * versions that opt into structured denial responses.
   */
  readonly reason?: TicketValidationDeniedReason;
  /** Echoed ticket id (truncated) when the panel includes it on denial. */
  readonly ticketId?: string;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Session status. */
export type SessionStatus = 'active' | 'grace' | 'dead';

/** Reason for session termination. */
export type TerminationReason =
  | 'admin_killed'
  | 'source_revoked'
  | 'capability_removed'
  | 'target_revoked'
  | 'assignment_removed';

/** Session info returned when creating a session. */
export interface SessionInfo {
  readonly sessionId: string;
  readonly ticketId: string;
  readonly scope: string;
  readonly instanceId: string;
  readonly source: string;
  readonly target: string;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly status: SessionStatus;
  readonly reconnectGraceSeconds: number;
}

/** Response from session heartbeat. */
export interface SessionHeartbeatResult {
  readonly authorized: boolean;
  readonly reason?: TerminationReason;
}
