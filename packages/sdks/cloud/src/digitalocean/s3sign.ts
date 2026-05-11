/**
 * Minimal AWS Signature V4 signing for S3-compatible APIs.
 *
 * Currently used for empty-body bucket operations (ListBuckets, CreateBucket,
 * DeleteBucket). The payload hash is hardcoded to the SHA-256 of an empty
 * string — callers that need to sign request bodies must extend this module.
 *
 * Uses only node:crypto (no external dependencies).
 */

import { createHmac, createHash } from 'node:crypto';

/** SHA-256 hash of an empty string — used as payload hash for all our operations. */
const EMPTY_PAYLOAD_HASH =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const SERVICE = 's3';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf-8').digest();
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

/**
 * Derive the AWS Sig V4 signing key.
 *
 * kSecret  → kDate → kRegion → kService → kSigning
 */
function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, SERVICE);
  return hmacSha256(kService, 'aws4_request');
}

/**
 * Format a Date as an ISO 8601 basic timestamp (e.g. "20260330T120000Z").
 *
 * Relies on `Date.toISOString()` always returning "YYYY-MM-DDTHH:mm:ss.sssZ".
 */
function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Extract the date stamp from an AMZ date (e.g. "20260330").
 */
function toDateStamp(amzDate: string): string {
  return amzDate.slice(0, 8);
}

/**
 * Build the canonical query string from URL search parameters.
 *
 * Per AWS Sig V4 spec: parameters are URI-encoded, sorted by key name,
 * then joined with "&". Returns an empty string if there are no parameters.
 */
function canonicalQueryString(url: URL): string {
  if (url.searchParams.size === 0) return '';

  // Defensive copy — sort() mutates in place
  const sorted = new URLSearchParams(url.searchParams);
  sorted.sort();

  const params: string[] = [];
  sorted.forEach((value, key) => {
    params.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    );
  });
  return params.join('&');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sign an S3 request using AWS Signature V4.
 *
 * Returns the headers that must be merged into the request. The caller should
 * include these headers (along with Host) in the outgoing HTTP request.
 *
 * Only supports requests with empty bodies — the payload hash is hardcoded
 * to the SHA-256 of an empty string.
 */
export function signS3Request(
  method: string,
  url: URL,
  accessKey: string,
  secretKey: string,
  region: string,
): Record<string, string> {
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(amzDate);
  const host = url.hostname;
  const path = url.pathname || '/';

  // Signed headers (alphabetically sorted)
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  // Canonical headers (must end with newline)
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${EMPTY_PAYLOAD_HASH}\n` +
    `x-amz-date:${amzDate}\n`;

  // Canonical request
  const canonicalRequest = [
    method,
    path,
    canonicalQueryString(url),
    canonicalHeaders,
    signedHeaders,
    EMPTY_PAYLOAD_HASH,
  ].join('\n');

  // String to sign
  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  // Signature
  const signingKey = getSignatureKey(secretKey, dateStamp, region);
  const signature = hmacSha256(signingKey, stringToSign).toString('hex');

  // Authorization header
  const authorization =
    `AWS4-HMAC-SHA256 ` +
    `Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`;

  return {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': EMPTY_PAYLOAD_HASH,
    Authorization: authorization,
  };
}
