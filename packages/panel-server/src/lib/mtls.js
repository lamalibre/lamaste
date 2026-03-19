import { execa } from 'execa';
import crypto from 'node:crypto';
import { access, constants, readFile, writeFile, rename, open } from 'node:fs/promises';
import { addToRevocationList } from './revocation.js';

const PKI_DIR = process.env.PORTLAMA_PKI_DIR || '/etc/portlama/pki';

// Promise-chain mutex to serialize agent registry modifications
let registryLock = Promise.resolve();
function withRegistryLock(fn) {
  const prev = registryLock;
  let resolve;
  registryLock = new Promise((r) => { resolve = r; });
  return prev.then(fn).finally(resolve);
}

/**
 * Read the expiry date from a certificate file using openssl.
 *
 * @param {string} certPath - Absolute path to the certificate file
 * @returns {{ expiresAt: string, daysUntilExpiry: number } | null}
 */
export async function readCertExpiry(certPath) {
  try {
    const { stdout } = await execa('sudo', [
      'openssl', 'x509', '-in', certPath, '-enddate', '-noout',
    ]);
    const match = stdout.match(/notAfter=(.+)/);
    if (!match) return null;

    const expiryDate = new Date(match[1]);
    if (isNaN(expiryDate.getTime())) return null;

    const daysUntilExpiry = Math.floor(
      (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );

    return {
      expiresAt: expiryDate.toISOString(),
      daysUntilExpiry,
    };
  } catch {
    return null;
  }
}

/**
 * Get mTLS certificate info (CA and client certs).
 *
 * @returns {Array<{ type: string, domain: null, expiresAt: string, daysUntilExpiry: number, path: string, expiringSoon: boolean }>}
 */
export async function getMtlsCerts() {
  const certs = [];

  const certFiles = [
    { type: 'mtls-ca', filename: 'ca.crt' },
    { type: 'mtls-client', filename: 'client.crt' },
  ];

  for (const { type, filename } of certFiles) {
    const certPath = `${PKI_DIR}/${filename}`;

    try {
      await access(certPath, constants.R_OK);
    } catch {
      // File doesn't exist or not readable — skip silently
      continue;
    }

    const expiry = await readCertExpiry(certPath);
    if (!expiry) continue;

    certs.push({
      type,
      domain: null,
      expiresAt: expiry.expiresAt,
      daysUntilExpiry: expiry.daysUntilExpiry,
      path: certPath,
      expiringSoon: expiry.daysUntilExpiry <= 30,
    });
  }

  return certs;
}

/**
 * Rotate the mTLS client certificate.
 * Generates a new key, CSR, signs with existing CA, creates PKCS12 bundle.
 * Backs up old files before replacement.
 *
 * @param {import('pino').Logger} logger
 * @returns {{ ok: true, p12Password: string, expiresAt: string, warning: string }}
 */
export async function rotateClientCert(logger) {
  // Verify CA key exists
  try {
    await access(`${PKI_DIR}/ca.key`, constants.R_OK);
  } catch {
    // Try with sudo
    try {
      await execa('sudo', ['test', '-r', `${PKI_DIR}/ca.key`]);
    } catch {
      throw Object.assign(
        new Error('CA key not found — cannot sign new certificate'),
        { statusCode: 500 },
      );
    }
  }

  const newKeyPath = `${PKI_DIR}/client.key.new`;
  const csrPath = `${PKI_DIR}/client.csr`;
  const newCertPath = `${PKI_DIR}/client.crt.new`;
  const newP12Path = `${PKI_DIR}/client.p12.new`;

  const p12Password = crypto.randomBytes(16).toString('hex');

  try {
    // 1. Generate new client private key
    logger.info('Generating new client private key');
    await execa('sudo', ['openssl', 'genrsa', '-out', newKeyPath, '4096']);

    // 2. Create CSR
    logger.info('Creating certificate signing request');
    await execa('sudo', [
      'openssl', 'req', '-new',
      '-key', newKeyPath,
      '-out', csrPath,
      '-subj', '/CN=Portlama Client/O=Portlama',
    ]);

    // 3. Sign with CA (2-year validity)
    logger.info('Signing certificate with CA');
    await execa('sudo', [
      'openssl', 'x509', '-req',
      '-in', csrPath,
      '-CA', `${PKI_DIR}/ca.crt`,
      '-CAkey', `${PKI_DIR}/ca.key`,
      '-CAcreateserial',
      '-out', newCertPath,
      '-days', '730',
      '-sha256',
    ]);

    // 4. Create PKCS12 bundle
    logger.info('Creating PKCS12 bundle');
    await execa('sudo', [
      'openssl', 'pkcs12', '-export',
      '-keypbe', 'PBE-SHA1-3DES',
      '-certpbe', 'PBE-SHA1-3DES',
      '-macalg', 'sha1',
      '-out', newP12Path,
      '-inkey', newKeyPath,
      '-in', newCertPath,
      '-certfile', `${PKI_DIR}/ca.crt`,
      '-passout', 'stdin',
    ], { input: p12Password });

    // 5. Back up current files
    logger.info('Backing up current certificates');
    await execa('sudo', ['cp', `${PKI_DIR}/client.crt`, `${PKI_DIR}/client.crt.bak`]);
    await execa('sudo', ['cp', `${PKI_DIR}/client.key`, `${PKI_DIR}/client.key.bak`]);
    await execa('sudo', ['cp', `${PKI_DIR}/client.p12`, `${PKI_DIR}/client.p12.bak`]);

    // 6. Move new files into place
    logger.info('Installing new certificates');
    await execa('sudo', ['mv', newKeyPath, `${PKI_DIR}/client.key`]);
    await execa('sudo', ['mv', newCertPath, `${PKI_DIR}/client.crt`]);
    await execa('sudo', ['mv', newP12Path, `${PKI_DIR}/client.p12`]);

    // 7. Clean up CSR and serial file
    await execa('sudo', ['rm', '-f', csrPath, `${PKI_DIR}/ca.srl`]);

    // 8. Set file permissions and ownership
    await execa('sudo', ['chmod', '600', `${PKI_DIR}/client.key`]);
    await execa('sudo', ['chmod', '644', `${PKI_DIR}/client.crt`]);
    await execa('sudo', ['chmod', '600', `${PKI_DIR}/client.p12`]);
    await execa('sudo', ['chown', 'portlama:portlama',
      `${PKI_DIR}/client.key`, `${PKI_DIR}/client.crt`, `${PKI_DIR}/client.p12`,
      `${PKI_DIR}/client.key.bak`, `${PKI_DIR}/client.crt.bak`, `${PKI_DIR}/client.p12.bak`,
    ]);

    // 9. Read the new expiry
    const expiry = await readCertExpiry(`${PKI_DIR}/client.crt`);

    return {
      ok: true,
      p12Password,
      expiresAt: expiry?.expiresAt || new Date(Date.now() + 730 * 86400000).toISOString(),
      warning: 'Your current browser certificate is now invalid. Download and import the new certificate before closing this page.',
    };
  } catch (err) {
    // If any step fails, clean up .new files and preserve existing certs
    logger.error({ err }, 'mTLS rotation failed, cleaning up');
    await execa('sudo', ['rm', '-f', newKeyPath, csrPath, newCertPath, newP12Path]).catch(() => {});

    if (err.statusCode) throw err;
    throw Object.assign(
      new Error(`mTLS rotation failed: ${err.stderr || err.message}`),
      { statusCode: 500 },
    );
  }
}

/**
 * Get the path to the client.p12 file.
 *
 * @returns {string}
 */
export function getP12Path() {
  return `${PKI_DIR}/client.p12`;
}

// ---------------------------------------------------------------------------
// Agent certificate management
// ---------------------------------------------------------------------------

const AGENTS_DIR = `${PKI_DIR}/agents`;

/**
 * Valid capabilities that can be assigned to agent certificates.
 * - tunnels:read is always-on (mandatory baseline for all agents)
 */
export const VALID_CAPABILITIES = [
  'tunnels:read',
  'tunnels:write',
  'services:read',
  'services:write',
  'system:read',
  'sites:read',
  'sites:write',
];

/**
 * Load the agent registry from disk.
 * Returns `{ agents: [] }` if the file does not exist.
 *
 * @returns {Promise<{ agents: Array }>}
 */
export async function loadAgentRegistry() {
  try {
    const raw = await readFile(`${AGENTS_DIR}/registry.json`, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.agents)) {
      return { agents: [] };
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { agents: [] };
    }
    throw new Error(`Failed to read agent registry: ${err.message}`);
  }
}

/**
 * Atomically save the agent registry to disk.
 * Writes to a temp file, fsyncs, then renames into place.
 *
 * @param {{ agents: Array }} data
 */
export async function saveAgentRegistry(data) {
  const filePath = `${AGENTS_DIR}/registry.json`;
  const tmpPath = `${filePath}.tmp`;

  const content = JSON.stringify(data, null, 2) + '\n';
  await writeFile(tmpPath, content, 'utf-8');

  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, filePath);
}

/**
 * Get the path to an agent's PKCS12 bundle.
 *
 * @param {string} label
 * @returns {string}
 */
export function getAgentP12Path(label) {
  return `${AGENTS_DIR}/${label}/client.p12`;
}

/**
 * Generate an agent-scoped client certificate.
 *
 * Creates a new RSA key, CSR, signs with the existing CA, and packages
 * the result as a PKCS12 bundle (legacy PBE-SHA1-3DES for macOS compat).
 *
 * @param {string} label - Unique agent label (e.g. "macbook-pro")
 * @param {import('pino').Logger} logger
 * @param {string[]} [capabilities] - Capability list (defaults to ['tunnels:read'])
 * @param {string[]} [allowedSites] - Allowed site labels (defaults to [])
 * @returns {Promise<{ label: string, p12Password: string, serial: string, expiresAt: string }>}
 */
export async function generateAgentCert(label, logger, capabilities, allowedSites) {
  return withRegistryLock(async () => {
  // Check registry for duplicate (non-revoked) label
  const registry = await loadAgentRegistry();
  const existing = registry.agents.find(
    (a) => a.label === label && !a.revoked,
  );
  if (existing) {
    throw Object.assign(
      new Error(`Agent certificate with label "${label}" already exists`),
      { statusCode: 409 },
    );
  }

  // Verify CA key exists
  try {
    await access(`${PKI_DIR}/ca.key`, constants.R_OK);
  } catch {
    try {
      await execa('sudo', ['test', '-r', `${PKI_DIR}/ca.key`]);
    } catch {
      throw Object.assign(
        new Error('CA key not found — cannot sign new certificate'),
        { statusCode: 500 },
      );
    }
  }

  const agentDir = `${AGENTS_DIR}/${label}`;
  const keyPath = `${agentDir}/client.key`;
  const csrPath = `${agentDir}/client.csr`;
  const certPath = `${agentDir}/client.crt`;
  const p12Path = `${agentDir}/client.p12`;

  const p12Password = crypto.randomBytes(16).toString('hex');

  try {
    // 1. Create agents base directory (root-owned initially) and hand to portlama
    logger.info({ label }, 'Creating agent certificate directory');
    await execa('sudo', ['mkdir', '-p', AGENTS_DIR]);
    await execa('sudo', ['chown', 'portlama:portlama', AGENTS_DIR]);

    // Create the per-agent subdirectory (portlama now owns AGENTS_DIR)
    await execa('mkdir', ['-p', agentDir]);

    // 2. Generate 4096-bit RSA key (sudo for openssl, output to portlama-owned dir)
    logger.info({ label }, 'Generating agent private key');
    await execa('sudo', ['openssl', 'genrsa', '-out', keyPath, '4096']);
    await execa('sudo', ['chown', '-R', 'portlama:portlama', agentDir]);

    // 3. Create CSR with agent-scoped CN
    logger.info({ label }, 'Creating certificate signing request');
    await execa('sudo', [
      'openssl', 'req', '-new',
      '-key', keyPath,
      '-out', csrPath,
      '-subj', `/CN=agent:${label}/O=Portlama`,
    ]);

    // 4. Sign with CA (2-year validity)
    logger.info({ label }, 'Signing certificate with CA');
    await execa('sudo', [
      'openssl', 'x509', '-req',
      '-in', csrPath,
      '-CA', `${PKI_DIR}/ca.crt`,
      '-CAkey', `${PKI_DIR}/ca.key`,
      '-CAcreateserial',
      '-out', certPath,
      '-days', '730',
      '-sha256',
    ]);

    // 5. Create PKCS12 bundle (legacy flags for macOS compatibility)
    logger.info({ label }, 'Creating PKCS12 bundle');
    await execa('sudo', [
      'openssl', 'pkcs12', '-export',
      '-keypbe', 'PBE-SHA1-3DES',
      '-certpbe', 'PBE-SHA1-3DES',
      '-macalg', 'sha1',
      '-out', p12Path,
      '-inkey', keyPath,
      '-in', certPath,
      '-certfile', `${PKI_DIR}/ca.crt`,
      '-passout', 'stdin',
    ], { input: p12Password });

    // 6. Ensure all generated files are owned by portlama
    await execa('sudo', ['chown', '-R', 'portlama:portlama', agentDir]);

    // 7. Read the serial number from the signed certificate
    const { stdout: serialOut } = await execa('openssl', [
      'x509', '-in', certPath, '-serial', '-noout',
    ]);
    const serialMatch = serialOut.match(/serial=([A-Fa-f0-9]+)/);
    const serial = serialMatch ? serialMatch[1] : '';

    // 8. Read expiry via existing readCertExpiry
    const expiry = await readCertExpiry(certPath);
    const expiresAt = expiry?.expiresAt || new Date(Date.now() + 730 * 86400000).toISOString();

    // 9. Clean up CSR
    await execa('rm', ['-f', csrPath]);

    // 10. Set file permissions (portlama owns these, no sudo needed)
    await execa('chmod', ['600', keyPath]);
    await execa('chmod', ['644', certPath]);
    await execa('chmod', ['600', p12Path]);

    // 11. Add to registry atomically (portlama owns AGENTS_DIR, no sudo needed)
    const freshRegistry = await loadAgentRegistry();
    freshRegistry.agents.push({
      label,
      serial,
      capabilities: capabilities || ['tunnels:read'],
      allowedSites: allowedSites || [],
      createdAt: new Date().toISOString(),
      expiresAt,
      revoked: false,
    });
    await saveAgentRegistry(freshRegistry);

    return { label, p12Password, serial, expiresAt };
  } catch (err) {
    // Clean up on failure
    logger.error({ err, label }, 'Agent certificate generation failed, cleaning up');
    await execa('rm', ['-rf', agentDir]).catch(() => {});

    if (err.statusCode) throw err;
    throw Object.assign(
      new Error(`Agent certificate generation failed: ${err.stderr || err.message}`),
      { statusCode: 500 },
    );
  }
  });
}

/**
 * List all agent certificates with expiry status.
 *
 * @returns {Promise<Array<{ label: string, serial: string, createdAt: string, expiresAt: string, revoked: boolean, expiringSoon: boolean }>>}
 */
export async function listAgentCerts() {
  const registry = await loadAgentRegistry();

  return registry.agents.map((agent) => {
    let expiringSoon = false;
    if (!agent.revoked && agent.expiresAt) {
      const daysUntilExpiry = Math.floor(
        (new Date(agent.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      expiringSoon = daysUntilExpiry <= 30;
    }
    return {
      ...agent,
      capabilities: agent.capabilities || ['tunnels:read'],
      expiringSoon,
    };
  });
}

/**
 * Get capabilities for a specific agent by label.
 *
 * @param {string} label
 * @returns {Promise<string[]>}
 */
export async function getAgentCapabilities(label) {
  const registry = await loadAgentRegistry();
  const agent = registry.agents.find((a) => a.label === label && !a.revoked);
  if (!agent) return ['tunnels:read'];
  return agent.capabilities || ['tunnels:read'];
}

/**
 * Update capabilities for an agent certificate.
 *
 * @param {string} label
 * @param {string[]} capabilities
 * @returns {Promise<{ ok: true, label: string, capabilities: string[] }>}
 */
export async function updateAgentCapabilities(label, capabilities) {
  return withRegistryLock(async () => {
    const registry = await loadAgentRegistry();
    const agent = registry.agents.find((a) => a.label === label && !a.revoked);

    if (!agent) {
      throw Object.assign(
        new Error(`Agent certificate "${label}" not found`),
        { statusCode: 404 },
      );
    }

    // Validate all capabilities
    for (const cap of capabilities) {
      if (!VALID_CAPABILITIES.includes(cap)) {
        throw Object.assign(
          new Error(`Invalid capability: ${cap}`),
          { statusCode: 400 },
        );
      }
    }

    // Ensure tunnels:read is always present
    if (!capabilities.includes('tunnels:read')) {
      capabilities.unshift('tunnels:read');
    }

    agent.capabilities = capabilities;
    await saveAgentRegistry(registry);

    return { ok: true, label, capabilities };
  });
}

/**
 * Get allowed sites for a specific agent by label.
 *
 * @param {string} label
 * @returns {Promise<string[]>}
 */
export async function getAgentAllowedSites(label) {
  const registry = await loadAgentRegistry();
  const agent = registry.agents.find((a) => a.label === label && !a.revoked);
  if (!agent) return [];
  return agent.allowedSites || [];
}

/**
 * Update allowed sites for an agent certificate.
 *
 * @param {string} label
 * @param {string[]} allowedSites
 * @returns {Promise<{ ok: true, label: string, allowedSites: string[] }>}
 */
export async function updateAgentAllowedSites(label, allowedSites) {
  return withRegistryLock(async () => {
    const registry = await loadAgentRegistry();
    const agent = registry.agents.find((a) => a.label === label && !a.revoked);
    if (!agent) {
      throw Object.assign(new Error(`Agent certificate "${label}" not found`), { statusCode: 404 });
    }
    agent.allowedSites = allowedSites || [];
    await saveAgentRegistry(registry);
    return { ok: true, label, allowedSites: agent.allowedSites };
  });
}

/**
 * Revoke an agent certificate by label.
 *
 * Adds the serial to the revocation list, marks it revoked in the registry,
 * and removes the agent's key/cert/p12 files.
 *
 * @param {string} label
 * @param {import('pino').Logger} logger
 * @returns {Promise<{ ok: true, label: string }>}
 */
export async function revokeAgentCert(label, logger) {
  return withRegistryLock(async () => {
    const registry = await loadAgentRegistry();
    const agent = registry.agents.find((a) => a.label === label);

    if (!agent || agent.revoked) {
      throw Object.assign(
        new Error(`Agent certificate "${label}" not found`),
        { statusCode: 404 },
      );
    }

    // 1. Add serial to revocation list
    logger.info({ label, serial: agent.serial }, 'Revoking agent certificate');
    await addToRevocationList(agent.serial, `agent:${label}`);

    // 2. Mark revoked in registry and save atomically
    agent.revoked = true;
    agent.revokedAt = new Date().toISOString();
    await saveAgentRegistry(registry);

    // 3. Remove agent's key/cert/p12 files (portlama owns the agents directory)
    await execa('rm', ['-rf', `${AGENTS_DIR}/${label}/`]).catch((err) => {
      logger.warn({ err, label }, 'Failed to remove agent certificate files');
    });

    return { ok: true, label };
  });
}
