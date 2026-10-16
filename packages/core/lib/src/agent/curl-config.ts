/**
 * Curl config files (`-K`) carry an agent's P12 password to curl without
 * putting it in curl's arguments. They are written as
 * `.curl-config-<random>.tmp` (0600, exclusively) next to the agent's data
 * and removed when the request ends; a crash can leave one behind, so the
 * agent's programs sweep them on start.
 *
 * Only files older than {@link CURL_CONFIG_STALE_MS} go. curl reads its
 * config the moment it starts, but the directory is shared — a second
 * `lamaste-agent`, the agent daemon and the desktop app all write there —
 * and a sweep that took every file would delete one another process has
 * just written and not yet handed to curl.
 */

import { lstatSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

/** Older than any curl start, however loaded the machine. */
export const CURL_CONFIG_STALE_MS = 5 * 60_000;

const CURL_CONFIG_PREFIX = '.curl-config-';
const CURL_CONFIG_SUFFIX = '.tmp';

/**
 * Remove the curl config files in `dir` that are older than
 * {@link CURL_CONFIG_STALE_MS}. Best effort and synchronous (the files are
 * tiny, and it runs once at start): a missing directory, a file that went
 * away meanwhile or one that cannot be removed is left as it is.
 */
export function sweepStaleCurlConfigs(dir: string, now: number = Date.now()): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(CURL_CONFIG_PREFIX) || !entry.endsWith(CURL_CONFIG_SUFFIX)) continue;
    const filePath = path.join(dir, entry);
    try {
      const info = lstatSync(filePath);
      if (now - info.mtimeMs < CURL_CONFIG_STALE_MS) continue;
      unlinkSync(filePath);
    } catch {
      // Gone already, or not ours to remove — either way, nothing to do.
    }
  }
}
