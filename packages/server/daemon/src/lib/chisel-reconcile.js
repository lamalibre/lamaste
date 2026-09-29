/**
 * Startup reconciliation of the chisel server — fail closed.
 *
 * Every time the panel starts it brings chisel in line with persisted state:
 *
 * 1. Every active agent has a chisel credential (fresh install, or agents
 *    enrolled while credential minting failed).
 * 2. Tunnels persisted before tunnels had owners are bound where the owner is
 *    certain (see `bindUnownedTunnels`); the rest stay unowned and dark.
 * 3. Once onboarding has provisioned chisel: the pinned chisel release is
 *    installed, the unit is current (runs as group lamaste-chisel), and the
 *    authfile is rewritten from state with its ownership and mode re-applied.
 * 4. Chisel is restarted when the binary, the unit or a revocation requires
 *    it, and started if it is enabled but not running.
 *
 * Fail closed: if steps 1–3 cannot establish a correct authfile and unit,
 * chisel is stopped AND disabled, and a marker file records why. An authfile
 * left by an older version may grant every agent every port (`.*`) — keeping
 * that live because reconciliation failed would silently re-open what this
 * version closes, and a disabled unit keeps a reboot from starting it before
 * the panel has reconciled. Reconciliation is retried with backoff until it
 * succeeds; then chisel is enabled and started again and the marker removed.
 *
 * A failed download of the pinned binary is not a reason to stop chisel: the
 * authfile and unit enforce access, and chisel-runtime.js restarts chisel on
 * every change while an older binary runs. It is retried with backoff too.
 */

import { execa } from 'execa';
import { rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { AGENT_LABEL_REGEX } from '@lamalibre/lamaste';
import { bindUnownedTunnels, withTunnelLock, withheldTunnels } from '@lamalibre/lamaste/server';
import { readTunnels, writeTunnels } from './state.js';
import { loadAgentRegistry } from './mtls.js';
import { migrateChiselCredentialsIfNeeded, syncChiselAuthfile } from './chisel-users.js';
import {
  ensureChiselKey,
  ensureChiselService,
  getInstalledChiselVersion,
  installChisel,
  isChiselProvisioned,
  isChiselRunning,
  reloadChisel,
  startChisel,
  stopChisel,
} from './chisel.js';
import { setChiselRunningPinnedRelease } from './chisel-runtime.js';

/** Present while chisel is held down by a failed reconciliation. */
function failClosedMarker() {
  const stateDir = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';
  return path.join(stateDir, 'chisel-failed-closed');
}

async function isFailClosed() {
  try {
    await access(failClosedMarker());
    return true;
  } catch {
    return false;
  }
}

const RETRY_MIN_MS = 30_000;
const RETRY_MAX_MS = 10 * 60_000;

async function isChiselEnabled() {
  try {
    const { stdout } = await execa('systemctl', ['is-enabled', 'chisel']);
    return stdout.trim() === 'enabled';
  } catch {
    return false;
  }
}

async function bindOwnership(logger) {
  await withTunnelLock(async () => {
    const tunnels = await readTunnels();
    const registry = await loadAgentRegistry();
    // Machine agents only: plugin-agent certificates carry no tunnels, and
    // counting them would make "the sole agent" ambiguous.
    const activeLabels = registry.agents
      .filter((a) => !a.revoked && AGENT_LABEL_REGEX.test(a.label))
      .map((a) => a.label);

    const { tunnels: next, bound, unowned } = bindUnownedTunnels(tunnels, activeLabels);
    if (bound.length > 0) {
      await writeTunnels(next);
      logger.info({ bound }, 'Bound ownerless tunnels to the agent that carries them');
    }
    const withheld = withheldTunnels(bound.length > 0 ? next : tunnels);
    if (withheld.length > 0) {
      logger.warn(
        { subdomains: withheld.map((t) => t.subdomain) },
        'Tunnels on a reserved port or a port another tunnel also claims are carried by no ' +
          'agent — delete them and recreate each on a free port',
      );
    }
    if (unowned.length > 0) {
      logger.warn(
        { subdomains: unowned, activeAgents: activeLabels.length },
        'Tunnels without an owning agent are carried by no agent until an administrator ' +
          'assigns one (PATCH /api/tunnels/:id with agentLabel)',
      );
    }
  });
}

/**
 * One reconciliation pass.
 * @returns {Promise<{ provisioned: boolean, binaryPinned: boolean }>}
 */
export async function reconcileChiselServer(logger) {
  const provisioned = await isChiselProvisioned();
  let migrateRevoked = false;
  try {
    // Its authfile write can already be the one that withdraws something
    // (state persisted before a crash, but never synced) — keep that for the
    // restart decision below.
    ({ revoked: migrateRevoked } = await migrateChiselCredentialsIfNeeded(
      loadAgentRegistry,
      logger,
    ));
    await bindOwnership(logger);
    if (!provisioned) {
      // Onboarding has not installed chisel yet; keep the authfile correct
      // for when it does.
      await syncChiselAuthfile({ force: true });
      return { provisioned: false, binaryPinned: false };
    }
    await ensureChiselKey();
  } catch (err) {
    await failClosed(logger, provisioned);
    throw err;
  }

  let binaryChanged = false;
  let binaryPinned = true;
  try {
    const result = await installChisel();
    binaryChanged = result.installed === true;
    if (binaryChanged) {
      logger.info(
        { from: result.previousVersion ?? null, to: result.version },
        'Installed the pinned chisel release',
      );
    }
  } catch (err) {
    binaryPinned = false;
    if ((await getInstalledChiselVersion()) === null) {
      await failClosed(logger, provisioned);
      throw err;
    }
    logger.error(
      { err },
      'Could not install the pinned chisel release; the installed chisel keeps running and ' +
        'is restarted on every authfile change until the upgrade succeeds',
    );
  }

  let unitChanged;
  let revoked;
  try {
    ({ changed: unitChanged } = await ensureChiselService());
    ({ revoked } = await syncChiselAuthfile({ force: true }));
  } catch (err) {
    await failClosed(logger, provisioned);
    throw err;
  }

  revoked = revoked || migrateRevoked;

  if (await isFailClosed()) {
    await execa('sudo', ['systemctl', 'enable', 'chisel']);
    await startChisel();
    await rm(failClosedMarker(), { force: true });
    logger.info({}, 'Chisel re-enabled and started: reconciliation succeeded');
  } else if (await isChiselRunning()) {
    if (binaryChanged || unitChanged || revoked) {
      await reloadChisel();
      logger.info({ binaryChanged, unitChanged, revoked }, 'Chisel restarted after reconciliation');
    }
  } else if (await isChiselEnabled()) {
    await startChisel();
    logger.info({}, 'Chisel started after reconciliation');
  }
  setChiselRunningPinnedRelease(binaryPinned);

  if (!binaryPinned) {
    const err = new Error('Pinned chisel release not installed');
    err.retryOnly = true;
    throw err;
  }
  return { provisioned: true, binaryPinned };
}

async function failClosed(logger, provisioned) {
  setChiselRunningPinnedRelease(false);
  if (!provisioned) return;
  // Stopping comes first and does not depend on the other two steps.
  try {
    await stopChisel();
  } catch (stopErr) {
    logger.fatal(
      { err: stopErr },
      'Chisel could not be reconciled and could not be stopped — check chisel-users by hand',
    );
    return;
  }
  try {
    await writeFile(failClosedMarker(), `${new Date().toISOString()}\n`, { mode: 0o600 });
    await execa('sudo', ['systemctl', 'disable', 'chisel']);
  } catch (err) {
    logger.error(
      { err },
      'Chisel is stopped but could not be disabled; a reboot would start it before the panel ' +
        'reconciles',
    );
  }
  logger.error(
    {},
    'Chisel stopped: its authfile or unit could not be brought in line with the tunnel ' +
      'state, and an authfile from an older version may grant more than it should. ' +
      'Tunnels stay down until reconciliation succeeds; it is retried automatically.',
  );
}

/**
 * Run reconciliation in the background now and, on failure, again with
 * exponential backoff until it succeeds. Never throws and never blocks
 * startup: installing the pinned binary may mean a download, and the panel
 * must stay reachable meanwhile — it is how an administrator fixes whatever
 * made reconciliation fail.
 */
export function startChiselReconciler(logger) {
  let delay = RETRY_MIN_MS;
  const attempt = async () => {
    try {
      await reconcileChiselServer(logger);
      return true;
    } catch (err) {
      if (!err.retryOnly) {
        logger.error({ err }, 'Chisel reconciliation failed');
      }
      return false;
    }
  };
  const schedule = () => {
    const timer = setTimeout(async () => {
      if (await attempt()) return;
      delay = Math.min(delay * 2, RETRY_MAX_MS);
      schedule();
    }, delay);
    timer.unref();
  };
  void attempt().then((ok) => {
    if (!ok) schedule();
  });
}
