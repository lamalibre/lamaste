// Types
export type {
  TicketLogger,
  PemCertConfig,
  P12CertConfig,
  TicketCertConfig,
  TransportStrategy,
  TransportConfig,
  TransportInfo,
  RegisterInstanceResult,
  TicketInboxEntry,
  RequestTicketResult,
  TicketValidationResult,
  SessionStatus,
  TerminationReason,
  SessionInfo,
  SessionHeartbeatResult,
} from './types.js';

// Error class
export { TicketHttpError } from './types.js';

// Dispatcher factory
export { createTicketDispatcher } from './client.js';
export type { CreateTicketDispatcherOptions } from './client.js';

// Client
export { TicketClient } from './client.js';
export type { TicketClientOptions } from './client.js';

// Session Manager (target side)
export { TicketSessionManager } from './session-manager.js';
export type { SessionState, TicketSessionManagerOptions } from './session-manager.js';

// Instance Manager (source side)
export { TicketInstanceManager } from './instance-manager.js';
export type { TicketInstanceManagerOptions } from './instance-manager.js';
