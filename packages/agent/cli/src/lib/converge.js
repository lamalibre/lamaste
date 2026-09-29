import { convergeChiselService, requireAgentConfig } from '@lamalibre/lamaste/agent';
import { fetchAgentConfig, fetchChiselCredential, rotateChiselCredential } from './panel-api.js';

/**
 * Fetch this agent's configuration from its panel and converge the local
 * chisel client with it (see `convergeChiselService` in
 * @lamalibre/lamaste/agent). The one refresh path of every CLI command.
 *
 * @param {string} label
 * @param {{ forceRestart?: boolean }} [options]
 * @returns {Promise<{ result: import('@lamalibre/lamaste/agent').ConvergeResult, response: object }>}
 */
export async function convergeWithPanel(label, options = {}) {
  const config = await requireAgentConfig(label);
  const response = await fetchAgentConfig(config);
  const result = await convergeChiselService(
    label,
    response,
    {
      fetchChiselCredential: () => fetchChiselCredential(config),
      rotateChiselCredential: () => rotateChiselCredential(config),
    },
    options,
  );
  return { result, response };
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
  return parts.join('; ');
}
