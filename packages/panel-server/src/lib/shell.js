import { readFile, writeFile, rename, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { loadAgentRegistry, saveAgentRegistry } from './mtls.js';

const STATE_DIR = process.env.PORTLAMA_STATE_DIR || '/etc/portlama';

// Promise-chain mutex to serialize shell config modifications
let shellLock = Promise.resolve();
function withShellLock(fn) {
  const prev = shellLock;
  let resolve;
  shellLock = new Promise((r) => {
    resolve = r;
  });
  return prev.then(fn).finally(resolve);
}

// --- Shell config ---

function shellConfigPath() {
  return path.join(STATE_DIR, 'shell-config.json');
}

const DEFAULT_POLICY = {
  id: 'default',
  name: 'Default',
  description: 'Standard shell access with restricted commands',
  allowedIps: [],
  deniedIps: [],
  maxFileSize: 100 * 1024 * 1024, // 100MB
  inactivityTimeout: 600, // 10 minutes in seconds
  commandBlocklist: {
    hardBlocked: [
      'rm -rf /',
      'rm -rf /*',
      'rm -rf ~',
      'rm -rf ~/*',
      'mkfs',
      'dd if=',
      ':(){ :|:& };:',
      'shutdown',
      'reboot',
      'halt',
      'poweroff',
      'chmod -R 777 /',
      '> /dev/sda',
      '> /dev/disk',
      'curl|sh',
      'curl|bash',
      'wget|sh',
      'wget|bash',
    ],
    restricted: {
      sudo: false,
      su: false,
      launchctl: false,
      systemctl: false,
      networksetup: false,
      ifconfig: false,
      diskutil: false,
      iptables: false,
      ufw: false,
    },
  },
};

const DEFAULT_SHELL_CONFIG = {
  enabled: false,
  policies: [structuredClone(DEFAULT_POLICY)],
  defaultPolicy: 'default',
};

/**
 * Deep-merge a single policy with the default policy template to ensure
 * all nested fields exist.
 */
function mergePolicyWithDefaults(policy) {
  return {
    ...structuredClone(DEFAULT_POLICY),
    ...policy,
    commandBlocklist: {
      ...structuredClone(DEFAULT_POLICY.commandBlocklist),
      ...(policy.commandBlocklist || {}),
      restricted: {
        ...structuredClone(DEFAULT_POLICY.commandBlocklist.restricted),
        ...(policy.commandBlocklist?.restricted || {}),
      },
    },
  };
}

/**
 * Read shell configuration from disk.
 * Returns defaults if the file does not exist.
 */
export async function readShellConfig() {
  try {
    const raw = await readFile(shellConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw);

    // Handle legacy flat config by migrating to policy-based structure
    if (!Array.isArray(parsed.policies)) {
      const legacyPolicy = {
        id: 'default',
        name: 'Default',
        description: 'Standard shell access with restricted commands',
        allowedIps: parsed.allowedIps || [],
        deniedIps: parsed.deniedIps || [],
        maxFileSize: parsed.maxFileSize ?? DEFAULT_POLICY.maxFileSize,
        inactivityTimeout: parsed.inactivityTimeout ?? DEFAULT_POLICY.inactivityTimeout,
        commandBlocklist: {
          ...DEFAULT_POLICY.commandBlocklist,
          ...(parsed.commandBlocklist || {}),
          restricted: {
            ...DEFAULT_POLICY.commandBlocklist.restricted,
            ...(parsed.commandBlocklist?.restricted || {}),
          },
        },
      };
      return {
        enabled: parsed.enabled ?? false,
        policies: [legacyPolicy],
        defaultPolicy: 'default',
      };
    }

    // Merge each policy with defaults to ensure all fields exist
    const policies = parsed.policies.map((p) => mergePolicyWithDefaults(p));

    return {
      enabled: parsed.enabled ?? false,
      policies,
      defaultPolicy: parsed.defaultPolicy || 'default',
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return structuredClone(DEFAULT_SHELL_CONFIG);
    }
    throw new Error(`Failed to read shell config: ${err.message}`);
  }
}

/**
 * Write shell configuration to disk atomically.
 */
export async function writeShellConfig(config) {
  const filePath = shellConfigPath();
  const tmpPath = `${filePath}.tmp`;

  const content = JSON.stringify(config, null, 2) + '\n';
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });

  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, filePath);
}

// --- Shell sessions audit log ---

function shellSessionsPath() {
  return path.join(STATE_DIR, 'shell-sessions.json');
}

/**
 * Read the shell sessions audit log.
 */
export async function readShellSessions() {
  try {
    const raw = await readFile(shellSessionsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to read shell sessions: ${err.message}`);
  }
}

/**
 * Write the shell sessions audit log atomically.
 */
export async function writeShellSessions(sessions) {
  const filePath = shellSessionsPath();
  const tmpPath = `${filePath}.tmp`;

  const content = JSON.stringify(sessions, null, 2) + '\n';
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });

  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, filePath);
}

/**
 * Add a session entry to the audit log.
 * Wrapped in withShellLock to prevent concurrent read-modify-write races.
 */
export function logShellSession(entry) {
  return withShellLock(async () => {
    const sessions = await readShellSessions();
    sessions.push({
      id: randomUUID(),
      ...entry,
      startedAt: new Date().toISOString(),
    });
    // Keep last 500 entries
    if (sessions.length > 500) {
      sessions.splice(0, sessions.length - 500);
    }
    await writeShellSessions(sessions);
    return sessions[sessions.length - 1];
  });
}

/**
 * Update an existing session entry in the audit log by ID.
 * Wrapped in withShellLock to prevent concurrent read-modify-write races.
 *
 * @param {string} sessionId - The session ID to update
 * @param {object} updates - Fields to merge into the session entry
 * @returns {Promise<object|null>} The updated entry, or null if not found
 */
export function updateShellSession(sessionId, updates) {
  return withShellLock(async () => {
    const sessions = await readShellSessions();
    const entry = sessions.find((s) => s.id === sessionId);
    if (!entry) return null;
    Object.assign(entry, updates);
    await writeShellSessions(sessions);
    return entry;
  });
}

// --- Agent shell access management ---

/**
 * Enable shell access for an agent certificate.
 * Sets `shellEnabledUntil` and `shellPolicy` on the agent registry entry.
 *
 * @param {string} label - Agent label
 * @param {number} durationMinutes - Session window length in minutes
 * @param {string} [policyId] - Policy ID to assign (defaults to config's defaultPolicy)
 */
export async function enableAgentShell(label, durationMinutes, policyId) {
  return withShellLock(async () => {
    const config = await readShellConfig();

    // Resolve which policy to assign
    const resolvedPolicyId = policyId || config.defaultPolicy;
    const policy = config.policies.find((p) => p.id === resolvedPolicyId);
    if (!policy) {
      throw Object.assign(new Error(`Policy "${resolvedPolicyId}" not found`), {
        statusCode: 404,
      });
    }

    const registry = await loadAgentRegistry();
    const agent = registry.agents.find((a) => a.label === label && !a.revoked);

    if (!agent) {
      throw Object.assign(new Error(`Agent certificate "${label}" not found`), {
        statusCode: 404,
      });
    }

    const until = new Date(Date.now() + durationMinutes * 60 * 1000);
    agent.shellEnabledUntil = until.toISOString();
    agent.shellPolicy = resolvedPolicyId;
    await saveAgentRegistry(registry);

    return {
      ok: true,
      label,
      shellEnabledUntil: agent.shellEnabledUntil,
      shellPolicy: agent.shellPolicy,
    };
  });
}

/**
 * Disable shell access for an agent certificate.
 * Removes `shellEnabledUntil` and `shellPolicy` from the agent registry entry.
 */
export async function disableAgentShell(label) {
  return withShellLock(async () => {
    const registry = await loadAgentRegistry();
    const agent = registry.agents.find((a) => a.label === label && !a.revoked);

    if (!agent) {
      throw Object.assign(new Error(`Agent certificate "${label}" not found`), {
        statusCode: 404,
      });
    }

    delete agent.shellEnabledUntil;
    delete agent.shellPolicy;
    await saveAgentRegistry(registry);

    return { ok: true, label };
  });
}

/**
 * Check if shell access is currently allowed for an agent.
 * Returns true only if shellEnabledUntil is set and in the future.
 */
export function isAgentShellEnabled(agent) {
  if (!agent || agent.revoked) return false;
  if (!agent.shellEnabledUntil) return false;
  return new Date(agent.shellEnabledUntil) > new Date();
}

// --- Reusable shell access validation ---

/**
 * Run the 5-gate auth check for shell access to an agent.
 *
 * 1. Global shell enabled
 * 2. Agent cert exists and is not revoked
 * 3. Agent shellEnabledUntil is in the future
 * 4. Source IP passes the agent's assigned policy allow/deny lists
 * 5. (Caller is admin — enforced by route preHandler, not checked here)
 *
 * @param {string} label - Agent label
 * @param {string} sourceIp - Requesting client's IP address
 * @returns {Promise<{ ok: true, agent: object, config: object, policy: object } | { ok: false, error: string, statusCode: number }>}
 */
export async function validateShellAccess(label, sourceIp) {
  // Gate 1: Global shell enabled
  const config = await readShellConfig();
  if (!config.enabled) {
    return { ok: false, error: 'Remote shell is not enabled globally', statusCode: 400 };
  }

  // Gate 2: Agent cert exists and is not revoked
  const registry = await loadAgentRegistry();
  const agent = registry.agents.find((a) => a.label === label && !a.revoked);
  if (!agent) {
    return { ok: false, error: `Agent certificate "${label}" not found`, statusCode: 404 };
  }

  // Gate 3: Agent shellEnabledUntil is in the future
  if (!isAgentShellEnabled(agent)) {
    return {
      ok: false,
      error: `Shell access not enabled for agent "${label}"`,
      statusCode: 403,
    };
  }

  // Resolve the agent's assigned policy
  const policyId = agent.shellPolicy || config.defaultPolicy;
  const policy = config.policies.find((p) => p.id === policyId);
  if (!policy) {
    return {
      ok: false,
      error: `Policy "${policyId}" not found in shell configuration`,
      statusCode: 500,
    };
  }

  // Gate 4: Source IP passes the policy's allow/deny lists
  if (!isIpAllowed(sourceIp, policy.allowedIps, policy.deniedIps)) {
    return { ok: false, error: 'Source IP is not allowed', statusCode: 403 };
  }

  return { ok: true, agent, config, policy };
}

// --- IP access control ---

/**
 * Check if an IP address is allowed by the shell access control lists.
 *
 * Rules:
 * - deniedIps takes precedence over allowedIps
 * - Empty allowedIps means all IPs allowed
 * - If allowedIps has entries, only those IPs/CIDRs can connect
 *
 * @param {string} ip - Source IP address
 * @param {string[]} allowedIps - Allow list (CIDR or single IP)
 * @param {string[]} deniedIps - Deny list (CIDR or single IP)
 * @returns {boolean}
 */
export function isIpAllowed(ip, allowedIps, deniedIps) {
  // Check deny list first (takes precedence)
  if (deniedIps.length > 0 && matchesAny(ip, deniedIps)) {
    return false;
  }

  // Empty allow list means all IPs allowed
  if (allowedIps.length === 0) {
    return true;
  }

  // Check allow list
  return matchesAny(ip, allowedIps);
}

/**
 * Strip the ::ffff: prefix from IPv4-mapped IPv6 addresses so that
 * comparisons work consistently against plain IPv4 entries.
 */
function normalizeIp(ip) {
  if (ip.startsWith('::ffff:')) {
    return ip.slice(7);
  }
  return ip;
}

/**
 * Check if an IP matches any entry in a list of IPs/CIDRs.
 */
function matchesAny(ip, list) {
  const normalized = normalizeIp(ip);
  for (const entry of list) {
    const normalizedEntry = normalizeIp(entry);
    if (normalizedEntry.includes('/')) {
      if (ipInCidr(normalized, normalizedEntry)) return true;
    } else {
      if (normalized === normalizedEntry) return true;
    }
  }
  return false;
}

/**
 * Check if an IPv4 address is within a CIDR range.
 */
function ipInCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  if (bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : ~(2 ** (32 - bits) - 1);
  const ipNum = ipToNum(ip);
  const rangeNum = ipToNum(range);
  if (ipNum === null || rangeNum === null) return false;
  return (ipNum & mask) === (rangeNum & mask);
}

/**
 * Convert an IPv4 address string to a 32-bit number.
 */
function ipToNum(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}
