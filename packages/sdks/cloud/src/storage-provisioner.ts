/**
 * Storage provisioner — orchestrates the create-storage-server flow.
 *
 * Reports progress via NDJSON on stdout so the Tauri desktop app
 * can read line-by-line and update the UI in real time.
 *
 * Maintains a cleanup stack so partially-created resources (buckets)
 * are rolled back on failure.
 */

import crypto from 'node:crypto';
import { writeFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import {
  BUCKET_NAME_REGEX,
  type StorageProvisionOptions,
  type StorageProvisionStep,
  type StorageProgressEvent,
  type StorageServerEntry,
} from './types.js';
import { CloudError, CloudHttpError } from './errors.js';
import { CleanupStack } from './cleanup.js';
import { DigitalOceanSpacesProvider } from './digitalocean/spaces.js';
import { addStorageServer } from './storage-registry.js';
import { LAMASTE_DIR } from '@lamalibre/lamaste/agent';

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const BUCKET_REGEX = BUCKET_NAME_REGEX;

const LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function validateStorageInputs(options: StorageProvisionOptions): void {
  if (!LABEL_REGEX.test(options.label)) {
    throw new CloudError(
      `Invalid label "${options.label}" — must be 1-63 lowercase alphanumeric characters or hyphens, ` +
        'starting and ending with a letter or digit',
    );
  }

  if (options.bucket !== undefined && !BUCKET_REGEX.test(options.bucket)) {
    throw new CloudError(
      `Invalid bucket name "${options.bucket}" — must be 3-63 lowercase alphanumeric characters or hyphens, ` +
        'starting and ending with a letter or digit',
    );
  }
}

// ---------------------------------------------------------------------------
// Progress reporting
// ---------------------------------------------------------------------------

function emit(event: StorageProgressEvent): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

function emitStep(
  step: StorageProvisionStep,
  status: 'running' | 'done',
  data?: Record<string, unknown>,
): void {
  emit({ event: 'step', step, status, ...(data ? { data } : {}) });
}

function emitError(
  step: StorageProvisionStep,
  message: string,
  recoverable: boolean,
): void {
  emit({ event: 'error', step, message, recoverable });
}

/**
 * Extract a safe error message for NDJSON output.
 *
 * Only forwards `.message` from known error types (CloudError, CloudHttpError).
 * Unknown errors get a generic message — the real details go to stderr so they
 * don't leak internal info through the NDJSON channel consumed by the UI.
 */
function safeErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof CloudError || err instanceof CloudHttpError) {
    return err.message;
  }
  // Log the real error to stderr for debugging, emit generic message to stdout
  process.stderr.write(`[lamaste-cloud] ${fallback}: ${err instanceof Error ? err.message : String(err)}\n`);
  return fallback;
}

// ---------------------------------------------------------------------------
// File lock (separate from compute provisioner lock)
// ---------------------------------------------------------------------------

const LOCK_PATH = join(LAMASTE_DIR, '.storage-provisioning.lock');

async function acquireLock(): Promise<void> {
  await mkdir(LAMASTE_DIR, { recursive: true, mode: 0o700 });

  try {
    await writeFile(LOCK_PATH, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // Check if the lock holder is still running
      try {
        const lockContent = await readFile(LOCK_PATH, 'utf-8');
        const lockedPid = parseInt(lockContent.trim(), 10);
        if (!isNaN(lockedPid)) {
          try {
            process.kill(lockedPid, 0);
            // Process is still running — lock is valid
          } catch {
            // Stale lock — remove and retry once
            await unlink(LOCK_PATH).catch(() => {});
            try {
              await writeFile(LOCK_PATH, `${process.pid}\n`, {
                flag: 'wx',
                mode: 0o600,
              });
              return;
            } catch {
              // Another process grabbed it between our unlink and write
            }
          }
        }
      } catch {
        // Can't read lock — treat as valid
      }

      throw new CloudError(
        'Another storage provisioning operation is in progress. ' +
          `If this is an error, delete ${LOCK_PATH}`,
      );
    }
    throw err;
  }
}

async function releaseLock(): Promise<void> {
  await unlink(LOCK_PATH).catch(() => {});
}

// ---------------------------------------------------------------------------
// Provisioner
// ---------------------------------------------------------------------------

/**
 * Provision a storage server (Spaces bucket).
 *
 * Steps:
 *   1. validate_credentials — verify the Spaces access key works
 *   2. create_bucket — create the bucket in the selected region
 *   3. save_registry — persist the storage server entry
 */
export async function provisionStorage(
  options: StorageProvisionOptions,
): Promise<StorageServerEntry> {
  validateStorageInputs(options);
  await acquireLock();

  const cleanup = new CleanupStack();

  try {
    const { provider, accessKey, secretKey, region, label } = options;

    // Resolve provider implementation
    if (provider !== 'spaces') {
      throw new CloudError(`Unsupported storage provider: ${provider}`);
    }
    const spacesProvider = new DigitalOceanSpacesProvider();

    // Validate the region is known
    const storageRegion = spacesProvider.getRegions().find((r) => r.slug === region);
    if (!storageRegion) {
      throw new CloudError(
        `Unknown Spaces region "${region}". ` +
          `Available: ${spacesProvider.getRegions().map((r) => r.slug).join(', ')}`,
      );
    }

    // Step 1: Validate credentials
    emitStep('validate_credentials', 'running');
    try {
      await spacesProvider.validateCredentials(accessKey, secretKey);
    } catch (err: unknown) {
      emitError('validate_credentials', safeErrorMessage(err, 'Credential validation failed'), false);
      throw err;
    }
    emitStep('validate_credentials', 'done');

    // Step 2: Create bucket
    const bucket =
      options.bucket ??
      `lamaste-${label}-${crypto.randomBytes(4).toString('hex')}`;

    if (!BUCKET_REGEX.test(bucket)) {
      throw new CloudError(
        `Generated bucket name "${bucket}" is invalid — ` +
          'try a shorter label (max 45 characters)',
      );
    }

    emitStep('create_bucket', 'running', { bucket, region });
    try {
      await spacesProvider.createBucket({ region, bucket, accessKey, secretKey });
    } catch (err: unknown) {
      emitError('create_bucket', safeErrorMessage(err, 'Bucket creation failed'), false);
      throw err;
    }

    // Register cleanup: delete bucket on subsequent failure
    cleanup.push('delete bucket', () =>
      spacesProvider.deleteBucket({ region, bucket, accessKey, secretKey }),
    );

    emitStep('create_bucket', 'done', { bucket, region });

    // Step 3: Save to registry
    emitStep('save_registry', 'running');
    const entry: StorageServerEntry = {
      id: crypto.randomUUID(),
      label,
      provider,
      region,
      bucket,
      endpoint: storageRegion.endpoint,
      createdAt: new Date().toISOString(),
    };

    try {
      await addStorageServer(entry);
    } catch (err: unknown) {
      emitError('save_registry', safeErrorMessage(err, 'Failed to save registry'), false);
      throw err;
    }
    emitStep('save_registry', 'done');

    // Success — clear cleanup so bucket is not deleted
    cleanup.clear();

    emit({ event: 'complete', storageServer: entry });
    return entry;
  } catch (err: unknown) {
    // Roll back any created resources
    const cleanupResult = await cleanup.runAll();
    if (!cleanupResult.ok) {
      emit({ event: 'cleanup-failed', resources: cleanupResult.failures });
    }
    throw err;
  } finally {
    await releaseLock();
  }
}
