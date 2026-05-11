/**
 * Storage provider interface.
 *
 * Each storage provider (DigitalOcean Spaces, AWS S3, etc.) implements this
 * interface to provide a unified API for object storage provisioning.
 * This is a sibling to CloudProvider — storage has a separate lifecycle
 * from compute resources.
 */

import type { StorageRegion } from './types.js';

export interface StorageProvider {
  /** Provider identifier (e.g. "spaces", "s3"). */
  readonly name: string;

  /**
   * Validate that the provided credentials can access the storage API.
   * Throws CloudError on invalid credentials.
   */
  validateCredentials(accessKey: string, secretKey: string): Promise<void>;

  /** List available storage regions. */
  getRegions(): readonly StorageRegion[];

  /** Create a storage bucket. Throws on conflict (bucket already exists). */
  createBucket(options: {
    readonly region: string;
    readonly bucket: string;
    readonly accessKey: string;
    readonly secretKey: string;
  }): Promise<void>;

  /** Delete a storage bucket. Used for cleanup on provisioning failure and user-initiated destruction. */
  deleteBucket(options: {
    readonly region: string;
    readonly bucket: string;
    readonly accessKey: string;
    readonly secretKey: string;
  }): Promise<void>;
}
