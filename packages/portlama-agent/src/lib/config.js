import { readFile, writeFile, rename, mkdir, open } from 'node:fs/promises';
import { agentConfigPath, agentDataDir } from './platform.js';

/**
 * Load the agent config for a given label.
 * Reads from ~/.portlama/agents/<label>/config.json.
 * Returns null if the file does not exist.
 *
 * @param {string} label - Agent label
 * @returns {Promise<object | null>}
 */
export async function loadAgentConfig(label) {
  try {
    const configPath = agentConfigPath(label);
    const raw = await readFile(configPath, 'utf8');
    const config = JSON.parse(raw);
    // Default authMethod to 'p12' for backwards compatibility
    if (config && !config.authMethod) {
      config.authMethod = 'p12';
    }
    return config;
  } catch {
    return null;
  }
}

/**
 * Save the agent config atomically (write tmp -> rename).
 * @param {string} label - Agent label
 * @param {object} config
 */
export async function saveAgentConfig(label, config) {
  const dataDir = agentDataDir(label);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const configPath = agentConfigPath(label);
  const tmp = configPath + '.tmp';
  await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  const fd = await open(tmp, 'r');
  await fd.sync();
  await fd.close();
  await rename(tmp, configPath);
}

/**
 * Load agent config or throw if it doesn't exist.
 * Used by commands that require prior setup.
 * @param {string} label - Agent label
 * @returns {Promise<object>}
 */
export async function requireAgentConfig(label) {
  const config = await loadAgentConfig(label);
  if (!config) {
    throw new Error(
      `No agent configuration found for "${label}". Run "portlama-agent setup --label ${label}" first.`,
    );
  }
  return config;
}
