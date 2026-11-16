/**
 * A guarantee of the relay that holds outside the panel's own files (an
 * nginx site the installer writes, an http-level file, a vhost on disk) and
 * that the panel can only read: when a check finds it does not hold, the
 * administrators are told — audited and notified when it starts, again
 * every {@link REMIND_INTERVAL_MS} while it lasts, and again at once when
 * what is wrong changes; its return is audited. Shared by the HTTPS
 * catch-all (`lib/https-catch-all.js`) and the request-privacy check
 * (`lib/request-privacy.js`).
 */

import { listAudit, recordAuditBestEffort } from './audit.js';
import { notifyAdminsBestEffort } from './notifications.js';

/** How often the administrators are told again while a guarantee does not hold. */
export const REMIND_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * @template {string} S
 * @param {{
 *   okStatus: S,
 *   missingAction: string,
 *   restoredAction: string,
 *   logMessage: string,
 *   logFields?: Record<string, unknown>,
 *   level?: 'critical' | 'warning',
 *   message: (status: S, details: Record<string, unknown>) => string,
 * }} spec
 */
export function createRelayNotice(spec) {
  const { okStatus, missingAction, restoredAction, logMessage, level = 'critical' } = spec;
  /** @type {{ status: S | null, checkedAt: string | null, details: Record<string, unknown> }} */
  let current = { status: null, checkedAt: null, details: {} };
  let notifiedAt = 0;
  /** @type {string | null} */
  let notifiedKey = null;

  /**
   * Whether the guarantee was last recorded as broken: known in memory after
   * a check, otherwise (the first check since a start — a Panel Update
   * restarts the panel) from the audit log, so its return is audited however
   * it came back.
   */
  async function lastAuditedMissing(before, logger) {
    if (before !== null) return true;
    try {
      const [missing] = await listAudit({ action: missingAction, limit: 1 });
      if (!missing) return false;
      const [restored] = await listAudit({ action: restoredAction, limit: 1 });
      return !restored || restored.id < missing.id;
    } catch (err) {
      logger?.warn({ err: err?.message }, 'Could not read the audit log');
      return false;
    }
  }

  return {
    /**
     * Record a check's result; audit and notify as the module says. Never
     * throws.
     *
     * @param {S} status
     * @param {Record<string, unknown>} details - what is wrong (audited, in the
     *   notification); a change of it is a new start
     * @param {import('pino').Logger | undefined} logger
     * @param {number} now
     */
    async record(status, details, logger, now) {
      const before = current.status;
      current = { status, checkedAt: new Date(now).toISOString(), details };
      if (status === okStatus) {
        notifiedAt = 0;
        notifiedKey = null;
        if (before !== okStatus && (await lastAuditedMissing(before, logger))) {
          await recordAuditBestEffort(
            { actor: 'lamaste', action: restoredAction, details: { before: before ?? 'missing' } },
            logger,
          );
        }
        return;
      }
      const key = JSON.stringify({ status, details });
      if (key === notifiedKey && now - notifiedAt < REMIND_INTERVAL_MS) return;
      notifiedAt = now;
      notifiedKey = key;
      logger?.warn({ ...spec.logFields, status, ...details }, logMessage);
      await recordAuditBestEffort(
        { actor: 'lamaste', action: missingAction, details: { status, ...details } },
        logger,
      );
      await notifyAdminsBestEffort(
        { source: 'lamaste', level, message: spec.message(status, details) },
        logger,
      );
    },
    /** The last status, its details and when it was checked (null before the first check). */
    current() {
      return { ...current };
    },
    /** Forget what was checked and notified (tests). */
    reset() {
      current = { status: null, checkedAt: null, details: {} };
      notifiedAt = 0;
      notifiedKey = null;
    },
  };
}
