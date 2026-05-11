import { readFile, writeFile, rename, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { loadAgentRegistry, saveAgentRegistry, withRegistryLock } from './mtls.js';
import { isIpAllowed } from './ip-utils.js';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';

// Promise-chain mutex to serialize push install modifications
let pushInstallLock = Promise.resolve();
function withPushInstallLock(fn) {
  const prev = pushInstallLock;
  let resolve;
  pushInstallLock = new Promise((r) => {
    resolve = r;
  });
  return prev.then(fn).finally(resolve);
}

// --- Push install config ---

function pushInstallConfigPath() {
  return path.join(STATE_DIR, 'push-install-config.json');
}

const DEFAULT_POLICY = {
  id: 'default',
  name: 'Default',
  description: 'Standard push install policy',
  allowedIps: [],
  deniedIps: [],
  allowedPlugins: [],
  allowedActions: ['install', 'update', 'check-prerequisites'],
};

const DEFAULT_PUSH_INSTALL_CONFIG = {
  enabled: false,
  policies: [structuredClone(DEFAULT_POLICY)],
  defaultPolicy: 'default',
};

/**
 * Read push install configuration from disk.
 * Returns defaults if the file does not exist.
 */
export async function readPushInstallConfig() {
  try {
    const raw = await readFile(pushInstallConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw);

    return {
      enabled: parsed.enabled ?? false,
      policies: Array.isArray(parsed.policies)
        ? parsed.policies
        : [structuredClone(DEFAULT_POLICY)],
      defaultPolicy: parsed.defaultPolicy || 'default',
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return structuredClone(DEFAULT_PUSH_INSTALL_CONFIG);
    }
    throw new Error(`Failed to read push install config: ${err.message}`);
  }
}

/**
 * Write push install configuration to disk atomically.
 */
export async function writePushInstallConfig(config) {
  const filePath = pushInstallConfigPath();
  const tmpPath = `${filePath}.tmp`;

  const content = JSON.stringify(config, null, 2) + '\n';
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });

  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, filePath);
}

// --- Push install sessions audit log ---

function pushInstallSessionsPath() {
  return path.join(STATE_DIR, 'push-install-sessions.json');
}

/**
 * Read the push install sessions audit log.
 */
export async function readPushInstallSessions() {
  try {
    const raw = await readFile(pushInstallSessionsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to read push install sessions: ${err.message}`);
  }
}

/**
 * Write the push install sessions audit log atomically.
 */
async function writePushInstallSessions(sessions) {
  const filePath = pushInstallSessionsPath();
  const tmpPath = `${filePath}.tmp`;

  const content = JSON.stringify(sessions, null, 2) + '\n';
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });

  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, filePath);
}

/**
 * Add a session entry to the push install audit log.
 * Wrapped in withPushInstallLock to prevent concurrent read-modify-write races.
 */
export function logPushInstallSession(entry) {
  return withPushInstallLock(async () => {
    const sessions = await readPushInstallSessions();
    sessions.push({
      id: randomUUID(),
      ...entry,
      timestamp: new Date().toISOString(),
    });
    // Keep last 500 entries
    if (sessions.length > 500) {
      sessions.splice(0, sessions.length - 500);
    }
    await writePushInstallSessions(sessions);
    return sessions[sessions.length - 1];
  });
}

/**
 * Atomically update push install configuration fields.
 * Serialized through the lock to prevent lost updates.
 *
 * @param {{ enabled?: boolean, defaultPolicy?: string }} updates
 * @returns {Promise<object>} The updated config
 */
export function updatePushInstallConfigFields(updates) {
  return withPushInstallLock(async () => {
    const config = await readPushInstallConfig();

    if (updates.enabled !== undefined) {
      config.enabled = updates.enabled;
    }

    if (updates.defaultPolicy !== undefined) {
      const policy = config.policies.find((p) => p.id === updates.defaultPolicy);
      if (!policy) {
        throw Object.assign(new Error(`Policy "${updates.defaultPolicy}" not found`), {
          statusCode: 400,
        });
      }
      config.defaultPolicy = updates.defaultPolicy;
    }

    await writePushInstallConfig(config);
    return config;
  });
}

// --- Policy CRUD ---

/**
 * Slugify a policy name to generate an ID.
 */
function slugifyPolicyName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Create a new push install policy.
 */
export function createPushInstallPolicy(policyData) {
  return withPushInstallLock(async () => {
    const config = await readPushInstallConfig();
    const id = policyData.id || slugifyPolicyName(policyData.name);

    if (!id) {
      throw Object.assign(new Error('Policy name cannot be empty'), { statusCode: 400 });
    }

    const existing = config.policies.find((p) => p.id === id);
    if (existing) {
      throw Object.assign(new Error(`Policy "${id}" already exists`), { statusCode: 409 });
    }

    const policy = {
      ...structuredClone(DEFAULT_POLICY),
      ...policyData,
      id,
    };

    config.policies.push(policy);
    await writePushInstallConfig(config);

    return policy;
  });
}

/**
 * Update an existing push install policy.
 */
export function updatePushInstallPolicy(id, updates) {
  return withPushInstallLock(async () => {
    const config = await readPushInstallConfig();
    const policy = config.policies.find((p) => p.id === id);

    if (!policy) {
      throw Object.assign(new Error(`Policy "${id}" not found`), { statusCode: 404 });
    }

    // Apply updates (only defined fields)
    if (updates.name !== undefined) policy.name = updates.name;
    if (updates.description !== undefined) policy.description = updates.description;
    if (updates.allowedIps !== undefined) policy.allowedIps = updates.allowedIps;
    if (updates.deniedIps !== undefined) policy.deniedIps = updates.deniedIps;
    if (updates.allowedPlugins !== undefined) policy.allowedPlugins = updates.allowedPlugins;
    if (updates.allowedActions !== undefined) policy.allowedActions = updates.allowedActions;

    await writePushInstallConfig(config);
    return policy;
  });
}

/**
 * Delete a push install policy.
 */
export function deletePushInstallPolicy(id) {
  return withPushInstallLock(async () => {
    const config = await readPushInstallConfig();

    if (id === 'default') {
      throw Object.assign(new Error('Cannot delete the default policy'), { statusCode: 400 });
    }

    const index = config.policies.findIndex((p) => p.id === id);
    if (index === -1) {
      throw Object.assign(new Error(`Policy "${id}" not found`), { statusCode: 404 });
    }

    config.policies.splice(index, 1);

    // If defaultPolicy was the deleted one, reset to 'default'
    if (config.defaultPolicy === id) {
      config.defaultPolicy = 'default';
    }

    await writePushInstallConfig(config);
    return { ok: true, id };
  });
}

// --- Agent push install access management ---

/**
 * Enable push install access for an agent certificate.
 * Sets `pushInstallEnabledUntil` and `pushInstallPolicy` on the agent registry entry.
 *
 * @param {string} label - Agent label
 * @param {number} durationMinutes - Session window length in minutes
 * @param {string} [policyId] - Policy ID to assign (defaults to config's defaultPolicy)
 */
export async function enableAgentPushInstall(label, durationMinutes, policyId) {
  // Read push-install config under its own lock
  const config = await withPushInstallLock(() => readPushInstallConfig());

  if (!config.enabled) {
    throw Object.assign(new Error('Push install is not enabled globally'), { statusCode: 400 });
  }

  // Resolve which policy to assign
  const resolvedPolicyId = policyId || config.defaultPolicy;
  const policy = config.policies.find((p) => p.id === resolvedPolicyId);
  if (!policy) {
    throw Object.assign(new Error(`Policy "${resolvedPolicyId}" not found`), { statusCode: 404 });
  }

  // Modify agent registry under the registry lock (shared with mtls.js)
  return withRegistryLock(async () => {
    const registry = await loadAgentRegistry();
    const agent = registry.agents.find((a) => a.label === label && !a.revoked);

    if (!agent) {
      throw Object.assign(new Error(`Agent certificate "${label}" not found`), { statusCode: 404 });
    }

    const until = new Date(Date.now() + durationMinutes * 60 * 1000);
    agent.pushInstallEnabledUntil = until.toISOString();
    agent.pushInstallPolicy = resolvedPolicyId;
    await saveAgentRegistry(registry);

    return {
      ok: true,
      label,
      pushInstallEnabledUntil: agent.pushInstallEnabledUntil,
      pushInstallPolicy: agent.pushInstallPolicy,
    };
  });
}

/**
 * Disable push install access for an agent certificate.
 */
export async function disableAgentPushInstall(label) {
  // Modify agent registry under the registry lock (shared with mtls.js)
  return withRegistryLock(async () => {
    const registry = await loadAgentRegistry();
    const agent = registry.agents.find((a) => a.label === label && !a.revoked);

    if (!agent) {
      throw Object.assign(new Error(`Agent certificate "${label}" not found`), { statusCode: 404 });
    }

    delete agent.pushInstallEnabledUntil;
    delete agent.pushInstallPolicy;
    await saveAgentRegistry(registry);

    return { ok: true, label };
  });
}

/**
 * Run the 5-gate auth check for push install access to an agent.
 *
 * 1. Global push install enabled
 * 2. Agent cert exists and is not revoked
 * 3. Agent pushInstallEnabledUntil is in the future
 * 4. Source IP passes the agent's assigned policy allow/deny lists
 * 5. (Caller is admin — enforced by route preHandler, not checked here)
 *
 * @param {string} label - Agent label
 * @param {string} sourceIp - Requesting client's IP address
 * @returns {Promise<{ ok: true, agent: object, config: object, policy: object } | { ok: false, error: string, statusCode: number }>}
 */
export async function validatePushInstallAccess(label, sourceIp) {
  // Gate 1: Global push install enabled
  const config = await readPushInstallConfig();
  if (!config.enabled) {
    return { ok: false, error: 'Push install is not enabled globally', statusCode: 400 };
  }

  // Gate 2: Agent cert exists and is not revoked
  const registry = await loadAgentRegistry();
  const agent = registry.agents.find((a) => a.label === label && !a.revoked);
  if (!agent) {
    return { ok: false, error: `Agent certificate "${label}" not found`, statusCode: 404 };
  }

  // Gate 3: Agent pushInstallEnabledUntil is in the future
  if (!agent.pushInstallEnabledUntil || new Date(agent.pushInstallEnabledUntil) <= new Date()) {
    return {
      ok: false,
      error: `Push install access not enabled for agent "${label}"`,
      statusCode: 403,
    };
  }

  // Resolve the agent's assigned policy
  const policyId = agent.pushInstallPolicy || config.defaultPolicy;
  const policy = config.policies.find((p) => p.id === policyId);
  if (!policy) {
    return {
      ok: false,
      error: `Policy "${policyId}" not found in push install configuration`,
      statusCode: 500,
    };
  }

  // Gate 4: Source IP passes the policy's allow/deny lists
  if (!isIpAllowed(sourceIp, policy.allowedIps, policy.deniedIps)) {
    return { ok: false, error: 'Source IP is not allowed', statusCode: 403 };
  }

  return { ok: true, agent, config, policy };
}
