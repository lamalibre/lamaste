import { execa } from 'execa';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Gatekeeper's service after a redeploy: started whenever the redeploy
 * installed it, proved ready by its health endpoint, and reported — never
 * in the way of the panel's own restart.
 *
 * Every authenticated or restricted tunnel, every web-surface shell and
 * every page's sign-in redirect asks Gatekeeper, so no state of a relay
 * wants it stopped; but an administrator may have masked it, or disabled it
 * at boot, and a broken release may crash it. None of that may leave the
 * panel stopped: the redeploy starts Gatekeeper before the panel (best
 * effort, {@link startGatekeeper}), starts the panel whatever happened, and
 * only then checks Gatekeeper ({@link checkGatekeeper}) — its last step, so
 * a failure is reported as that step failing and the redeploy's error, with
 * the panel already serving.
 */

export const GATEKEEPER_SERVICE = 'lamalibre-lamaste-gatekeeper';
export const GATEKEEPER_HEALTH_URL = 'http://127.0.0.1:9294/health';

/**
 * @typedef {{ state: 'started' | 'masked' | 'start-failed', enabled: string, error?: string }} GatekeeperStart
 */

/**
 * Start (restart) Gatekeeper unless it is masked. Its boot setting is left
 * as it is — a fresh install enables it; one disabled since was disabled on
 * purpose. Never throws.
 *
 * @param {{ run?: typeof execa }} [deps]
 * @returns {Promise<GatekeeperStart>}
 */
export async function startGatekeeper({ run = execa } = {}) {
  const probe = await run('systemctl', ['is-enabled', GATEKEEPER_SERVICE], { reject: false });
  const enabled = String(probe.stdout ?? '').trim() || 'unknown';
  if (enabled.startsWith('masked')) return { state: 'masked', enabled };
  try {
    await run('systemctl', ['restart', GATEKEEPER_SERVICE]);
    return { state: 'started', enabled };
  } catch (err) {
    return { state: 'start-failed', enabled, error: String(err?.stderr || err?.message || err) };
  }
}

/**
 * Whether Gatekeeper answers `GET /health` within `attempts × intervalMs` —
 * the fresh install's probe. The unit is `Type=simple`: `systemctl
 * is-active` holds as soon as the process is spawned, so it proves nothing.
 *
 * @param {{ fetchImpl?: typeof fetch, attempts?: number, intervalMs?: number, wait?: (ms: number) => Promise<unknown> }} [deps]
 */
export async function gatekeeperHealthy({
  fetchImpl = fetch,
  attempts = 20,
  intervalMs = 500,
  wait = sleep,
} = {}) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetchImpl(GATEKEEPER_HEALTH_URL, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // not listening yet
    }
    if (i + 1 < attempts) await wait(intervalMs);
  }
  return false;
}

/**
 * What to report about Gatekeeper once the panel is up: `ok` false fails
 * the redeploy's last step (the panel keeps running), `warning` is shown.
 *
 * @param {GatekeeperStart} start
 * @param {{ fetchImpl?: typeof fetch, run?: typeof execa, attempts?: number, intervalMs?: number, wait?: (ms: number) => Promise<unknown> }} [deps]
 * @returns {Promise<{ ok: boolean, message: string, warning?: string }>}
 */
export async function checkGatekeeper(start, deps = {}) {
  const run = deps.run ?? execa;
  const consequence =
    'authenticated and restricted tunnels, web-surface shells and every sign-in redirect answer 502 until it runs';
  if (start.state === 'masked') {
    return {
      ok: false,
      message:
        `Gatekeeper is masked, so the redeploy left it stopped: ${consequence}. ` +
        `If that is not intended: sudo systemctl unmask ${GATEKEEPER_SERVICE} && sudo systemctl enable --now ${GATEKEEPER_SERVICE}`,
    };
  }
  if (start.state === 'started' && (await gatekeeperHealthy(deps))) {
    return {
      ok: true,
      message: 'Gatekeeper is serving',
      ...(start.enabled === 'disabled'
        ? {
            warning: `Gatekeeper runs now but is disabled at boot: after a reboot ${consequence}. To start it at boot: sudo systemctl enable ${GATEKEEPER_SERVICE}`,
          }
        : {}),
    };
  }
  const { stdout: logs } = await run(
    'journalctl',
    ['-u', GATEKEEPER_SERVICE, '-n', '20', '--no-pager'],
    { reject: false },
  );
  const why =
    start.state === 'start-failed'
      ? `could not be started (${start.error?.trim()})`
      : `does not answer ${GATEKEEPER_HEALTH_URL}`;
  return {
    ok: false,
    message: `Gatekeeper ${why} after the redeploy; the panel is running, but ${consequence}. Recent logs:\n${logs ?? ''}`,
  };
}
