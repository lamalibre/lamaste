/**
 * Static site uploads as pure functions (no React): the files the panel
 * would refuse for their size, and the requests a selection is sent in.
 *
 * The limits and the batching mirror the core library's `site-upload`
 * module (`SITE_UPLOAD_MAX_FILE_BYTES`, `SITE_UPLOAD_MAX_REQUEST_BYTES`,
 * `planSiteUploadBatches`): a file may be at most 50 MiB — the panel refuses
 * a larger one (413) — and a request at most 64 MiB, which the panel vhosts'
 * upload location enforces (413 from nginx). A selection larger than one
 * request goes in several, one after another.
 */

const MIB = 1024 * 1024;

/** Largest file a site upload accepts, in bytes (core `SITE_UPLOAD_MAX_FILE_BYTES`). */
export const SITE_UPLOAD_MAX_FILE_BYTES = 50 * MIB;

/** Largest site upload request, in bytes (core `SITE_UPLOAD_MAX_REQUEST_BYTES`). */
export const SITE_UPLOAD_MAX_REQUEST_BYTES = 64 * MIB;

/** Each part's boundary and headers, and once per request the closing boundary with room to spare. */
const PART_FRAMING_BYTES = 4 * 1024;
const REQUEST_FRAMING_BYTES = 64 * 1024;

/** The files a site upload would refuse for their size. */
export function oversizedSiteUploads(files) {
  return files.filter((f) => f.size > SITE_UPLOAD_MAX_FILE_BYTES);
}

/**
 * Split files into upload requests, in order, each within the request limit
 * with its framing. A file over the file limit throws a `RangeError` — find
 * them first with {@link oversizedSiteUploads}.
 */
export function planSiteUploadBatches(files) {
  const budget = SITE_UPLOAD_MAX_REQUEST_BYTES - REQUEST_FRAMING_BYTES;
  const batches = [];
  let batch = [];
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

/**
 * Upload `files` in as many requests as the request limit needs, one after
 * another, with `upload(batch)` sending one (`POST /api/sites/:id/files`).
 * Resolves to one answer for the whole selection: every saved file, and the
 * site size warning of the last request that gave one. A failed request
 * stops the rest; its error says how many files were saved before it.
 */
export async function uploadSiteFilesInBatches(files, upload) {
  const saved = [];
  let warning;
  for (const batch of planSiteUploadBatches(files)) {
    let answer;
    try {
      answer = await upload(batch);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        saved.length > 0
          ? `${message} (${saved.length} of ${files.length} files were uploaded before it)`
          : message,
      );
    }
    saved.push(...(answer?.files ?? []));
    if (answer?.warning) warning = answer.warning;
  }
  return warning === undefined ? { ok: true, files: saved } : { ok: true, files: saved, warning };
}
