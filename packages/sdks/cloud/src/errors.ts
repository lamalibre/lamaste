/**
 * Error types for cloud provisioning.
 */

/**
 * HTTP error from a cloud provider API.
 */
export class CloudHttpError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'CloudHttpError';
    this.statusCode = statusCode;
  }
}

/**
 * Token scope validation error — the token has missing or excess scopes.
 */
export class TokenScopeError extends Error {
  readonly missingScopes: readonly string[];
  readonly excessScopes: readonly string[];

  constructor(
    message: string,
    missingScopes: readonly string[],
    excessScopes: readonly string[],
  ) {
    super(message);
    this.name = 'TokenScopeError';
    this.missingScopes = missingScopes;
    this.excessScopes = excessScopes;
  }
}

/**
 * General cloud provisioning error.
 */
export class CloudError extends Error {
  readonly recoverable: boolean;

  constructor(message: string, recoverable = false) {
    super(message);
    this.name = 'CloudError';
    this.recoverable = recoverable;
  }
}
