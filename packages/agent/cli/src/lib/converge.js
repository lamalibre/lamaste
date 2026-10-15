import { convergeChiselService, requireAgentConfig } from '@lamalibre/lamaste/agent';
import { createPluginConfigDeliverer, repairAppHostRecord } from './app-host-jobs.js';
import {
  acknowledgePluginConfig,
  fetchAgentConfig,
  fetchChiselCredential,
  fetchPluginConfig,
  rotateChiselCredential,
} from './panel-api.js';

/**
 * Fetch this agent's configuration from its panel and converge the local
 * chisel client with it (see `convergeChiselService` in
 * @lamalibre/lamaste/agent). The one refresh path of every CLI command. A
 * plugin config for an agent half the app host helper installed is handed
 * to its service before it is acknowledged; `delivered` lists those routes.
 *
 * @param {string} label
 * @param {{ forceRestart?: boolean }} [options]
 * @returns {Promise<{ result: import('@lamalibre/lamaste/agent').ConvergeResult, response: object, delivered: string[] }>}
 */
export async function convergeWithPanel(label, options = {}) {
  const config = await requireAgentConfig(label);
  const response = await fetchAgentConfig(config);
  // An unreadable record of the agent halves installed here is rebuilt from
  // the helper's owner records; otherwise the config sync fails closed.
  await repairAppHostRecord(label);
  const deliverer = createPluginConfigDeliverer(label);
  const result = await convergeChiselService(
    label,
    response,
    {
      fetchChiselCredential: () => fetchChiselCredential(config),
      rotateChiselCredential: () => rotateChiselCredential(config),
      fetchPluginConfig: (route) => fetchPluginConfig(config, route),
      acknowledgePluginConfig: (route, issuedAt) =>
        acknowledgePluginConfig(config, route, issuedAt),
      deliverPluginConfig: (route, pluginConfig) => deliverer.deliver(route, pluginConfig),
    },
    options,
  );
  return { result, response, delivered: deliverer.delivered };
}

/**
 * One-line, human-readable summary of a converge result.
 * @param {import('@lamalibre/lamaste/agent').ConvergeResult} result
 * @returns {string}
 */
export function describeConverge(result) {
  const parts = [];
  if (result.state === 'running') {
    parts.push(`carrying ${result.tunnels} tunnel(s)`);
  } else if (result.state === 'idle') {
    parts.push('no tunnels assigned — tunnel client stopped');
  } else {
    parts.push('tunnels stopped by the operator');
  }
  if (result.serviceChanged) parts.push('service (re)started');
  if (result.credential === 'rotated') parts.push('chisel credential rotated');
  if (result.credential === 'fetched') parts.push('new chisel credential fetched');
  if (result.binaryUpdated) parts.push('chisel binary updated');
  const app = result.appPlugins;
  if (app?.fetched?.length) parts.push(`plugin config fetched: ${app.fetched.join(', ')}`);
  if (app?.acknowledged?.length)
    parts.push(`plugin config acknowledged: ${app.acknowledged.join(', ')}`);
  if (app?.removed?.length) parts.push(`plugin config removed: ${app.removed.join(', ')}`);
  return parts.join('; ');
}
