/**
 * Types for the Lamaste identity system SDK.
 *
 * The identity system provides Authelia identity header parsing and
 * user metadata queries against the panel API.
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
export interface IdentityLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  info(msg: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  error(msg: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
  debug(msg: string): void;
  child(bindings: Record<string, unknown>): IdentityLogger;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * HTTP error from the panel identity API.
 *
 * Carries the HTTP status code so callers can distinguish retriable
 * errors (503) from permanent ones (404).
 */
export class IdentityHttpError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'IdentityHttpError';
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
 * PEM: used by plugins that receive extracted cert/key/ca files.
 * P12: used by agents and servers that have the original .p12 bundle.
 */
export type IdentityCertConfig = PemCertConfig | P12CertConfig;

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Parsed Authelia identity from forwarded request headers.
 *
 * Authelia sets `Remote-User`, `Remote-Name`, `Remote-Email`, and
 * `Remote-Groups` headers on authenticated requests.
 */
export interface AutheliaIdentity {
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly groups: string[];
}

/** Parse error returned when identity headers are malformed. */
export interface IdentityParseError {
  readonly error: true;
  readonly message: string;
}

/**
 * Result of parsing identity headers.
 *
 * - `null` — no identity headers present (unauthenticated request)
 * - `IdentityParseError` — headers present but malformed
 * - `AutheliaIdentity` — successfully parsed identity
 */
export type IdentityParseResult = AutheliaIdentity | IdentityParseError | null;

// ---------------------------------------------------------------------------
// User metadata
// ---------------------------------------------------------------------------

/**
 * User metadata from the panel's identity API.
 *
 * Matches the shape returned by the panel's `readUsers()` function.
 */
export interface UserMetadata {
  readonly username: string;
  readonly displayname: string;
  readonly email: string;
  readonly groups: string[];
}
