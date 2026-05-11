// Types
export type {
  IdentityLogger,
  PemCertConfig,
  P12CertConfig,
  IdentityCertConfig,
  AutheliaIdentity,
  IdentityParseError,
  IdentityParseResult,
  UserMetadata,
} from './types.js';

export { IdentityHttpError } from './types.js';

// Parser
export { parseIdentity, hasGroup, isIdentityParseError } from './parser.js';

// Dispatcher factory
export { createIdentityDispatcher } from './client.js';
export type { CreateIdentityDispatcherOptions } from './client.js';

// Client
export { IdentityClient } from './client.js';
export type { IdentityClientOptions } from './client.js';
