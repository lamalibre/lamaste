/**
 * The app jobs of the agent-hosted plugins this agent hosts (slice 3) —
 * `app-install`, `app-activate`, `app-remove` — which the relay lists in
 * agent-config and the sync runs through `lamaste-apphost`, the root helper
 * `sudo lamaste-agent apphost enable` installs; and the delivery of a
 * plugin config to an installed agent half's service, which converge makes
 * before it acknowledges the config.
 *
 * `app-install` fetches exactly the pinned `<package>@<version>` with
 * `npm pack` (the panel-brokered registry token in a throw-away userconfig,
 * `--ignore-scripts`, into a 0700 temporary directory), checks its SHA-512
 * against the integrity the relay pinned before anything else, pipes the
 * relay's signature, the service spec and the tarball to `lamaste-apphost
 * install`, records the route in apphost-state.json and hands the service
 * its plugin config.
 *
 * The helper runs `install`, `activate` and `remove` only with the relay's
 * signature over the job (first line of its stdin), verified against the
 * key `apphost enable|pin` pinned for this agent. The sync hands on the
 * signature the job came with — it cannot make one — so it never undoes an
 * install by itself: a failure is reported, and the relay, which recovers
 * from every install it dispatched, sends the signed removal or activation.
 *
 * A failure is reported as one line without secrets: npm's output is cut to
 * its error lines with credentials removed, the helper never echoes its
 * input, and neither the token nor the config is ever an argument.
 */

import crypto from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { APPHOST_PROTOCOL_VERSION, agentJobError } from '@lamalibre/lamaste';
import {
  APPHOST_EXIT_NOT_INSTALLED,
  agentTmpDir,
  appHostFailure,
  appHostRouteRecordedElsewhere,
  appHostStatus,
  forgetAppHostApp,
  isAppHostEnabled,
  loadAppPluginConfig,
  parseAppHostOutcome,
  readAppHostState,
  rebuildAppHostState,
  recordAppHostApp,
  runAppHost,
  withAgentLock,
  withInstallNpmrc,
} from '@lamalibre/lamaste/agent';
import { fetchRegistryCredential } from './panel-api.js';

export const HELPER_NOT_ENABLED =
  'the app host helper is not enabled on this agent (sudo lamaste-agent apphost enable)';

/** The helper refuses a larger tarball; refused here before it is piped. */
const TARBALL_MAX_BYTES = 128 * 1024 * 1024;
/** Kept back from a job's timeout to report its result. */
const REPORT_MARGIN_MS = 5_000;
const NPM_PACK_TIMEOUT_MS = 180_000;
const CONFIG_TIMEOUT_MS = 60_000;

/** npm's Subresource Integrity of a tarball: `sha512-<base64>`. */
export function tarballIntegrity(bytes) {
  return `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;
}

/**
 * Why `npm pack` failed, in one line for a job result: npm's first two
 * error lines, with the registry token and anything credential-shaped
 * removed. A failure of this module's own (no npm output) keeps its message.
 *
 * @param {unknown} err
 * @param {Array<string | undefined>} secrets - values that must never appear
 */
export function npmFailure(err, secrets = []) {
  let text;
  if (err?.timedOut) {
    text = 'npm did not finish in time';
  } else if (err && typeof err === 'object' && 'stderr' in err) {
    const lines = String(err.stderr ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^npm (error|ERR!)/.test(l))
      .map((l) => l.replace(/^npm (error|ERR!)\s*/, ''))
      .filter((l) => l && !/complete log of this run/i.test(l));
    text =
      lines.slice(0, 2).join('; ') ||
      (typeof err.exitCode === 'number' ? `npm exited with status ${err.exitCode}` : '');
    if (!text) text = err.code === 'ENOENT' ? 'npm is not installed' : 'npm could not run';
  } else {
    text = err instanceof Error ? err.message : String(err);
  }
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join('***');
  }
  return text
    .replace(/\b(_authToken|_auth|_password|password|token)\s*[=:]\s*\S+/gi, '$1=***')
    .replace(/\bBearer\s+\S+/gi, 'Bearer ***')
    .replace(/\/\/[^/\s@]+@/g, '//***@');
}

/**
 * `npm pack <name>@<version>` into a fresh 0700 directory under the agent's
 * tmp directory; returns the tarball's bytes. With `npmrc`, npm reads only
 * a throw-away userconfig holding that credential (deleted afterwards).
 *
 * @param {string} name
 * @param {string} version
 * @param {{ registryUrl: string, token: string, scope?: string } | undefined} npmrc
 * @param {number} timeoutMs
 * @returns {Promise<Buffer>}
 */
async function npmPack(name, version, npmrc, timeoutMs) {
  await mkdir(agentTmpDir(), { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(path.join(agentTmpDir(), 'apphost-'));
  try {
    return await withInstallNpmrc(dir, npmrc, async (env) => {
      const { stdout } = await execa(
        'npm',
        ['pack', `${name}@${version}`, '--json', '--ignore-scripts', '--pack-destination', dir],
        {
          cwd: dir,
          timeout: timeoutMs,
          // The npm next to the Node.js running this CLI, and that Node.js
          // for npm's own `#!/usr/bin/env node` — the sync timer's PATH is
          // minimal.
          env: {
            ...env,
            PATH: [path.dirname(process.execPath), process.env.PATH]
              .filter(Boolean)
              .join(path.delimiter),
          },
        },
      );
      let packed;
      try {
        packed = JSON.parse(stdout);
      } catch {
        throw new Error('npm pack did not report the tarball it wrote');
      }
      const info = Array.isArray(packed) ? packed[0] : null;
      if (
        !info ||
        typeof info.filename !== 'string' ||
        info.name !== name ||
        info.version !== version
      ) {
        throw new Error(`npm pack did not fetch ${name}@${version}`);
      }
      const file = path.join(dir, path.basename(info.filename));
      if ((await stat(file)).size > TARBALL_MAX_BYTES) {
        throw new Error(`${name}@${version} is larger than 128 MiB`);
      }
      return readFile(file);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function failure(message) {
  return { ok: false, error: agentJobError(message) };
}

/**
 * The first line of the helper's stdin for app job `job`: the relay's
 * signature it came with. Null when it has none in the expected shape —
 * the job is then not run (the sync's parser already refuses such a job).
 *
 * @param {{ signature?: unknown }} job
 * @returns {string | null}
 */
function signatureLine(job) {
  const sig = job.signature;
  if (
    !sig ||
    typeof sig !== 'object' ||
    typeof sig.envelope !== 'string' ||
    typeof sig.sig !== 'string'
  ) {
    return null;
  }
  return `${JSON.stringify({ envelope: sig.envelope, sig: sig.sig })}\n`;
}

const UNSIGNED =
  "the job carries no signature of the relay, and the agent's app host helper runs only signed jobs";

/** Milliseconds left until `deadline`, at least one second (execa reads 0 as no timeout). */
function left(deadline) {
  return Math.max(1_000, deadline - Date.now());
}

/** Why another agent on this machine owns `route`, or null when none claims it. */
async function ownedElsewhere(deps, label, route) {
  const others = await deps.recordedElsewhere(route);
  if (others.length === 0) return null;
  return (
    `the agent half of "${route}" on this machine belongs to agent ${others.join(', ')}, ` +
    `not "${label}"; it is left alone`
  );
}

/**
 * Why an install cannot go ahead — the helper not enabled, not answering,
 * too old, or the route owned by another agent — or null when it can.
 */
async function helperProblem(deps, label, route) {
  const availability = await deps.appHostStatus(route);
  if (availability.state === 'absent') return HELPER_NOT_ENABLED;
  if (availability.state === 'unusable') {
    return `the app host helper did not answer: ${availability.reason}`;
  }
  const { status } = availability;
  if (status.protocol < APPHOST_PROTOCOL_VERSION) {
    return (
      `the app host helper speaks protocol ${status.protocol}; this agent needs ` +
      `${APPHOST_PROTOCOL_VERSION} (sudo lamaste-agent apphost enable)`
    );
  }
  const owner = status.apps[route]?.owner;
  if (owner && owner.label !== label) {
    return (
      `the agent half of "${route}" on this machine belongs to agent "${owner.label}" ` +
      `(${owner.package}), not "${label}"`
    );
  }
  return null;
}

async function installAgentHalf(label, job, deps) {
  const { route, spec } = job;
  const what = `${spec.package}@${spec.version}`;
  const deadline = Date.now() + job.timeoutMs - REPORT_MARGIN_MS;
  const signed = signatureLine(job);
  if (signed === null) return failure(UNSIGNED);

  const elsewhere = await ownedElsewhere(deps, label, route);
  if (elsewhere) return failure(elsewhere);
  const problem = await helperProblem(deps, label, route);
  if (problem) return failure(problem);
  // The service cannot start without its config, and the relay lists the
  // job only once it issued one: it arrives with the next converge.
  if (!(await deps.loadPluginConfig(route))) {
    return {
      deferred: true,
      reason: `the plugin config of "${route}" has not arrived from the panel yet`,
    };
  }

  let npmrc;
  try {
    const credential = await deps.fetchRegistryCredential();
    npmrc = credential
      ? { registryUrl: credential.registryUrl, token: credential.token, scope: credential.scope }
      : undefined;
  } catch (err) {
    return failure(`the panel did not broker a registry credential for ${what}: ${err.message}`);
  }

  let tgz;
  try {
    tgz = await deps.packPackage(
      spec.package,
      spec.version,
      npmrc,
      Math.min(NPM_PACK_TIMEOUT_MS, left(deadline)),
    );
  } catch (err) {
    return failure(`npm could not fetch ${what}: ${npmFailure(err, [npmrc?.token])}`);
  }
  // Before anything else: only the bytes the relay pinned are installed.
  if (tarballIntegrity(tgz) !== spec.integrity) {
    return failure(
      `${what} from the registry does not match the integrity the panel pinned; nothing was installed`,
    );
  }

  const specLine = JSON.stringify({
    package: spec.package,
    service: { entry: spec.service.entry, memoryMax: spec.service.memoryMax },
    systemPackages: spec.systemPackages,
  });
  const installed = await deps.runAppHost(['install', label, route, spec.version, spec.integrity], {
    input: Buffer.concat([Buffer.from(signed), Buffer.from(`${specLine}\n`), tgz]),
    timeoutMs: left(deadline),
  });
  if (installed.exitCode !== 0) {
    return failure(`lamaste-apphost could not install ${what}: ${appHostFailure(installed)}`);
  }

  // Under the agent lock, which converge holds while it fetches, delivers
  // and acknowledges configs: no rotation slips in between reading the
  // config and writing the service's copy, and once the route is recorded
  // converge delivers every later one.
  const configured = await deps.underAgentLock(async () => {
    await deps.recordApp(route, spec.version);
    const config = await deps.loadPluginConfig(route);
    if (!config) return null;
    return deps.runAppHost(['config', label, route], {
      input: JSON.stringify(config),
      timeoutMs: Math.min(CONFIG_TIMEOUT_MS, left(deadline)),
    });
  });
  const outcome = configured?.exitCode === 0 ? parseAppHostOutcome(configured.stdout) : null;
  if (!outcome) {
    // Installed, but without its config: reported as a failure, which the
    // relay answers with a signed removal (or, for an update, by activating
    // the version that ran before).
    const why =
      configured === null
        ? `the plugin config of "${route}" was removed before the service received it`
        : configured.exitCode !== 0
          ? `lamaste-apphost could not hand "${route}" its plugin config: ${appHostFailure(configured)}`
          : 'lamaste-apphost answered config with something unexpected';
    return failure(`${what} was installed, but ${why}`);
  }
  return { ok: true, app: outcome };
}

async function activateAgentHalf(label, job, deps) {
  const signed = signatureLine(job);
  if (signed === null) return failure(UNSIGNED);
  if (!(await deps.isAppHostEnabled())) return failure(HELPER_NOT_ENABLED);
  const elsewhere = await ownedElsewhere(deps, label, job.route);
  if (elsewhere) return failure(elsewhere);
  const run = await deps.runAppHost(['activate', label, job.route, job.version], {
    input: signed,
    timeoutMs: left(Date.now() + job.timeoutMs - REPORT_MARGIN_MS),
  });
  if (run.exitCode !== 0) {
    return failure(
      `lamaste-apphost could not activate ${job.version} of "${job.route}": ${appHostFailure(run)}`,
    );
  }
  const outcome = parseAppHostOutcome(run.stdout);
  if (!outcome) return failure('lamaste-apphost answered activate with something unexpected');
  if (outcome.version !== null) {
    await deps.underAgentLock(() => deps.recordApp(job.route, outcome.version));
  }
  return { ok: true, app: outcome };
}

async function removeAgentHalf(label, job, deps) {
  const signed = signatureLine(job);
  if (signed === null) return failure(UNSIGNED);
  const elsewhere = await ownedElsewhere(deps, label, job.route);
  if (elsewhere) return failure(elsewhere);
  if (!(await deps.isAppHostEnabled())) {
    // `apphost disable` removes every agent half before the helper goes, so
    // without the helper there is nothing of this one left to stop — but
    // its data and account cannot be deleted either.
    if (job.purge) {
      return failure(`${HELPER_NOT_ENABLED}; without it the agent half's data cannot be purged`);
    }
    await deps.underAgentLock(() => deps.forgetApp(job.route));
    return { ok: true, app: { version: null, unit: 'absent' } };
  }
  const run = await deps.runAppHost(
    ['remove', label, job.route, ...(job.purge ? ['--purge'] : [])],
    { input: signed, timeoutMs: left(Date.now() + job.timeoutMs - REPORT_MARGIN_MS) },
  );
  if (run.exitCode !== 0) {
    return failure(`lamaste-apphost could not remove "${job.route}": ${appHostFailure(run)}`);
  }
  await deps.underAgentLock(() => deps.forgetApp(job.route));
  const outcome = parseAppHostOutcome(run.stdout);
  if (!outcome) return failure('lamaste-apphost answered remove with something unexpected');
  return { ok: true, app: outcome };
}

/**
 * The handlers `runAgentJobs` runs app jobs with. `overrides` replaces the
 * helper, the panel, npm and the state record (tests).
 *
 * @param {string} label
 * @param {object} config - Agent config (mTLS identity for the panel calls)
 * @param {object} [overrides]
 * @returns {import('@lamalibre/lamaste/agent').AgentAppJobHandlers}
 */
export function createAppJobHandlers(label, config, overrides = {}) {
  const deps = {
    appHostStatus,
    isAppHostEnabled,
    runAppHost,
    recordedElsewhere: (route) => appHostRouteRecordedElsewhere(label, route),
    loadPluginConfig: (route) => loadAppPluginConfig(label, route),
    fetchRegistryCredential: () => fetchRegistryCredential(config),
    packPackage: npmPack,
    underAgentLock: (fn) => withAgentLock(label, fn),
    recordApp: (route, version) => recordAppHostApp(label, route, version),
    forgetApp: (route) => forgetAppHostApp(label, route),
    ...overrides,
  };
  return {
    install: (job) => installAgentHalf(label, job, deps),
    activate: (job) => activateAgentHalf(label, job, deps),
    remove: (job) => removeAgentHalf(label, job, deps),
  };
}

/**
 * Converge's `deliverPluginConfig`: writes a fetched plugin config into the
 * service's copy (`lamaste-apphost config`, as agent `label`) before it is
 * acknowledged. `delivered` lists the routes delivered to, for the sync
 * log. A route another agent owns is refused by the helper; that is an
 * error, not "not installed" — the config stays unacknowledged.
 *
 * @param {string} label
 * @param {object} [overrides] - replaces the helper (tests)
 */
export function createPluginConfigDeliverer(label, overrides = {}) {
  const deps = { isAppHostEnabled, runAppHost, ...overrides };
  const delivered = [];
  return {
    delivered,
    /**
     * @param {string} route
     * @param {import('@lamalibre/lamaste/agent').AgentAppPluginConfig} pluginConfig
     * @returns {Promise<'delivered' | 'not-installed'>}
     */
    async deliver(route, pluginConfig) {
      if (!(await deps.isAppHostEnabled())) return 'not-installed';
      const run = await deps.runAppHost(['config', label, route], {
        input: JSON.stringify(pluginConfig),
        timeoutMs: CONFIG_TIMEOUT_MS,
      });
      if (run.exitCode === APPHOST_EXIT_NOT_INSTALLED) return 'not-installed';
      if (run.exitCode !== 0) {
        throw new Error(
          `lamaste-apphost could not write the service's copy: ${appHostFailure(run)}`,
        );
      }
      delivered.push(route);
      return 'delivered';
    },
  };
}

/**
 * Repair an unreadable apphost-state.json from root-owned facts before the
 * config sync reads it: the agent halves whose owner record names `label`
 * (none when the helper is not enabled). Left as it is — and the config
 * sync failing closed — when the helper does not answer. Returns the routes
 * recorded, or null when nothing was repaired.
 *
 * @param {string} label
 * @param {object} [overrides] - replaces the helper and the record (tests)
 * @returns {Promise<string[] | null>}
 */
export async function repairAppHostRecord(label, overrides = {}) {
  const deps = {
    appHostStatus,
    readAppHostState,
    rebuild: (apps) => withAgentLock(label, () => rebuildAppHostState(label, apps)),
    ...overrides,
  };
  try {
    await deps.readAppHostState(label);
    return null;
  } catch {
    // Unreadable: rebuilt below when the helper can say what is this agent's.
  }
  const availability = await deps.appHostStatus();
  if (availability.state === 'unusable') return null;
  return deps.rebuild(availability.state === 'ready' ? availability.status.apps : {});
}
