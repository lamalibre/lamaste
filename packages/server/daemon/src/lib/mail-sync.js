/**
 * The relay's mail, carried to what depends on it
 * (packages/core/docs/mail-design.md §5): after every change of a
 * transport or sender, after a domain is activated or removed, and at
 * start —
 *
 * 1. the submission listener (lib/mail-submission.js) runs while the relay
 *    has a transport of its own, with its key material and Authelia's two
 *    files made or renewed — never while a tunnel holds its port (Q5:
 *    reported to the administrators, audited, the tunnel left alone) —
 *    and stops otherwise;
 * 2. Authelia's notifier submits to it while it runs (else the file
 *    notifier), and its one reset link is the primary's `/reset` while any
 *    active domain can send (else Authelia's reset is disabled) — written
 *    as the one writer of Authelia's configuration
 *    (`withDomainRendering`), Authelia restarted only when its
 *    configuration changed or a file it reads at start (the CA
 *    certificate, the submission password) was replaced;
 * 3. every active domain's auth vhost points "Reset password?" at the
 *    domain's own page or nowhere (lib/auth-branding.js).
 *
 * Each step is attempted whatever the one before did; what failed comes
 * back as `warnings` (and is retried at the next change or start).
 *
 * A port held by another program (`EADDRINUSE`) is often a moment's
 * matter — the panel's previous process still closing. The listener is
 * tried again every minute ({@link retrySubmissionListener}, on the
 * identity tick), and Authelia keeps submitting to it — its mail fails
 * meanwhile, Authelia says so to the user — until the port has been held
 * for {@link PORT_HELD_GRACE_MS}: only then is Authelia moved to its file
 * notifier (which restarts it) and the administrators told. A tunnel on
 * the port is refused at once, and never moved (Q5).
 */

import { MAIL_SUBMISSION_PORT, PromiseChainMutex } from '@lamalibre/lamaste';

import { listAudit, recordAuditBestEffort } from './audit.js';
import { convergeAuthVhosts } from './auth-branding.js';
import { reloadAuthelia, updateAutheliaMailSettings } from './authelia.js';
import { withDomainRendering } from './domains.js';
import {
  ensureSubmissionListener,
  ensureSubmissionMaterial,
  stopSubmissionListener,
} from './mail-submission.js';
import { resetLinkState, transportRow } from './mail-store.js';
import { notifyAdminsBestEffort } from './notifications.js';
import { readTunnels } from './state.js';
import { getStateDb } from './state-db.js';

/** One synchronisation at a time. */
const syncMutex = new PromiseChainMutex();

/** Why the listener last could not run (`tunnel` / `port_in_use` / `failed`), or null — reported once per streak. */
let listenerRefusal = null;

/**
 * Whether {@link listenerRefusal} was taken from the audit log yet. A streak
 * outlives the process (an operator moves a tunnel, then restarts the
 * panel): the first report of a process continues the streak the audit log
 * shows, so its end is still recorded and its start not announced twice.
 */
let listenerRefusalLoaded = false;

/** The streak the audit log shows: the reason of a last `mail.submission.refused`, else null. */
async function recordedListenerRefusal(logger) {
  try {
    const [last] = await listAudit({ action: 'mail.submission.', limit: 1 });
    return last?.action === 'mail.submission.refused' && typeof last.details?.reason === 'string'
      ? last.details.reason
      : null;
  } catch (err) {
    logger?.warn({ err }, 'Could not read the mail listener’s last refusal from the audit log');
    return null;
  }
}

/** How long the listener's port may be held before Authelia is moved to its file notifier. */
export const PORT_HELD_GRACE_MS = 5 * 60_000;
let portHeldGraceMs = PORT_HELD_GRACE_MS;

/** Since when the port has been held by another program (ms), or null. */
let portHeldSince = null;

/** Whether Authelia was last configured to submit to the listener (null: not yet known). */
let autheliaSubmitting = null;

/** The tunnel that holds the listener's port, or null. */
async function portTunnel() {
  const tunnels = await readTunnels();
  return tunnels.find((t) => Number(t.port) === MAIL_SUBMISSION_PORT) ?? null;
}

/** Audit and notify the start of a refusal streak; audit its end. */
async function reportListener(reason, logger) {
  if (!listenerRefusalLoaded) {
    listenerRefusal = await recordedListenerRefusal(logger);
    listenerRefusalLoaded = true;
  }
  if (reason === listenerRefusal) return;
  const previous = listenerRefusal;
  listenerRefusal = reason;
  if (reason === null) {
    await recordAuditBestEffort(
      { actor: 'lamaste', action: 'mail.submission.recovered', details: { previous } },
      logger,
    );
    return;
  }
  await recordAuditBestEffort(
    { actor: 'lamaste', action: 'mail.submission.refused', details: { reason } },
    logger,
  );
  const messages = {
    tunnel: `A tunnel uses port ${MAIL_SUBMISSION_PORT}, which the relay's mail now needs: Authelia's mail (sign-in codes) is written to a file until that tunnel moves to another port. The panel never moves it.`,
    port_in_use: `Port ${MAIL_SUBMISSION_PORT} on the relay's loopback is held by another program: Authelia's mail (sign-in codes) is written to a file until it is free.`,
    failed:
      "The relay's mail submission listener could not start: Authelia's mail (sign-in codes) is written to a file. The panel tries again at the next mail change or restart.",
  };
  await notifyAdminsBestEffort(
    { source: 'lamaste', level: 'warning', message: messages[reason] },
    logger,
  );
}

/**
 * Run the listener for `sender` (or stop it for none): `{ submitting,
 * restartAuthelia }` — whether Authelia may submit to it, and whether a file
 * Authelia reads only at start was replaced.
 */
async function syncListener(sender, deliver, logger) {
  if (sender === null) {
    portHeldSince = null;
    await stopSubmissionListener();
    await reportListener(null, logger);
    return { submitting: false, restartAuthelia: false };
  }
  if ((await portTunnel()) !== null) {
    portHeldSince = null;
    await stopSubmissionListener();
    await reportListener('tunnel', logger);
    return { submitting: false, restartAuthelia: false };
  }
  try {
    const material = await ensureSubmissionMaterial({ logger });
    await ensureSubmissionListener({ sender, material, deliver, logger });
    portHeldSince = null;
    await reportListener(null, logger);
    return { submitting: true, restartAuthelia: material.authelia };
  } catch (err) {
    await stopSubmissionListener();
    logger?.warn({ err: err?.message, code: err?.code }, 'Mail submission listener not started');
    if (err?.code === 'EADDRINUSE') {
      const now = Date.now();
      portHeldSince ??= now;
      // Briefly held: Authelia keeps what it has (no restart); retried
      // every minute.
      if (now - portHeldSince < portHeldGraceMs) {
        return { submitting: autheliaSubmitting ?? true, restartAuthelia: false, retrying: true };
      }
      await reportListener('port_in_use', logger);
      return { submitting: false, restartAuthelia: false };
    }
    portHeldSince = null;
    await reportListener('failed', logger);
    return { submitting: false, restartAuthelia: false };
  }
}

/**
 * Carry the relay's mail to the listener, Authelia and the auth vhosts
 * (see the module comment). `deliver` is lib/mail.js `sendRawMail` — what
 * the listener sends Authelia's messages with.
 *
 * @param {{ deliver: (input: object) => Promise<{ status: string }>, logger?: import('pino').Logger }} input
 * @returns {Promise<{ submitting: boolean, warnings: Array<{ step: string, message: string }> }>}
 */
export function syncMailConfiguration({ deliver, logger }) {
  return syncMutex.run(async () => {
    const warnings = [];
    const db = await getStateDb();
    const row = transportRow(db, null);
    const sender = row ? { address: row.sender_address, name: row.sender_name } : null;

    const { submitting, restartAuthelia, retrying } = await syncListener(sender, deliver, logger);
    if (sender !== null && !submitting) {
      warnings.push({
        step: 'listener',
        message:
          "Authelia's mail stays in a file: the relay's submission listener is not running (see the notifications)",
      });
    } else if (retrying) {
      warnings.push({
        step: 'listener',
        message: `Port ${MAIL_SUBMISSION_PORT} is held by another program: the relay tries again every minute, and Authelia's mail fails until it is free`,
      });
    }

    try {
      const settings = {
        sender: submitting ? sender : null,
        resetUrl: resetLinkState(db).autheliaResetUrl,
      };
      const { changed } = await withDomainRendering(() => updateAutheliaMailSettings(settings), {
        logger,
      });
      autheliaSubmitting = settings.sender !== null;
      let reason = changed ? 'mail' : null;
      if (!changed && submitting && restartAuthelia) {
        await reloadAuthelia();
        reason = 'mail-credentials';
      }
      if (reason !== null) {
        logger?.info({ reason }, 'Authelia restarted for the relay’s mail');
        await recordAuditBestEffort(
          { actor: 'lamaste', action: 'authelia.restarted', details: { reason } },
          logger,
        );
      }
    } catch (err) {
      logger?.warn({ err: err?.message }, 'Authelia’s mail settings not updated');
      warnings.push({
        step: 'authelia',
        message: `Authelia's notifier and reset link were not updated (${err?.message})`,
      });
    }

    const vhosts = await convergeAuthVhosts({ logger });
    if (vhosts.failed.length > 0) {
      warnings.push({
        step: 'vhost',
        message: `The sign-in pages of ${vhosts.failed.join(', ')} keep their previous reset link; the panel retries within a minute`,
      });
    }
    return { submitting, warnings };
  });
}

/**
 * The minute's retry of a listener whose port another program held: the
 * whole synchronisation again — the listener, then Authelia only when its
 * notifier must change (the grace is over, or the listener runs again) —
 * and nothing at all otherwise. Never throws.
 *
 * @param {{ deliver: (input: object) => Promise<{ status: string }>, logger?: import('pino').Logger }} input
 */
export async function retrySubmissionListener({ deliver, logger }) {
  if (portHeldSince === null) return;
  try {
    await syncMailConfiguration({ deliver, logger });
  } catch (err) {
    logger?.warn({ err: err?.message }, 'Mail submission listener retry failed');
  }
}

/** Forget a refusal streak and what Authelia was given (tests); `graceMs` the port's grace. */
export function resetMailSyncForTests({ graceMs } = {}) {
  listenerRefusal = null;
  listenerRefusalLoaded = false;
  portHeldSince = null;
  autheliaSubmitting = null;
  portHeldGraceMs = graceMs ?? PORT_HELD_GRACE_MS;
}
