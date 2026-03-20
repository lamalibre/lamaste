import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { CONFIG_PATH, AGENT_DIR } from './platform.js';

/**
 * Load the agent config from ~/.portlama/agent.json.
 * Returns null if the file does not exist.
 * @returns {Promise<object | null>}
 */
export async function loadAgentConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Save the agent config atomically (write tmp → rename).
 * @param {object} config
 */
export async function saveAgentConfig(config) {
  await mkdir(AGENT_DIR, { recursive: true, mode: 0o700 });
  const tmp = CONFIG_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, CONFIG_PATH);
}

/**
 * Load agent config or throw if it doesn't exist.
 * Used by commands that require prior setup.
 * @returns {Promise<object>}
 */
export async function requireAgentConfig() {
  const config = await loadAgentConfig();
  if (!config) {
    throw new Error('No agent configuration found. Run "portlama-agent setup" first.');
  }
  return config;
}
