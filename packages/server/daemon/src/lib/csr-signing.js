import crypto from 'node:crypto';
import { access, constants, readFile, writeFile, unlink } from 'node:fs/promises';
import { execa } from 'execa';
import {
  readCertExpiry,
  loadAgentRegistry,
  saveAgentRegistry,
  withRegistryLock,
  getValidCapabilities,
} from './mtls.js';
import { addChiselCredential } from './chisel-users.js';

const PKI_DIR = process.env.LAMALIBRE_LAMASTE_PKI_DIR || '/etc/lamalibre/lamaste/pki';
const AGENTS_DIR = `${PKI_DIR}/agents`;

/**
 * Path to the wrapper script that signs CSRs as root. The sudoers entry pins
 * this exact path, no arguments wildcarded. The wrapper hardcodes the CA
 * paths, validates the CSR subject (rejects CN=admin), and constrains both
 * input and output to /etc/lamalibre/lamaste/pki/agents/. Replaces a former wildcard
 * sudoers rule that allowed signing arbitrary CSR subjects.
 */
const SIGN_CSR_WRAPPER = '/usr/local/sbin/lamaste-sign-csr';

/**
 * Generate a 16-byte (128-bit) random serial as lower-case hex with no
 * leading zero. The wrapper validates `^[0-9a-f]{1,32}$`. Stripping leading
 * zeros keeps the serial a valid positive integer when openssl parses it as
 * `0x<serial>` via `-set_serial`.
 *
 * @returns {string}
 */
function randomCertSerial() {
  let hex = crypto.randomBytes(16).toString('hex').replace(/^0+/, '');
  if (hex.length === 0) hex = '1';
  return hex;
}

/**
 * Extract the CN from a CSR's subject. Returns the CN string or null.
 *
 * The signing wrapper does not pass `-subj` to openssl, so the CSR's subject
 * is what ends up in the signed cert. Callers must verify the CSR's CN
 * matches the expected label before signing — the wrapper only enforces that
 * the CN matches the agent label *shape*, not a specific value.
 *
 * @param {string} csrPath - Path to a CSR file readable by the current user
 * @returns {Promise<string | null>}
 */
async function readCsrCN(csrPath) {
  try {
    const { stdout } = await execa('openssl', [
      'req',
      '-in',
      csrPath,
      '-noout',
      '-subject',
      '-nameopt',
      'RFC2253',
    ]);
    // Output: "subject=CN=agent:foo,O=Lamaste"
    const subject = stdout.trim().replace(/^subject=\s*/, '');
    // Find the CN= attribute. RFC2253 form is comma-separated; we don't
    // attempt to parse escaped commas — the agent label charset has none.
    for (const part of subject.split(',')) {
      const trimmed = part.trim();
      if (trimmed.startsWith('CN=')) {
        return trimmed.slice(3);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sign an admin CSR with the panel CA for hardware-bound admin upgrade.
 *
 * SECURITY (B9): the panel daemon can no longer sign certificates with
 * `CN=admin`. The previous implementation relied on a wildcard sudoers entry
 * (`openssl x509 -req -in /etc/lamalibre/lamaste/pki/* *`) that let any /CN= subject
 * be passed via `-subj`, which meant a compromised plugin could forge an
 * admin cert by feeding its own CSR through this function. The replacement
 * sudoers wrapper (`/usr/local/sbin/lamaste-sign-csr`) explicitly rejects
 * `CN=admin`, so this function would fail at the sudo layer anyway.
 *
 * Admin cert issuance now lives only in `lamaste-server reset-admin`, which
 * runs as root directly (not via sudo) and has its own audit/recovery story.
 * Hardware-bound admin upgrades must be performed via that root-only flow.
 *
 * This stub is preserved so the panel route returns a clear, actionable error
 * to the operator instead of failing with an opaque sudo error. Callers
 * receive a 503 with instructions.
 *
 * @param {string} _csrPem - PEM-encoded CSR (ignored)
 * @param {import('pino').Logger} logger
 * @returns {Promise<never>}
 */
export async function signAdminCSR(_csrPem, logger) {
  logger.warn(
    'Refused admin CSR signing request — panel-side admin cert issuance is disabled (B9). Use `sudo lamaste-server reset-admin` on the server.',
  );
  throw Object.assign(
    new Error(
      'Panel-initiated admin cert issuance is disabled for security. ' +
        'Run `sudo lamaste-server reset-admin` on the server console to issue a new admin certificate.',
    ),
    { statusCode: 503 },
  );
}

/**
 * Rotate an agent's certificate via CSR for hardware-bound upgrade.
 *
 * Signs a new CSR for an existing agent, revokes the old certificate,
 * preserves capabilities and allowed sites, and sets enrollmentMethod
 * to 'hardware-bound'.
 *
 * @param {string} csrPem - PEM-encoded CSR
 * @param {string} label - Agent label (must match an existing non-revoked agent)
 * @param {import('pino').Logger} logger
 * @returns {Promise<{ certPem: string, caCertPem: string, serial: string, expiresAt: string, label: string }>}
 */
export async function rotateAgentCSR(csrPem, label, logger) {
  // Defense-in-depth: re-validate label for DN safety
  if (!/^[a-z0-9][a-z0-9-]*$/.test(label) || label.length > 50) {
    throw Object.assign(new Error('Invalid agent label'), { statusCode: 400 });
  }

  if (csrPem.length > 8192) {
    throw Object.assign(new Error('CSR too large'), { statusCode: 400 });
  }

  return withRegistryLock(async () => {
    // Find the existing non-revoked agent entry
    const registry = await loadAgentRegistry();
    const existing = registry.agents.find((a) => a.label === label && !a.revoked);
    if (!existing) {
      throw Object.assign(new Error(`Agent certificate "${label}" not found`), {
        statusCode: 404,
      });
    }

    // Verify CA key exists
    try {
      await access(`${PKI_DIR}/ca.key`, constants.R_OK);
    } catch {
      try {
        await execa('sudo', ['test', '-r', `${PKI_DIR}/ca.key`]);
      } catch {
        throw Object.assign(new Error('CA key not found — cannot sign certificate'), {
          statusCode: 500,
        });
      }
    }

    const tmpSuffix = crypto.randomBytes(8).toString('hex');
    const csrPath = `${AGENTS_DIR}/.rotate-csr-${tmpSuffix}.pem`;
    const certPath = `${AGENTS_DIR}/.rotate-cert-${tmpSuffix}.pem`;

    try {
      // Write the CSR to a temp file
      await writeFile(csrPath, csrPem, { mode: 0o600 });

      // Validate CSR structure and signature
      try {
        await execa('openssl', ['req', '-verify', '-in', csrPath, '-noout']);
      } catch {
        throw Object.assign(new Error('Invalid CSR: structure or signature verification failed'), {
          statusCode: 400,
        });
      }

      // The signing wrapper does not pass `-subj` to openssl, so the cert's
      // subject is whatever the CSR contains. The wrapper validates the CN
      // matches the agent label *shape*, but it does not know which specific
      // label is expected — so we verify here that the CSR's CN is exactly
      // `agent:<label>`. A mismatch indicates either a buggy client or an
      // attempt to rotate one agent's cert into a different label.
      const expectedCN = `agent:${label}`;
      const actualCN = await readCsrCN(csrPath);
      if (actualCN !== expectedCN) {
        throw Object.assign(new Error(`CSR CN must be ${expectedCN}, got ${actualCN ?? 'none'}`), {
          statusCode: 400,
        });
      }

      const serial = randomCertSerial();
      logger.info({ label, serial }, 'Signing rotation CSR via wrapper');
      await execa('sudo', [SIGN_CSR_WRAPPER, csrPath, certPath, serial, '730']);

      // Make cert readable
      await execa('sudo', ['chown', 'lamaste:lamaste', certPath]);
      await execa('sudo', ['chmod', '644', certPath]);

      // Read expiry
      const expiry = await readCertExpiry(certPath);
      const expiresAt = expiry?.expiresAt || new Date(Date.now() + 730 * 86400000).toISOString();

      // Read the signed certificate PEM
      const certPem = await readFile(certPath, 'utf-8');

      // Read the CA certificate PEM
      let caCertPem;
      try {
        caCertPem = await readFile(`${PKI_DIR}/ca.crt`, 'utf-8');
      } catch {
        const { stdout } = await execa('sudo', ['cat', `${PKI_DIR}/ca.crt`]);
        caCertPem = stdout;
      }

      // Revoke the old certificate
      const { addToRevocationList } = await import('./revocation.js');
      logger.info(
        { label, oldSerial: existing.serial },
        'Revoking old agent certificate for hardware-bound upgrade',
      );
      await addToRevocationList(existing.serial, `agent:${label} (upgraded to hardware-bound)`);

      // Update the existing registry entry atomically: new serial, new expiry,
      // mark as hardware-bound, preserve allowedSites and the *currently
      // valid* subset of capabilities. Filtering against the live
      // `getValidCapabilities()` set ensures that capabilities contributed
      // by a now-uninstalled plugin or a now-deregistered ticket scope are
      // dropped from the rotated cert, rather than being silently re-issued.
      const storedCaps = Array.isArray(existing.capabilities) ? existing.capabilities : [];
      const validCaps = new Set(getValidCapabilities());
      const liveCaps = storedCaps.filter((c) => validCaps.has(c));
      const droppedCapabilities = storedCaps.filter((c) => !validCaps.has(c));
      if (droppedCapabilities.length > 0) {
        logger.info(
          { label, droppedCapabilities, reason: 'no_longer_valid' },
          'Dropping stale agent capabilities during hardware-bound rotation',
        );
      }
      existing.capabilities = liveCaps;
      existing.serial = serial;
      existing.expiresAt = expiresAt;
      existing.enrollmentMethod = 'hardware-bound';
      existing.revoked = false;
      await saveAgentRegistry(registry);

      logger.info({ label, serial }, 'Agent certificate rotated for hardware-bound upgrade');

      return { certPem, caCertPem, serial, expiresAt, label };
    } finally {
      await unlink(csrPath).catch(() => {});
      await unlink(certPath).catch(() => {});
    }
  });
}

/**
 * Sign an externally-generated CSR with the panel CA.
 *
 * Validates that the CSR subject matches the expected agent CN format,
 * signs it with the CA (2-year validity), reads serial and expiry,
 * and adds the agent to the registry with `enrollmentMethod: 'hardware-bound'`.
 *
 * For delegated enrollments, uses the `plugin-agent:<delegatingLabel>:<pluginAgentLabel>`
 * CN format and stores the registry entry with `enrollmentType: 'delegated'` and
 * `delegatedBy` field.
 *
 * @param {string} csrPem - PEM-encoded CSR
 * @param {string} label - Agent label (must match CSR subject)
 * @param {string[]} capabilities - Capability list
 * @param {string[]} allowedSites - Allowed site labels
 * @param {import('pino').Logger} logger
 * @param {{ type?: 'delegated', delegatedBy?: string }} [opts] - Optional enrollment metadata
 * @returns {Promise<{ certPem: string, caCertPem: string, serial: string, expiresAt: string, label: string }>}
 */
export async function signCSR(csrPem, label, capabilities, allowedSites, logger, opts) {
  const isDelegated = opts?.type === 'delegated';

  // Defense-in-depth: re-validate label for DN safety even though routes validate via Zod.
  // For delegated enrollments, the label is "plugin-agent:<delegating>:<plugin>" — validate each segment.
  if (isDelegated) {
    const match = label.match(/^plugin-agent:([a-z0-9][a-z0-9-]*):([a-z0-9][a-z0-9-]*)$/);
    if (!match || label.length > 150) {
      throw Object.assign(new Error('Invalid plugin-agent label'), { statusCode: 400 });
    }
  } else if (!/^[a-z0-9][a-z0-9-]*$/.test(label) || label.length > 50) {
    throw Object.assign(new Error('Invalid agent label'), { statusCode: 400 });
  }

  // Reject oversized CSRs (a 4096-bit RSA CSR is ~1600 bytes PEM)
  if (csrPem.length > 8192) {
    throw Object.assign(new Error('CSR too large'), { statusCode: 400 });
  }

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
        throw Object.assign(new Error('CA key not found — cannot sign certificate'), {
          statusCode: 500,
        });
      }
    }

    const tmpSuffix = crypto.randomBytes(8).toString('hex');
    const csrPath = `${AGENTS_DIR}/.enroll-csr-${tmpSuffix}.pem`;
    const certPath = `${AGENTS_DIR}/.enroll-cert-${tmpSuffix}.pem`;

    try {
      // Ensure agents directory exists
      await execa('sudo', ['mkdir', '-p', AGENTS_DIR]);
      await execa('sudo', ['chown', 'lamaste:lamaste', AGENTS_DIR]);

      // Write the CSR to a temp file
      await writeFile(csrPath, csrPem, { mode: 0o600 });

      // Validate CSR structure and signature before signing
      try {
        await execa('openssl', ['req', '-verify', '-in', csrPath, '-noout']);
      } catch {
        throw Object.assign(new Error('Invalid CSR: structure or signature verification failed'), {
          statusCode: 400,
        });
      }

      // The signing wrapper does not pass `-subj` — the cert keeps whatever
      // subject the CSR contains. The wrapper's regex enforces the agent
      // label *shape* (and rejects CN=admin), but does not know which
      // specific label is expected. Verify here that the CSR's CN matches
      // exactly what the enrollment token says.
      //
      // Delegated tokens carry a `plugin-agent:<delegating>:<plugin>` label;
      // regular tokens carry the bare label and the panel signs as
      // `agent:<label>`. The agent CLI (B9-aware) builds its CSR to match —
      // older agents that send `/CN=agent:pending` will be rejected here
      // with a clear error, prompting an upgrade.
      const expectedCN = isDelegated ? label : `agent:${label}`;
      const actualCN = await readCsrCN(csrPath);
      if (actualCN !== expectedCN) {
        throw Object.assign(
          new Error(
            `CSR CN must be "${expectedCN}", got "${actualCN ?? 'none'}". ` +
              'If you are upgrading from an older agent, use the new client that ' +
              'looks up the enrollment label before generating the CSR.',
          ),
          { statusCode: 400 },
        );
      }

      const serial = randomCertSerial();
      logger.info({ label, isDelegated, serial }, 'Signing enrollment CSR via wrapper');
      await execa('sudo', [SIGN_CSR_WRAPPER, csrPath, certPath, serial, '730']);

      // Make cert readable (match signAdminCSR pattern)
      await execa('sudo', ['chown', 'lamaste:lamaste', certPath]);
      await execa('sudo', ['chmod', '644', certPath]);

      // Read expiry
      const expiry = await readCertExpiry(certPath);
      const expiresAt = expiry?.expiresAt || new Date(Date.now() + 730 * 86400000).toISOString();

      // Read the signed certificate PEM
      const certPem = await readFile(certPath, 'utf-8');

      // Read the CA certificate PEM
      let caCertPem;
      try {
        caCertPem = await readFile(`${PKI_DIR}/ca.crt`, 'utf-8');
      } catch {
        // Try with sudo
        const { stdout } = await execa('sudo', ['cat', `${PKI_DIR}/ca.crt`]);
        caCertPem = stdout;
      }

      // Add to registry. For delegated enrollments, store the delegation metadata.
      // We reuse the registry loaded at the top of withRegistryLock — the mutex
      // guarantees no concurrent modifications.
      const registryEntry = {
        label,
        serial,
        capabilities: isDelegated ? capabilities || [] : capabilities || ['tunnels:read'],
        allowedSites: isDelegated ? [] : allowedSites || [],
        enrollmentMethod: isDelegated ? 'delegated' : 'hardware-bound',
        createdAt: new Date().toISOString(),
        expiresAt,
        revoked: false,
      };
      if (isDelegated && opts?.delegatedBy) {
        registryEntry.delegatedBy = opts.delegatedBy;
      }
      registry.agents.push(registryEntry);
      await saveAgentRegistry(registry);

      logger.info({ label, serial, isDelegated }, 'Enrollment CSR signed and agent registered');

      // Mint a chisel tunnel-server credential for non-delegated agents.
      // Plugin-agents (delegated) participate only in tickets and never open
      // chisel tunnels, so they are skipped. Failure to mint is non-fatal —
      // the agent can re-fetch via `lamaste-agent chisel refresh-credential`
      // once the underlying issue is resolved.
      if (!isDelegated) {
        try {
          await addChiselCredential(label, logger);
        } catch (chErr) {
          logger.warn(
            { err: chErr, label },
            'Failed to mint chisel credential during enrollment — agent must run `lamaste-agent chisel refresh-credential` once the panel-side issue is resolved',
          );
        }
      }

      return { certPem, caCertPem, serial, expiresAt, label };
    } finally {
      // Clean up temp files. The wrapper uses -set_serial, so there is no
      // ca.srl to clean up.
      await unlink(csrPath).catch(() => {});
      await unlink(certPath).catch(() => {});
    }
  });
}
