/**
 * Let's Encrypt / certbot CLI wrappers.
 *
 * Pure logic layer: accepts an `exec` function so the caller controls how the
 * certbot/openssl processes are spawned. Daemon passes execa, tests can pass
 * a mock. No Fastify, no global state.
 *
 * Privilege boundary: certbot and the certificate reads run as root through
 * two root-owned wrapper scripts installed by the server provisioner,
 * {@link CERTBOT_WRAPPER} and {@link CERT_INFO_WRAPPER}. They validate every
 * argument and invoke certbot/openssl with a fixed argument vector, so the
 * daemon user's sudo rights cannot be stretched with extra flags (certbot
 * hooks, `--nginx-ctl`, openssl `-engine`) into running code as root.
 */

/** `lamaste-certbot issue|renew|renew-all|list` — see the provisioner's scripts/. */
export const CERTBOT_WRAPPER = '/usr/local/sbin/lamaste-certbot';
/** `lamaste-cert-info <lineage> enddate|checkend|san` — see the provisioner's scripts/. */
export const CERT_INFO_WRAPPER = '/usr/local/sbin/lamaste-cert-info';

// ---------------------------------------------------------------------------
// Exec abstraction
// ---------------------------------------------------------------------------

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode?: number;
}

export interface ExecError extends Error {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
}

export interface ExecFn {
  (
    file: string,
    args: string[],
    options?: { timeout?: number; reject?: boolean },
  ): Promise<ExecResult>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IssueCertResult {
  readonly issued: true;
  readonly domain: string;
  readonly certPath: string;
  readonly keyPath: string;
}

export interface CertInfo {
  readonly name: string;
  readonly domains: string[];
  readonly expiryDate: string | null;
  readonly daysRemaining: number;
  readonly certPath: string | null;
  readonly keyPath: string | null;
  readonly isValid: boolean;
}

export interface RenewCertOptions {
  readonly forceRenewal?: boolean;
}

export interface TunnelCertResult {
  readonly skipped: boolean;
  readonly reason?: 'wildcard' | 'exists';
  readonly certPath: string;
}

export interface CertValidity {
  readonly valid: boolean;
  readonly certPath: string | null;
  readonly expiryDate: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isExecError(err: unknown): err is ExecError {
  return err instanceof Error;
}

function errText(err: unknown): string {
  if (!isExecError(err)) return String(err);
  return err.stderr || err.message;
}

// ---------------------------------------------------------------------------
// Issuance
// ---------------------------------------------------------------------------

/**
 * Issue a Let's Encrypt certificate for a single FQDN using the nginx plugin.
 */
export async function issueCert(
  fqdn: string,
  email: string,
  exec: ExecFn,
): Promise<IssueCertResult> {
  try {
    await exec('sudo', [CERTBOT_WRAPPER, 'issue', email, fqdn, fqdn]);
  } catch (err: unknown) {
    const stderr = errText(err);

    if (stderr.includes('too many certificates') || stderr.includes('rate limit')) {
      throw new Error(
        `Let's Encrypt rate limit reached for ${fqdn}. Rate limits allow 50 certificates per registered domain per week. ` +
          'Please wait before trying again. Details: ' +
          stderr,
      );
    }

    if (
      stderr.includes('DNS problem') ||
      stderr.includes('NXDOMAIN') ||
      stderr.includes('no valid A records')
    ) {
      throw new Error(
        `DNS is not pointing ${fqdn} to this server. The ACME HTTP-01 challenge requires the domain to resolve ` +
          'to this server. Please verify your DNS configuration. Details: ' +
          stderr,
      );
    }

    if (stderr.includes('Could not automatically find a matching server block')) {
      throw new Error(
        `The nginx plugin could not find a matching server block for ${fqdn}. ` +
          'Check your nginx configuration. Details: ' +
          stderr,
      );
    }

    throw new Error(`Failed to issue certificate for ${fqdn}: ${stderr}`);
  }

  const certPath = `/etc/letsencrypt/live/${fqdn}/fullchain.pem`;
  const keyPath = `/etc/letsencrypt/live/${fqdn}/privkey.pem`;

  return { issued: true, domain: fqdn, certPath, keyPath };
}

/**
 * Issue certificates for all core Lamaste subdomains (panel, auth, tunnel).
 */
export async function issueCoreCerts(
  domain: string,
  email: string,
  exec: ExecFn,
): Promise<IssueCertResult[]> {
  const subdomains = ['panel', 'auth', 'tunnel'];
  const results: IssueCertResult[] = [];

  for (const sub of subdomains) {
    const fqdn = `${sub}.${domain}`;
    try {
      const result = await issueCert(fqdn, email, exec);
      results.push(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Certificate issuance failed for ${fqdn}: ${message}`);
    }
  }

  return results;
}

/**
 * Issue a certificate for an app/tunnel subdomain.
 */
export function issueAppCert(
  subdomain: string,
  domain: string,
  email: string,
  exec: ExecFn,
): Promise<IssueCertResult> {
  const fqdn = `${subdomain}.${domain}`;
  return issueCert(fqdn, email, exec);
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * List all certificates managed by certbot.
 */
export async function listCerts(exec: ExecFn): Promise<CertInfo[]> {
  let stdout: string;
  try {
    const result = await exec('sudo', [CERTBOT_WRAPPER, 'list']);
    stdout = result.stdout;
  } catch (err: unknown) {
    // certbot certificates can return non-zero if no certs exist
    if (isExecError(err) && err.stdout && err.stdout.includes('No certificates found')) {
      return [];
    }
    throw new Error(`Failed to list certificates: ${errText(err)}`);
  }

  if (!stdout || stdout.includes('No certificates found')) {
    return [];
  }

  const certs: CertInfo[] = [];
  const blocks = stdout.split('Certificate Name:').slice(1);

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim());
    const name = lines[0]?.trim() || '';

    const domainsLine = lines.find((l) => l.startsWith('Domains:'));
    const domains = domainsLine ? domainsLine.replace('Domains:', '').trim().split(/\s+/) : [];

    const expiryLine = lines.find((l) => l.startsWith('Expiry Date:'));
    let expiryDate: string | null = null;
    let daysRemaining = 0;
    let isValid = false;

    if (expiryLine) {
      const expiryMatch = expiryLine.match(/Expiry Date:\s*(\S+\s+\S+)/);
      if (expiryMatch && expiryMatch[1]) {
        const parsed = new Date(expiryMatch[1]);
        if (!isNaN(parsed.getTime())) {
          expiryDate = parsed.toISOString();
          daysRemaining = Math.floor((parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        }
      }
      isValid = expiryLine.includes('VALID');
    }

    const certPathLine = lines.find((l) => l.startsWith('Certificate Path:'));
    const certPath = certPathLine ? certPathLine.replace('Certificate Path:', '').trim() : null;

    const keyPathLine = lines.find((l) => l.startsWith('Private Key Path:'));
    const keyPath = keyPathLine ? keyPathLine.replace('Private Key Path:', '').trim() : null;

    certs.push({
      name,
      domains,
      expiryDate,
      daysRemaining,
      certPath,
      keyPath,
      isValid,
    });
  }

  return certs;
}

// ---------------------------------------------------------------------------
// Renewal
// ---------------------------------------------------------------------------

/**
 * Renew a specific certificate by name.
 */
export async function renewCert(
  domain: string,
  exec: ExecFn,
  options: RenewCertOptions = {},
): Promise<{ renewed: true; domain: string }> {
  const args = [CERTBOT_WRAPPER, 'renew', domain];
  if (options.forceRenewal) args.push('force');

  try {
    await exec('sudo', args);
    return { renewed: true, domain };
  } catch (err: unknown) {
    throw new Error(`Failed to renew certificate for ${domain}: ${errText(err)}`);
  }
}

/**
 * Attempt renewal of all certificates.
 */
export async function renewAll(exec: ExecFn): Promise<{ renewed: true; output: string }> {
  try {
    const { stdout } = await exec('sudo', [CERTBOT_WRAPPER, 'renew-all']);
    return { renewed: true, output: stdout };
  } catch (err: unknown) {
    throw new Error(`Failed to renew certificates: ${errText(err)}`);
  }
}

/**
 * Enable the certbot systemd timer for automatic certificate renewal.
 */
export async function setupAutoRenew(exec: ExecFn): Promise<{ enabled: true }> {
  try {
    await exec('sudo', ['systemctl', 'enable', 'certbot.timer']);
    await exec('sudo', ['systemctl', 'start', 'certbot.timer']);
  } catch (err: unknown) {
    throw new Error(`Failed to set up auto-renewal: ${errText(err)}`);
  }

  try {
    const { stdout } = await exec('systemctl', ['is-active', 'certbot.timer']);
    if (stdout.trim() === 'active') {
      return { enabled: true };
    }
  } catch {
    // is-active returns non-zero for inactive
  }

  throw new Error('Certbot timer is not active after enabling.');
}

// ---------------------------------------------------------------------------
// Wildcard / validity checks
// ---------------------------------------------------------------------------

/**
 * Check if a wildcard certificate already covers all subdomains of the given domain.
 */
export async function hasWildcardCert(domain: string, exec: ExecFn): Promise<boolean> {
  const certs = await listCerts(exec);
  const wildcardFqdn = `*.${domain}`;

  for (const cert of certs) {
    if (cert.domains.includes(wildcardFqdn) && cert.isValid) {
      return true;
    }
  }

  return false;
}

/**
 * Issue a TLS certificate for a tunnel subdomain.
 * Skips issuance if a wildcard cert or existing cert already covers the FQDN.
 */
export async function issueTunnelCert(
  fqdn: string,
  email: string,
  exec: ExecFn,
): Promise<TunnelCertResult> {
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(fqdn)) {
    throw new Error(`Invalid FQDN: ${fqdn}`);
  }

  // RFC 5321 caps the full email at 254 chars (local <= 64, domain <= 253).
  // Validate structurally with String ops instead of a regex with ambiguous
  // overlapping quantifiers (polynomial-ReDoS class).
  if (typeof email !== 'string' || email.length === 0 || email.length > 254) {
    throw new Error(`Invalid email: ${email}`);
  }
  const atIndex = email.indexOf('@');
  if (atIndex <= 0 || atIndex !== email.lastIndexOf('@')) {
    throw new Error(`Invalid email: ${email}`);
  }
  const local = email.slice(0, atIndex);
  const domainPart = email.slice(atIndex + 1);
  const dotIndex = domainPart.indexOf('.');
  if (
    domainPart.length === 0 ||
    dotIndex <= 0 ||
    dotIndex === domainPart.length - 1 ||
    /\s/.test(local) ||
    /\s/.test(domainPart)
  ) {
    throw new Error(`Invalid email: ${email}`);
  }

  const parts = fqdn.split('.');
  const baseDomain = parts.slice(1).join('.');

  if (await hasWildcardCert(baseDomain, exec)) {
    return {
      skipped: true,
      reason: 'wildcard',
      certPath: `/etc/letsencrypt/live/${baseDomain}/`,
    };
  }

  const existing = await isCertValid(fqdn, exec);
  if (existing.valid) {
    return {
      skipped: true,
      reason: 'exists',
      certPath: `/etc/letsencrypt/live/${fqdn}/`,
    };
  }

  await issueCert(fqdn, email, exec);

  return {
    skipped: false,
    certPath: `/etc/letsencrypt/live/${fqdn}/`,
  };
}

// ---------------------------------------------------------------------------
// Site certificates (a primary name plus aliases, one lineage)
// ---------------------------------------------------------------------------

const HOSTNAME_RE =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

function assertHostname(name: string): void {
  if (typeof name !== 'string' || !HOSTNAME_RE.test(name)) {
    throw new Error(`Invalid hostname: ${String(name)}`);
  }
}

/**
 * The DNS names in the certificate lineage `certName`, or `null` when there
 * is no readable certificate valid for at least another day.
 */
export async function certNames(certName: string, exec: ExecFn): Promise<string[] | null> {
  assertHostname(certName);
  const validity = await isCertValid(certName, exec);
  if (!validity.valid) return null;
  try {
    const { stdout } = await exec('sudo', [CERT_INFO_WRAPPER, certName, 'san']);
    return [...stdout.matchAll(/DNS:([^,\s]+)/g)].map((m) => (m[1] ?? '').toLowerCase());
  } catch {
    return null;
  }
}

export interface IssueSiteCertOptions {
  /**
   * `covering` (default): skip issuance when the current certificate already
   * covers every name, even if it covers more. `exact`: re-issue unless the
   * certificate holds exactly these names — used after names were removed,
   * so renewal never has to validate a hostname the site no longer serves.
   */
  readonly match?: 'covering' | 'exact';
}

/**
 * Ensure one certificate lineage, named after `fqdn`, covers `fqdn` and every
 * alias. The lineage name is fixed with `--cert-name` so the path never
 * drifts to `<fqdn>-0001`; a re-issue replaces the lineage's name set with
 * exactly the given names. Every name must already resolve to this server
 * (HTTP-01 challenge).
 */
export async function issueSiteCert(
  fqdn: string,
  aliases: readonly string[],
  email: string,
  exec: ExecFn,
  options: IssueSiteCertOptions = {},
): Promise<TunnelCertResult> {
  assertHostname(fqdn);
  aliases.forEach(assertHostname);
  const names = [fqdn, ...aliases.filter((a) => a !== fqdn)];
  const certPath = `/etc/letsencrypt/live/${fqdn}/`;

  const current = await certNames(fqdn, exec);
  if (current && names.every((n) => current.includes(n))) {
    const exact = current.length === names.length;
    if (options.match !== 'exact' || exact) {
      return { skipped: true, reason: 'exists', certPath };
    }
  }

  try {
    await exec('sudo', [CERTBOT_WRAPPER, 'issue', email, fqdn, ...names]);
  } catch (err: unknown) {
    const stderr = errText(err);
    if (stderr.includes('too many certificates') || stderr.includes('rate limit')) {
      throw new Error(`Let's Encrypt rate limit reached for ${fqdn}. Details: ${stderr}`);
    }
    if (
      stderr.includes('DNS problem') ||
      stderr.includes('NXDOMAIN') ||
      stderr.includes('no valid A records')
    ) {
      throw new Error(
        `Not every name resolves to this server (${names.join(', ')}); the HTTP-01 ` +
          `challenge needs each one. Details: ${stderr}`,
      );
    }
    throw new Error(`Failed to issue certificate for ${names.join(', ')}: ${stderr}`);
  }

  return { skipped: false, certPath };
}

/**
 * Determine the correct cert path for a given FQDN.
 * Returns the wildcard cert path if available, otherwise the individual cert path.
 */
export async function getCertPath(fqdn: string, domain: string, exec: ExecFn): Promise<string> {
  if (await hasWildcardCert(domain, exec)) {
    return `/etc/letsencrypt/live/${domain}/`;
  }
  return `/etc/letsencrypt/live/${fqdn}/`;
}

/**
 * Check if a valid certificate exists for the given FQDN.
 */
export async function isCertValid(fqdn: string, exec: ExecFn): Promise<CertValidity> {
  const certPath = `/etc/letsencrypt/live/${fqdn}/fullchain.pem`;
  if (!HOSTNAME_RE.test(fqdn)) {
    return { valid: false, certPath: null, expiryDate: null };
  }

  try {
    await exec('sudo', [CERT_INFO_WRAPPER, fqdn, 'checkend']);
  } catch (err: unknown) {
    // Exit 1: the certificate exists but expires within a day. Anything
    // else (3: no certificate, 2: refused) means there is none to use.
    if (isExecError(err) && err.exitCode === 1) {
      return { valid: false, certPath, expiryDate: null };
    }
    return { valid: false, certPath: null, expiryDate: null };
  }

  const expiry = await readLetsEncryptExpiry(fqdn, exec);
  return { valid: true, certPath, expiryDate: expiry?.expiresAt ?? null };
}

/**
 * Expiry of the Let's Encrypt lineage `lineage`, or null when there is no
 * readable certificate.
 */
export async function readLetsEncryptExpiry(
  lineage: string,
  exec: ExecFn,
): Promise<{ expiresAt: string; daysUntilExpiry: number } | null> {
  if (!HOSTNAME_RE.test(lineage)) return null;
  try {
    const { stdout } = await exec('sudo', [CERT_INFO_WRAPPER, lineage, 'enddate']);
    const match = stdout.match(/notAfter=(.+)/);
    if (!match || !match[1]) return null;
    const expiry = new Date(match[1]);
    if (isNaN(expiry.getTime())) return null;
    return {
      expiresAt: expiry.toISOString(),
      daysUntilExpiry: Math.floor((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    };
  } catch {
    return null;
  }
}
