/**
 * DigitalOcean Spaces storage provider.
 *
 * Implements the StorageProvider interface using the S3-compatible Spaces API.
 * Bucket operations use AWS Signature V4 signing via s3sign.ts.
 *
 * Spaces regions are hardcoded because DigitalOcean does not expose a public
 * API to list them. The set changes infrequently.
 */

import { fetch } from 'undici';
import type { StorageProvider } from '../storage-provider.js';
import { BUCKET_NAME_REGEX, type StorageRegion } from '../types.js';
import { CloudError, CloudHttpError } from '../errors.js';
import { signS3Request } from './s3sign.js';

// ---------------------------------------------------------------------------
// Spaces regions (subset of DO compute regions, rarely changes)
// ---------------------------------------------------------------------------

const SPACES_REGIONS: readonly StorageRegion[] = [
  { slug: 'nyc3', name: 'New York 3', endpoint: 'https://nyc3.digitaloceanspaces.com' },
  { slug: 'sfo3', name: 'San Francisco 3', endpoint: 'https://sfo3.digitaloceanspaces.com' },
  { slug: 'ams3', name: 'Amsterdam 3', endpoint: 'https://ams3.digitaloceanspaces.com' },
  { slug: 'sgp1', name: 'Singapore 1', endpoint: 'https://sgp1.digitaloceanspaces.com' },
  { slug: 'fra1', name: 'Frankfurt 1', endpoint: 'https://fra1.digitaloceanspaces.com' },
  { slug: 'syd1', name: 'Sydney 1', endpoint: 'https://syd1.digitaloceanspaces.com' },
  { slug: 'blr1', name: 'Bangalore 1', endpoint: 'https://blr1.digitaloceanspaces.com' },
] as const;

const DEFAULT_TIMEOUT_MS = 30_000;

const BUCKET_REGEX = BUCKET_NAME_REGEX;

// ---------------------------------------------------------------------------
// S3 XML error parsing
// ---------------------------------------------------------------------------

/**
 * Extract the human-readable error from an S3 XML error response.
 *
 * S3 errors look like:
 * ```xml
 * <Error><Code>BucketNotEmpty</Code><Message>...</Message>...</Error>
 * ```
 *
 * Returns only the Code and Message to avoid leaking internal details
 * (RequestId, HostId, Resource).
 */
function parseS3Error(xml: string): string | null {
  const codeMatch = /<Code>(.*?)<\/Code>/s.exec(xml);
  const messageMatch = /<Message>(.*?)<\/Message>/s.exec(xml);
  if (!codeMatch) return null;
  const code = codeMatch[1]!;
  const message = messageMatch?.[1];
  return message ? `${code}: ${message}` : code;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertValidRegion(region: string): StorageRegion {
  const storageRegion = SPACES_REGIONS.find((r) => r.slug === region);
  if (!storageRegion) {
    throw new CloudError(`Unknown Spaces region: ${region}`);
  }
  return storageRegion;
}

function assertValidBucket(bucket: string): void {
  if (!BUCKET_REGEX.test(bucket)) {
    throw new CloudError(
      `Invalid bucket name "${bucket}" — must be 3-63 lowercase alphanumeric characters or hyphens`,
    );
  }
}

/**
 * Build a user-friendly error message from an S3 HTTP error response.
 * Parses the XML to extract Code/Message, falling back to the status code.
 */
async function s3ErrorMessage(
  response: { status: number; text(): Promise<string> },
  prefix: string,
): Promise<string> {
  const text = await response.text().catch(() => '');
  const parsed = text ? parseS3Error(text) : null;
  const detail = parsed ?? `HTTP ${response.status}`;
  return `${prefix}: ${detail}`;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class DigitalOceanSpacesProvider implements StorageProvider {
  readonly name = 'spaces';

  getRegions(): readonly StorageRegion[] {
    return SPACES_REGIONS;
  }

  /**
   * Validate Spaces credentials by listing buckets (GET /).
   * Throws CloudError on invalid credentials.
   */
  async validateCredentials(accessKey: string, secretKey: string): Promise<void> {
    // Use the first region endpoint for validation — credentials are global
    const region = SPACES_REGIONS[0]!;
    const url = new URL(region.endpoint);

    const headers = signS3Request('GET', url, accessKey, secretKey, region.slug);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Host: url.hostname,
        ...headers,
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (response.status === 403) {
      throw new CloudError('Invalid Spaces credentials — access denied');
    }

    if (!response.ok) {
      const message = await s3ErrorMessage(response, 'Spaces credential validation failed');
      throw new CloudHttpError(message, response.status);
    }
  }

  /**
   * Create a Spaces bucket via PUT /{bucket} (path-style URL).
   * Throws CloudError on 409 (bucket name taken).
   */
  async createBucket(options: {
    readonly region: string;
    readonly bucket: string;
    readonly accessKey: string;
    readonly secretKey: string;
  }): Promise<void> {
    const { region, bucket, accessKey, secretKey } = options;

    const storageRegion = assertValidRegion(region);
    assertValidBucket(bucket);

    const url = new URL(`/${bucket}`, storageRegion.endpoint);
    const headers = signS3Request('PUT', url, accessKey, secretKey, region);

    const response = await fetch(url.toString(), {
      method: 'PUT',
      headers: {
        Host: url.hostname,
        ...headers,
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (response.status === 409) {
      throw new CloudError(
        `Bucket "${bucket}" already exists or the name is taken by another account`,
      );
    }

    if (!response.ok) {
      const message = await s3ErrorMessage(
        response,
        `Failed to create Spaces bucket "${bucket}"`,
      );
      throw new CloudHttpError(message, response.status);
    }
  }

  /**
   * Delete a Spaces bucket via DELETE /{bucket} (path-style URL).
   *
   * Used for cleanup on provisioning failure and for user-initiated
   * storage server destruction. The bucket must be empty — S3 returns
   * 409 BucketNotEmpty otherwise.
   */
  async deleteBucket(options: {
    readonly region: string;
    readonly bucket: string;
    readonly accessKey: string;
    readonly secretKey: string;
  }): Promise<void> {
    const { region, bucket, accessKey, secretKey } = options;

    const storageRegion = assertValidRegion(region);
    assertValidBucket(bucket);

    const url = new URL(`/${bucket}`, storageRegion.endpoint);
    const headers = signS3Request('DELETE', url, accessKey, secretKey, region);

    const response = await fetch(url.toString(), {
      method: 'DELETE',
      headers: {
        Host: url.hostname,
        ...headers,
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (response.status === 409) {
      throw new CloudError(
        `Cannot delete bucket "${bucket}" — the bucket is not empty. ` +
          'Remove all objects before deleting.',
      );
    }

    if (!response.ok) {
      const message = await s3ErrorMessage(
        response,
        `Failed to delete Spaces bucket "${bucket}"`,
      );
      throw new CloudHttpError(message, response.status);
    }
  }
}
