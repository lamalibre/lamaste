/**
 * Server-side mTLS certificate and agent registry management.
 *
 * Backed by SQLite (`state.db`, table `agents`) per
 * docs/decisions/sqlite-migration.md §3d. The companion `revoked_certs` table
 * created by the same `0004_agents.sql` migration is owned by `lib/revocation.js`.
 *
 * Consumers — the mTLS middleware (every request), enrollment.js, tickets.js,
 * plugins.js, csr-signing.js, the chisel credential migration, and several
 * routes — call `loadAgentRegistry` / `saveAgentRegistry`; they never touch
 * SQLite directly.
 */
import { execa } from 'execa';
import crypto from 'node:crypto';
import { access, constants } from 'node:fs/promises';
import {
  BASE_CAPABILITIES as CORE_BASE_CAPABILITIES,
  PLUGIN_AGENT_CN_PREFIX as CORE_PLUGIN_AGENT_CN_PREFIX,
} from '@lamalibre/lamaste';
import { addToRevocationList } from './revocation.js';
import {
  addChiselCredential,
  removeChiselCredential,
  rotateChiselCredential as rotateChiselCredentialLib,
} from './chisel-users.js';
import { getStateDb } from './state-db.js';

const PKI_DIR = process.env.LAMALIBRE_LAMASTE_PKI_DIR || '/etc/lamalibre/lamaste/pki';

// Promise-chain mutex to serialize agent registry modifications.
//
// SQLite's BEGIN IMMEDIATE serialises a single write transaction, but many
// of the exported operations are read-modify-write sequences spanning
// multiple statements (load → mutate → save). This lock keeps each such
// sequence atomic. Tracking as a follow-up: collapse each sequence into a
// single transaction, then drop the mutex.
let registryLock = Promise.resolve();
export function withRegistryLock(fn) {
  const prev = registryLock;
  let resolve;
  registryLock = new Promise((r) => {
    resolve = r;
  });
  return prev.then(fn).finally(resolve);
}

/**
 * Compute the SHA-256 fingerprint of a PEM-encoded certificate.
 *
 * Used by the cert-lifecycle audit logs so an operator inspecting
 * journalctl can correlate issued/revoked certs with what their clients
 * present. Returns the lower-case hex digest with no separators (matches
 * `openssl x509 -fingerprint -sha256` minus the colons).
 *
 * @param {string} certPem - PEM-encoded X.509 certificate
 * @returns {string | null} hex digest, or null if PEM cannot be decoded
 */
export function fingerprintCertPem(certPem) {
  if (typeof certPem !== 'string' || certPem.length === 0) return null;
  const match = certPem.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/);
  if (!match) return null;
  const der = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  if (der.length === 0) return null;
  return crypto.createHash('sha256').update(der).digest('hex');
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
      'openssl',
      'x509',
      '-in',
      certPath,
      '-enddate',
      '-noout',
    ]);
    const match = stdout.match(/notAfter=(.+)/);
    if (!match) return null;

    const expiryDate = new Date(match[1]);
    if (isNaN(expiryDate.getTime())) return null;

    const daysUntilExpiry = Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

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
 * Rotate the mTLS client certificate (admin's own P12).
 *
 * SECURITY (B9): the panel daemon can no longer rotate the admin client cert
 * via sudo. The previous implementation relied on:
 *   - A wildcard sudoers entry `openssl x509 -req -in /etc/lamalibre/lamaste/pki/* *`
 *     that let any CSR subject be passed via -subj.
 *   - A wildcard sudoers entry `mv /etc/lamalibre/lamaste/pki/*.new /etc/lamalibre/lamaste/pki/*`
 *     that let any file in the PKI dir be overwritten.
 *
 * The replacement signing wrapper hardcodes the CA paths, rejects CN=admin
 * (and only allows agent / plugin-agent shapes), and constrains both source
 * and destination to /etc/lamalibre/lamaste/pki/agents/. The replacement rename
 * wrapper does not allow writing to the panel's own client.{key,crt,p12}
 * paths either.
 *
 * Admin cert rotation now lives only in `lamaste-server reset-admin`, which
 * runs as root directly. This stub returns a clear, actionable 503 so the
 * existing route surfaces a useful error instead of a sudo failure.
 *
 * @param {import('pino').Logger} logger
 * @returns {Promise<never>}
 */
export async function rotateClientCert(logger) {
  logger.warn(
    'Refused mTLS client cert rotation — panel-side admin cert rotation is disabled (B9). Use `sudo lamaste-server reset-admin` on the server.',
  );
  throw Object.assign(
    new Error(
      'Panel-initiated admin certificate rotation is disabled for security. ' +
        'Run `sudo lamaste-server reset-admin` on the server console to issue a new admin certificate.',
    ),
    { statusCode: 503 },
  );
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
 * Re-exported from @lamalibre/lamaste core.
 * CN prefix for plugin-agent certificates.
 */
export const PLUGIN_AGENT_CN_PREFIX = CORE_PLUGIN_AGENT_CN_PREFIX;

/**
 * Re-exported from @lamalibre/lamaste core.
 * Base capabilities that can be assigned to agent certificates.
 */
export const BASE_CAPABILITIES = CORE_BASE_CAPABILITIES;

/**
 * Plugin-contributed capabilities, loaded at startup.
 * @type {string[]}
 */
let pluginCapabilities = [];

/**
 * Ticket-scope-contributed capabilities, loaded at startup.
 * @type {string[]}
 */
let ticketScopeCapabilities = [];

/**
 * Set plugin-contributed capabilities.
 * Called at startup after loading plugin manifests.
 *
 * @param {string[]} caps - Capability strings from plugins
 */
export function setPluginCapabilities(caps) {
  pluginCapabilities = [...new Set(caps)];
}

/**
 * Set ticket-scope-contributed capabilities.
 * Called at startup after loading ticket scope registry.
 *
 * @param {string[]} caps - Capability strings from ticket scopes
 */
export function setTicketScopeCapabilitiesOnMtls(caps) {
  ticketScopeCapabilities = [...new Set(caps)];
}

/**
 * Get the full list of valid capabilities (base + plugin + ticket scope).
 *
 * @returns {string[]}
 */
export function getValidCapabilities() {
  return [...BASE_CAPABILITIES, ...pluginCapabilities, ...ticketScopeCapabilities];
}

// --- SQLite prepared-statement bundle (lazy init) ---

let stmts = null;

async function getStmts() {
  if (stmts) return stmts;

  const db = await getStateDb();

  stmts = {
    db,

    selectAll: db.prepare('SELECT * FROM agents'),

    insert: db.prepare(`
      INSERT INTO agents
        (label, serial, capabilities, allowed_sites, enrollment_method,
         delegated_by, created_at, expires_at, revoked, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),

    deleteAll: db.prepare('DELETE FROM agents'),

    begin: db.prepare('BEGIN IMMEDIATE'),
    commit: db.prepare('COMMIT'),
    rollback: db.prepare('ROLLBACK'),
  };

  return stmts;
}

// --- Row → JS object helper ---
//
// JSON-typed columns (capabilities, allowed_sites) are JSON-encoded TEXT in
// storage. They round-trip through JSON.parse/stringify so callers see the
// shape they expect. Optional columns (revoked_at, delegated_by) are
// converted from NULL to absent properties so consumers can treat unset
// fields with `if (entry.field)` rather than tri-state checks.

function rowToAgent(row) {
  const agent = {
    label: row.label,
    serial: row.serial,
    capabilities: row.capabilities ? JSON.parse(row.capabilities) : [],
    allowedSites: row.allowed_sites ? JSON.parse(row.allowed_sites) : [],
    enrollmentMethod: row.enrollment_method,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revoked: row.revoked === 1,
  };
  if (row.revoked_at != null) agent.revokedAt = row.revoked_at;
  if (row.delegated_by != null) agent.delegatedBy = row.delegated_by;
  return agent;
}

function nullableString(value) {
  return value === undefined || value === null ? null : value;
}

/**
 * Load the agent registry.
 * Returns `{ agents: [] }` if the table is empty.
 *
 * Hot path: called on every authenticated mTLS request indirectly via
 * `getAgentCapabilities` / `getAgentAllowedSites`. `SELECT * FROM agents`
 * runs every call — no in-memory cache. WAL keeps it cheap.
 *
 * @returns {Promise<{ agents: Array }>}
 */
export async function loadAgentRegistry() {
  const s = await getStmts();
  const rows = s.selectAll.all();
  return { agents: rows.map(rowToAgent) };
}

/**
 * Atomically save the agent registry to disk.
 *
 * Accepts a `{ agents: [...] }` shape and replaces the entire registry in
 * one BEGIN IMMEDIATE transaction (DELETE + INSERTs) so observers see either
 * the old or the new state, never a partial write.
 *
 * @param {{ agents: Array }} data
 */
export async function saveAgentRegistry(data) {
  const s = await getStmts();
  const rawList = Array.isArray(data?.agents) ? data.agents : [];

  // Dedup by label, keeping the last occurrence. Required because the
  // load-modify-save pattern (loadAgentRegistry → push new entry → save) can
  // produce two same-label rows if the prior row exists revoked — the caller
  // filters by `find(a => a.label === l && !a.revoked)` so it doesn't see
  // the revoked row, but its push appends alongside it. SQLite's PK on
  // label rejects that two-row shape; collapse it here so all such callers
  // work without each having to remove-then-push.
  const byLabel = new Map();
  for (const a of rawList) {
    if (typeof a?.label === 'string') byLabel.set(a.label, a);
  }
  const list = [...byLabel.values()];

  s.begin.run();
  try {
    s.deleteAll.run();
    for (const a of list) {
      s.insert.run(
        a.label,
        a.serial,
        JSON.stringify(a.capabilities ?? []),
        JSON.stringify(a.allowedSites ?? []),
        a.enrollmentMethod ?? 'p12',
        nullableString(a.delegatedBy),
        a.createdAt,
        a.expiresAt,
        a.revoked ? 1 : 0,
        nullableString(a.revokedAt),
      );
    }
    s.commit.run();
  } catch (err) {
    s.rollback.run();
    throw err;
  }
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
    const existing = registry.agents.find((a) => a.label === label && !a.revoked);
    if (existing) {
      throw Object.assign(new Error(`Agent certificate with label "${label}" already exists`), {
        statusCode: 409,
      });
    }

    // Verify CA key exists
    try {
      await access(`${PKI_DIR}/ca.key`, constants.R_OK);
    } catch {
      try {
        await execa('sudo', ['test', '-r', `${PKI_DIR}/ca.key`]);
      } catch {
        throw Object.assign(new Error('CA key not found — cannot sign new certificate'), {
          statusCode: 500,
        });
      }
    }

    const agentDir = `${AGENTS_DIR}/${label}`;
    const keyPath = `${agentDir}/client.key`;
    const csrPath = `${agentDir}/client.csr`;
    const certPath = `${agentDir}/client.crt`;
    const p12Path = `${agentDir}/client.p12`;

    const p12Password = crypto.randomBytes(16).toString('hex');

    try {
      // 1. Create agents base directory (root-owned initially) and hand to lamaste
      logger.info({ label }, 'Creating agent certificate directory');
      await execa('sudo', ['mkdir', '-p', AGENTS_DIR]);
      await execa('sudo', ['chown', 'lamaste:lamaste', AGENTS_DIR]);

      // Create the per-agent subdirectory (lamaste now owns AGENTS_DIR)
      await execa('mkdir', ['-p', agentDir]);

      // 2. Generate 4096-bit RSA key (sudo for openssl, output to lamaste-owned dir)
      logger.info({ label }, 'Generating agent private key');
      await execa('sudo', ['openssl', 'genrsa', '-out', keyPath, '4096']);
      await execa('sudo', ['chown', '-R', 'lamaste:lamaste', agentDir]);

      // 3. Create CSR with agent-scoped CN
      logger.info({ label }, 'Creating certificate signing request');
      await execa('sudo', [
        'openssl',
        'req',
        '-new',
        '-key',
        keyPath,
        '-out',
        csrPath,
        '-subj',
        `/CN=agent:${label}/O=Lamaste`,
      ]);

      // 4. Sign with CA (2-year validity) via the root-wrapper. The wrapper
      //    rejects CN=admin, validates the agent label shape, and constrains
      //    both input and output paths to /etc/lamalibre/lamaste/pki/agents/. Replaces
      //    a former wildcard sudoers rule (B9 hardening).
      logger.info({ label }, 'Signing certificate with CA via wrapper');
      // Generate a 16-byte serial as lower-case hex (no leading zero) — the
      // wrapper validates ^[0-9a-f]{1,32}$ and feeds it to openssl as
      // `-set_serial 0x<serial>`.
      let signSerial = crypto.randomBytes(16).toString('hex').replace(/^0+/, '');
      if (signSerial.length === 0) signSerial = '1';
      await execa('sudo', [
        '/usr/local/sbin/lamaste-sign-csr',
        csrPath,
        certPath,
        signSerial,
        '730',
      ]);

      // 5. Create PKCS12 bundle (legacy flags for macOS compatibility)
      logger.info({ label }, 'Creating PKCS12 bundle');
      await execa(
        'sudo',
        [
          'openssl',
          'pkcs12',
          '-export',
          '-keypbe',
          'PBE-SHA1-3DES',
          '-certpbe',
          'PBE-SHA1-3DES',
          '-macalg',
          'sha1',
          '-out',
          p12Path,
          '-inkey',
          keyPath,
          '-in',
          certPath,
          '-certfile',
          `${PKI_DIR}/ca.crt`,
          '-passout',
          'stdin',
        ],
        { input: p12Password },
      );

      // 6. Ensure all generated files are owned by lamaste
      await execa('sudo', ['chown', '-R', 'lamaste:lamaste', agentDir]);

      // 7. Read the serial number from the signed certificate
      const { stdout: serialOut } = await execa('openssl', [
        'x509',
        '-in',
        certPath,
        '-serial',
        '-noout',
      ]);
      const serialMatch = serialOut.match(/serial=([A-Fa-f0-9]+)/);
      const serial = serialMatch ? serialMatch[1] : '';

      // 8. Read expiry via existing readCertExpiry
      const expiry = await readCertExpiry(certPath);
      const expiresAt = expiry?.expiresAt || new Date(Date.now() + 730 * 86400000).toISOString();

      // 9. Clean up CSR
      await execa('rm', ['-f', csrPath]);

      // 10. Set file permissions (lamaste owns these, no sudo needed)
      await execa('chmod', ['600', keyPath]);
      await execa('chmod', ['644', certPath]);
      await execa('chmod', ['600', p12Path]);

      // 11. Add to registry (reuse the registry loaded at the top of withRegistryLock —
      // the mutex guarantees no concurrent modifications)
      registry.agents.push({
        label,
        serial,
        capabilities: capabilities || ['tunnels:read'],
        allowedSites: allowedSites || [],
        enrollmentMethod: 'p12',
        createdAt: new Date().toISOString(),
        expiresAt,
        revoked: false,
      });
      await saveAgentRegistry(registry);

      // 12. Mint a chisel tunnel-server credential. Plugin-agents do not open
      // chisel tunnels — they participate only in the ticket bus — so they are
      // skipped here. If chisel credential provisioning fails, the agent cert
      // is still usable for panel API auth; we surface a warning in the result.
      const result = { label, p12Password, serial, expiresAt };
      if (!label.startsWith(PLUGIN_AGENT_CN_PREFIX)) {
        try {
          const chisel = await addChiselCredential(label, logger);
          result.chiselCredential = { user: chisel.user, password: chisel.password };
          if (!chisel.restartOk) {
            result.chiselWarning =
              'Chisel credential created but service restart failed; ' +
              'tunnel auth will activate on the next chisel restart. ' +
              `Details: ${chisel.restartError}`;
          }
        } catch (chErr) {
          logger.warn(
            { err: chErr, label },
            'Failed to mint chisel credential for new agent — agent will not be able to open tunnels until this is fixed',
          );
          result.chiselWarning =
            'Failed to mint chisel tunnel credential. ' +
            'Re-run `lamaste-server chisel rotate-credential --label ' +
            label +
            '` once the underlying issue is resolved.';
        }
      }

      return result;
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
    const isPluginAgent = agent.label.startsWith(PLUGIN_AGENT_CN_PREFIX);
    const entry = {
      ...agent,
      capabilities: agent.capabilities || (isPluginAgent ? [] : ['tunnels:read']),
      enrollmentMethod: agent.enrollmentMethod || 'p12',
      expiringSoon,
    };
    if (isPluginAgent) {
      entry.certType = 'plugin-agent';
    }
    return entry;
  });
}

/**
 * Get capabilities for a specific agent or plugin-agent by label.
 *
 * For plugin-agents, the label in the registry is the full
 * `plugin-agent:<delegatingLabel>:<pluginAgentLabel>` string.
 *
 * @param {string} label
 * @returns {Promise<string[]>}
 */
export async function getAgentCapabilities(label) {
  const registry = await loadAgentRegistry();
  const agent = registry.agents.find((a) => a.label === label && !a.revoked);
  // Plugin-agents have no default capabilities — return empty if not found
  if (!agent) {
    return label.startsWith(PLUGIN_AGENT_CN_PREFIX) ? [] : ['tunnels:read'];
  }
  const stored =
    agent.capabilities || (label.startsWith(PLUGIN_AGENT_CN_PREFIX) ? [] : ['tunnels:read']);
  // Filter against currently valid capabilities so disabled-plugin caps are excluded
  const valid = getValidCapabilities();
  return stored.filter((c) => valid.includes(c));
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
      throw Object.assign(new Error(`Agent certificate "${label}" not found`), { statusCode: 404 });
    }

    // Validate all capabilities against base + plugin capabilities
    const validCaps = getValidCapabilities();
    for (const cap of capabilities) {
      if (!validCaps.includes(cap)) {
        throw Object.assign(new Error(`Invalid capability: ${cap}`), { statusCode: 400 });
      }
    }

    // Ensure tunnels:read is always present for regular agents
    // Plugin-agents only get explicitly assigned capabilities
    if (!label.startsWith('plugin-agent:') && !capabilities.includes('tunnels:read')) {
      capabilities.unshift('tunnels:read');
    }

    agent.capabilities = capabilities;
    await saveAgentRegistry(registry);

    return { ok: true, label, capabilities };
  });
}

/**
 * Get allowed sites for a specific agent or plugin-agent by label.
 *
 * Plugin-agents never have allowed sites — they only participate in tickets.
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
    const agent = registry.agents.find((a) => a.label === label && !a.revoked);

    if (!agent) {
      throw Object.assign(new Error(`Agent certificate "${label}" not found`), { statusCode: 404 });
    }

    // 1. Add serial to revocation list
    logger.info({ label, serial: agent.serial }, 'Revoking agent certificate');
    await addToRevocationList(agent.serial, `agent:${label}`);

    // 2. Mark revoked in registry
    agent.revoked = true;
    agent.revokedAt = new Date().toISOString();

    // 3. Cascade revocation to plugin-agents delegated by this agent
    const pluginAgents = registry.agents.filter((a) => !a.revoked && a.delegatedBy === label);

    for (const pa of pluginAgents) {
      logger.info(
        { label: pa.label, serial: pa.serial, delegatedBy: label },
        'Cascade-revoking plugin-agent certificate',
      );
      await addToRevocationList(pa.serial, `agent:${pa.label}`);
      pa.revoked = true;
      pa.revokedAt = new Date().toISOString();

      // Remove plugin-agent's key/cert/p12 files
      await execa('rm', ['-rf', `${AGENTS_DIR}/${pa.label}/`]).catch((err) => {
        logger.warn({ err, label: pa.label }, 'Failed to remove plugin-agent certificate files');
      });
    }

    if (pluginAgents.length > 0) {
      logger.info(
        { label, cascadeCount: pluginAgents.length },
        'Cascade-revoked plugin-agent certificates',
      );
    }

    // 4. Save registry atomically (includes both the agent and cascade-revoked plugin-agents)
    await saveAgentRegistry(registry);

    // 5. Remove agent's key/cert/p12 files (lamaste owns the agents directory)
    await execa('rm', ['-rf', `${AGENTS_DIR}/${label}/`]).catch((err) => {
      logger.warn({ err, label }, 'Failed to remove agent certificate files');
    });

    // 6. Remove chisel tunnel-server credential. Plugin-agents never had one.
    if (!label.startsWith(PLUGIN_AGENT_CN_PREFIX)) {
      try {
        await removeChiselCredential(label, logger);
      } catch (chErr) {
        logger.warn(
          { err: chErr, label },
          'Failed to remove chisel credential during revocation — chisel-users file may need manual cleanup',
        );
      }
    }

    // Cascade-revoked plugin-agents have no chisel credentials to clean up.

    return { ok: true, label };
  });
}

/**
 * Rotate an agent's chisel tunnel-server credential.
 *
 * Use this when a credential is suspected compromised or when an agent
 * has lost its local copy. The new credential is returned so an operator
 * can hand it to the agent out-of-band, but in normal operation the agent
 * should re-fetch via `lamaste-agent chisel refresh-credential`.
 *
 * Verifies the agent exists and is not revoked first.
 *
 * @param {string} label
 * @param {import('pino').Logger} logger
 * @returns {Promise<{ ok: true, label: string, user: string, password: string, restartOk: boolean, restartError?: string }>}
 */
export async function rotateAgentChiselCredential(label, logger) {
  const registry = await loadAgentRegistry();
  const agent = registry.agents.find((a) => a.label === label && !a.revoked);
  if (!agent) {
    throw Object.assign(new Error(`Agent certificate "${label}" not found`), {
      statusCode: 404,
    });
  }
  if (label.startsWith(PLUGIN_AGENT_CN_PREFIX)) {
    throw Object.assign(new Error('Plugin-agents do not use chisel tunnel credentials'), {
      statusCode: 400,
    });
  }
  const result = await rotateChiselCredentialLib(label, logger);
  return {
    ok: true,
    label,
    user: result.user,
    password: result.password,
    restartOk: result.restartOk,
    ...(result.restartOk ? {} : { restartError: result.restartError }),
  };
}
