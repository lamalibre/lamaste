import { execa } from 'execa';

/**
 * Issue a Let's Encrypt certificate for a single FQDN using the nginx plugin.
 *
 * @param {string} fqdn - Fully qualified domain name
 * @param {string} email - Email for Let's Encrypt registration
 */
export async function issueCert(fqdn, email) {
  try {
    await execa('sudo', [
      'certbot', 'certonly', '--nginx',
      '-d', fqdn,
      '--email', email,
      '--agree-tos',
      '--non-interactive',
    ]);
  } catch (err) {
    const stderr = err.stderr || err.message;

    if (stderr.includes('too many certificates') || stderr.includes('rate limit')) {
      throw new Error(
        `Let's Encrypt rate limit reached for ${fqdn}. Rate limits allow 50 certificates per registered domain per week. ` +
          'Please wait before trying again. Details: ' + stderr,
      );
    }

    if (stderr.includes('DNS problem') || stderr.includes('NXDOMAIN') || stderr.includes('no valid A records')) {
      throw new Error(
        `DNS is not pointing ${fqdn} to this server. The ACME HTTP-01 challenge requires the domain to resolve ` +
          'to this server. Please verify your DNS configuration. Details: ' + stderr,
      );
    }

    if (stderr.includes('Could not automatically find a matching server block')) {
      throw new Error(
        `The nginx plugin could not find a matching server block for ${fqdn}. ` +
          'Check your nginx configuration. Details: ' + stderr,
      );
    }

    throw new Error(`Failed to issue certificate for ${fqdn}: ${stderr}`);
  }

  const certPath = `/etc/letsencrypt/live/${fqdn}/fullchain.pem`;
  const keyPath = `/etc/letsencrypt/live/${fqdn}/privkey.pem`;

  return { issued: true, domain: fqdn, certPath, keyPath };
}

/**
 * Issue certificates for all core Portlama subdomains in sequence.
 *
 * @param {string} domain - Base domain
 * @param {string} email - Email for Let's Encrypt registration
 */
export async function issueCoreCerts(domain, email) {
  const subdomains = ['panel', 'auth', 'tunnel'];
  const results = [];

  for (const sub of subdomains) {
    const fqdn = `${sub}.${domain}`;
    try {
      const result = await issueCert(fqdn, email);
      results.push(result);
    } catch (err) {
      throw new Error(`Certificate issuance failed for ${fqdn}: ${err.message}`);
    }
  }

  return results;
}

/**
 * Issue a certificate for an app/tunnel subdomain.
 *
 * @param {string} subdomain - Subdomain name
 * @param {string} domain - Base domain
 * @param {string} email - Email for Let's Encrypt registration
 */
export async function issueAppCert(subdomain, domain, email) {
  const fqdn = `${subdomain}.${domain}`;
  return issueCert(fqdn, email);
}

/**
 * List all certificates managed by certbot.
 */
export async function listCerts() {
  let stdout;
  try {
    const result = await execa('sudo', ['certbot', 'certificates']);
    stdout = result.stdout;
  } catch (err) {
    // certbot certificates returns non-zero if no certs exist
    if (err.stdout && err.stdout.includes('No certificates found')) {
      return [];
    }
    throw new Error(`Failed to list certificates: ${err.stderr || err.message}`);
  }

  if (!stdout || stdout.includes('No certificates found')) {
    return [];
  }

  const certs = [];
  const blocks = stdout.split('Certificate Name:').slice(1);

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim());
    const name = lines[0]?.trim() || '';

    const domainsLine = lines.find((l) => l.startsWith('Domains:'));
    const domains = domainsLine
      ? domainsLine.replace('Domains:', '').trim().split(/\s+/)
      : [];

    const expiryLine = lines.find((l) => l.startsWith('Expiry Date:'));
    let expiryDate = null;
    let daysRemaining = 0;
    let isValid = false;

    if (expiryLine) {
      const expiryMatch = expiryLine.match(/Expiry Date:\s*(\S+\s+\S+)/);
      if (expiryMatch) {
        const parsed = new Date(expiryMatch[1]);
        if (!isNaN(parsed.getTime())) {
          expiryDate = parsed.toISOString();
          daysRemaining = Math.floor((parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        }
      }
      isValid = expiryLine.includes('VALID');
    }

    const certPathLine = lines.find((l) => l.startsWith('Certificate Path:'));
    const certPath = certPathLine
      ? certPathLine.replace('Certificate Path:', '').trim()
      : null;

    const keyPathLine = lines.find((l) => l.startsWith('Private Key Path:'));
    const keyPath = keyPathLine
      ? keyPathLine.replace('Private Key Path:', '').trim()
      : null;

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

/**
 * Renew a specific certificate by name.
 *
 * @param {string} domain - Certificate name (usually the domain)
 */
export async function renewCert(domain) {
  try {
    await execa('sudo', ['certbot', 'renew', '--cert-name', domain]);
    return { renewed: true, domain };
  } catch (err) {
    throw new Error(`Failed to renew certificate for ${domain}: ${err.stderr || err.message}`);
  }
}

/**
 * Attempt renewal of all certificates.
 */
export async function renewAll() {
  try {
    const { stdout } = await execa('sudo', ['certbot', 'renew']);
    return { renewed: true, output: stdout };
  } catch (err) {
    throw new Error(`Failed to renew certificates: ${err.stderr || err.message}`);
  }
}

/**
 * Enable the certbot systemd timer for automatic certificate renewal.
 */
export async function setupAutoRenew() {
  try {
    await execa('sudo', ['systemctl', 'enable', 'certbot.timer']);
    await execa('sudo', ['systemctl', 'start', 'certbot.timer']);
  } catch (err) {
    throw new Error(`Failed to set up auto-renewal: ${err.stderr || err.message}`);
  }

  try {
    const { stdout } = await execa('systemctl', ['is-active', 'certbot.timer']);
    if (stdout.trim() === 'active') {
      return { enabled: true };
    }
  } catch {
    // is-active returns non-zero for inactive
  }

  throw new Error('Certbot timer is not active after enabling.');
}

/**
 * Check if a wildcard certificate already covers all subdomains of the given domain.
 *
 * @param {string} domain - The base domain (e.g., "example.com")
 * @returns {Promise<boolean>}
 */
export async function hasWildcardCert(domain) {
  const certs = await listCerts();
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
 *
 * @param {string} fqdn - The full domain name (e.g., "myapp.example.com")
 * @param {string} email - Admin email for Let's Encrypt notifications
 * @returns {Promise<{ skipped: boolean, reason?: string, certPath: string }>}
 */
export async function issueTunnelCert(fqdn, email) {
  // Validate FQDN to prevent command injection
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(fqdn)) {
    throw new Error(`Invalid FQDN: ${fqdn}`);
  }

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Invalid email: ${email}`);
  }

  // Extract base domain (e.g., "example.com" from "myapp.example.com")
  const parts = fqdn.split('.');
  const baseDomain = parts.slice(1).join('.');

  // Check for wildcard cert
  if (await hasWildcardCert(baseDomain)) {
    return {
      skipped: true,
      reason: 'wildcard',
      certPath: `/etc/letsencrypt/live/${baseDomain}/`,
    };
  }

  // Check if an individual cert already exists and is valid for this FQDN
  const existing = await isCertValid(fqdn);
  if (existing.valid) {
    return {
      skipped: true,
      reason: 'exists',
      certPath: `/etc/letsencrypt/live/${fqdn}/`,
    };
  }

  // Issue new certificate
  await issueCert(fqdn, email);

  return {
    skipped: false,
    certPath: `/etc/letsencrypt/live/${fqdn}/`,
  };
}

/**
 * Determine the correct cert path for a given FQDN.
 * Returns the wildcard cert path if available, otherwise the individual cert path.
 *
 * @param {string} fqdn - Fully qualified domain name
 * @param {string} domain - Base domain
 * @returns {Promise<string>} Certificate directory path
 */
export async function getCertPath(fqdn, domain) {
  if (await hasWildcardCert(domain)) {
    return `/etc/letsencrypt/live/${domain}/`;
  }
  return `/etc/letsencrypt/live/${fqdn}/`;
}

/**
 * Check if a valid certificate exists for the given FQDN.
 *
 * @param {string} fqdn - Fully qualified domain name
 */
export async function isCertValid(fqdn) {
  const certPath = `/etc/letsencrypt/live/${fqdn}/fullchain.pem`;

  try {
    // Check if cert exists and is valid for at least 24 more hours
    await execa('sudo', [
      'openssl', 'x509', '-checkend', '86400', '-noout', '-in', certPath,
    ]);

    // Get expiry date
    const { stdout } = await execa('sudo', [
      'openssl', 'x509', '-enddate', '-noout', '-in', certPath,
    ]);
    const match = stdout.match(/notAfter=(.+)/);
    const expiryDate = match ? new Date(match[1]).toISOString() : null;

    return { valid: true, certPath, expiryDate };
  } catch (err) {
    // If the file doesn't exist, openssl will fail
    if (err.stderr?.includes('No such file') || err.stderr?.includes('unable to load certificate')) {
      return { valid: false, certPath: null, expiryDate: null };
    }

    // Exit code 1 means cert expires within 24 hours
    if (err.exitCode === 1) {
      return { valid: false, certPath, expiryDate: null };
    }

    return { valid: false, certPath: null, expiryDate: null };
  }
}
