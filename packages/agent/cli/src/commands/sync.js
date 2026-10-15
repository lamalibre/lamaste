import chalk from 'chalk';
import {
  agentTunnelHooksOnPanelLoss,
  assertSupportedPlatform,
  parseAgentJobs,
  parseTunnelHookAssignments,
  readSyncState,
  requireAgentConfig,
  runAgentJobs,
  syncAgentTunnelHooks,
  syncHostFacts,
  writeSyncState,
} from '@lamalibre/lamaste/agent';
import { createAppJobHandlers } from '../lib/app-host-jobs.js';
import { convergeWithPanel, describeConverge } from '../lib/converge.js';
import { putHostFacts, reportJobResult } from '../lib/panel-api.js';

/**
 * Report this machine's host facts when they changed (or a day passed) —
 * what the relay checks a plugin's requirements against when it is hosted
 * here.
 *
 * @param {string} label
 * @param {string[]} warnings
 * @returns {Promise<string[]>} what happened, for the log
 */
async function reportHostFacts(label, warnings) {
  const config = await requireAgentConfig(label);
  const { changed } = await syncHostFacts(
    label,
    { putHostFacts: (facts) => putHostFacts(config, facts) },
    warnings,
  );
  return changed ? ['host facts reported'] : [];
}

/**
 * The jobs and hooks of the agent-hosted plugins this agent hosts: the jobs
 * the relay listed (hook calls while there is no tunnel, and the app jobs
 * that install, switch or remove an agent half through the app host helper)
 * and the tunnel-state hooks. After converge, outside the agent lock — a
 * job may take minutes.
 *
 * @param {string} label
 * @param {object} response - the agent-config response
 * @param {string[]} warnings
 * @returns {Promise<string[]>} what happened, for the log
 */
async function runPluginHooks(label, response, warnings) {
  const config = await requireAgentConfig(label);
  const events = [];
  const jobs = parseAgentJobs(response.agentJobs, warnings);
  if (jobs.length > 0) {
    const byId = new Map(jobs.map((j) => [j.id, j]));
    const { ran } = await runAgentJobs(
      label,
      jobs,
      { reportJobResult: (id, result) => reportJobResult(config, id, result) },
      warnings,
      { appJobs: createAppJobHandlers(label, config) },
    );
    for (const id of ran) {
      const job = byId.get(id);
      if (!job) continue;
      events.push(
        job.kind === 'hook'
          ? `hook ${job.stage} ran: ${job.route}`
          : `app ${job.kind.slice('app-'.length)} ran: ${job.route}`,
      );
    }
  }
  const delivered = await syncAgentTunnelHooks(
    label,
    parseTunnelHookAssignments(response.appPlugins),
    warnings,
  );
  for (const route of delivered) events.push(`tunnel hook delivered: ${route}`);
  return events;
}

/**
 * Converge the chisel client with the relay once. This is what the sync timer
 * runs every 30 seconds; it is also safe to run by hand.
 *
 * With `--quiet` (the timer) it prints only when something changed or a new
 * error appears, so the log stays small when nothing happens — a failure that
 * repeats every 30 seconds is logged once, and again once it clears.
 *
 * @param {{ label: string, quiet?: boolean }} options
 */
export async function runSync({ label, quiet = false }) {
  assertSupportedPlatform();
  const previous = await readSyncState(label);
  const now = new Date().toISOString();

  try {
    const { result, response, delivered } = await convergeWithPanel(label);
    const hookWarnings = [];
    const factEvents = await reportHostFacts(label, hookWarnings).catch((err) => {
      hookWarnings.push(`Host facts could not be reported (${err.message}).`);
      return [];
    });
    const pluginEvents = await runPluginHooks(label, response, hookWarnings).catch((err) => {
      hookWarnings.push(`Plugin hooks could not run (${err.message}); retrying on the next sync.`);
      return [];
    });
    const hookEvents = [
      ...delivered.map((route) => `plugin config delivered to its service: ${route}`),
      ...factEvents,
      ...pluginEvents,
    ];
    const warnings = [...result.warnings, ...hookWarnings];
    await writeSyncState(label, {
      lastRunAt: now,
      lastOkAt: now,
      lastError: null,
      lastState: result.state,
      tunnels: result.tunnels,
      lastWarnings: warnings,
    });

    // A warning that repeats every run (e.g. a relay that cannot rotate the
    // credential yet) is logged when it first appears, not every 30 seconds.
    const seen = new Set(previous?.lastWarnings ?? []);
    const newWarnings = warnings.filter((w) => !seen.has(w));
    const app = result.appPlugins;
    const noteworthy =
      result.serviceChanged ||
      result.credential !== 'kept' ||
      result.binaryUpdated ||
      app.fetched.length > 0 ||
      app.acknowledged.length > 0 ||
      app.removed.length > 0 ||
      hookEvents.length > 0 ||
      newWarnings.length > 0 ||
      previous?.lastError ||
      previous?.lastState !== result.state;
    const summary = [describeConverge(result), ...hookEvents].join('; ');
    if (!quiet) {
      console.log(chalk.green(`  ${label}: ${summary}`));
      for (const warning of warnings) console.log(chalk.yellow(`  ${warning}`));
    } else if (noteworthy) {
      console.log(`${now} ${label}: ${summary}`);
      for (const warning of newWarnings) console.log(`${now} ${label}: warning: ${warning}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The panel out of reach for long enough is the tunnel down, as far as
    // the plugins hosted here can tell: their agent halves are told so.
    const lossWarnings = [];
    const toldDown = await agentTunnelHooksOnPanelLoss(
      label,
      previous?.lastOkAt ?? null,
      lossWarnings,
    ).catch(() => []);
    if (toldDown.length > 0 && quiet) {
      console.log(
        `${now} ${label}: tunnel hook delivered (panel unreachable): ${toldDown.join(', ')}`,
      );
    }
    await writeSyncState(label, {
      lastRunAt: now,
      lastOkAt: previous?.lastOkAt ?? null,
      lastError: message,
      lastState: previous?.lastState ?? null,
      tunnels: previous?.tunnels ?? null,
      lastWarnings: previous?.lastWarnings ?? [],
    }).catch(() => undefined);
    if (!quiet) {
      console.error(chalk.red(`  ${label}: sync failed: ${message}`));
    } else if (previous?.lastError !== message) {
      console.error(`${now} ${label}: sync failed: ${message}`);
    }
    // The timer run records the failure (sync-state.json, the log) and exits
    // 0 so its unit does not linger in a failed state; a manual run fails.
    process.exitCode = quiet ? 0 : 1;
  }
}
