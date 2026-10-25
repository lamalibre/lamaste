/**
 * Static site uploads (`POST /api/sites/:id/files`) — the limits every party
 * to an upload agrees on, and the batching that keeps a client inside them.
 *
 * Two limits, enforced in two places:
 *
 * - A file may be at most {@link SITE_UPLOAD_MAX_FILE_BYTES}. The panel's
 *   multipart parser counts it; a larger file is refused (413) and nothing
 *   of it is kept.
 * - A request may be at most {@link SITE_UPLOAD_MAX_REQUEST_MIB} MiB, files
 *   and multipart framing together. The panel vhosts' upload location sets
 *   it as `client_max_body_size`; nginx refuses a larger request (413) before
 *   the panel sees it. Every other `/api` location keeps nginx's 1 MiB.
 *
 * The request limit is above the file limit, so any file the panel accepts
 * fits a request of its own. A client sending many files splits them with
 * {@link planSiteUploadBatches}.
 */

const MIB = 1024 * 1024;

/** Largest file a site upload accepts, in bytes (50 MiB). */
export const SITE_UPLOAD_MAX_FILE_BYTES = 50 * MIB;

/** Largest site upload request, in MiB — the upload location's `client_max_body_size`. */
export const SITE_UPLOAD_MAX_REQUEST_MIB = 64;

/** Largest site upload request, in bytes. */
export const SITE_UPLOAD_MAX_REQUEST_BYTES = SITE_UPLOAD_MAX_REQUEST_MIB * MIB;

/**
 * What a batch's framing is budgeted beyond its files' bytes: each part's
 * boundary and headers (a filename is at most 255 bytes, three times that
 * once a client percent-escapes it), and once per request the closing
 * boundary with room to spare.
 */
const PART_FRAMING_BYTES = 4 * 1024;
const REQUEST_FRAMING_BYTES = 64 * 1024;

/**
 * Split files into upload requests, in order, each within
 * {@link SITE_UPLOAD_MAX_REQUEST_BYTES} with its framing. A file larger than
 * {@link SITE_UPLOAD_MAX_FILE_BYTES} is a caller's error — find them first
 * with {@link oversizedSiteUploads} — and throws a `RangeError`.
 */
export function planSiteUploadBatches<T extends { size: number }>(files: readonly T[]): T[][] {
  const budget = SITE_UPLOAD_MAX_REQUEST_BYTES - REQUEST_FRAMING_BYTES;
  const batches: T[][] = [];
  let batch: T[] = [];
  let used = 0;
  for (const file of files) {
    if (file.size > SITE_UPLOAD_MAX_FILE_BYTES) {
      throw new RangeError(
        `A file of ${file.size} bytes exceeds the ${SITE_UPLOAD_MAX_FILE_BYTES}-byte site upload limit`,
      );
    }
    const cost = file.size + PART_FRAMING_BYTES;
    if (batch.length > 0 && used + cost > budget) {
      batches.push(batch);
      batch = [];
      used = 0;
    }
    batch.push(file);
    used += cost;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/** The files a site upload would refuse for their size. */
export function oversizedSiteUploads<T extends { size: number }>(files: readonly T[]): T[] {
  return files.filter((f) => f.size > SITE_UPLOAD_MAX_FILE_BYTES);
}
