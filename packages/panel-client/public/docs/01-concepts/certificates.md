# Certificates

> Portlama manages three types of TLS certificates: Let's Encrypt certificates for public domains, self-signed certificates for IP access, and mTLS client certificates for admin authentication.

## In Plain English

When you visit a website over HTTPS, your browser checks the site's certificate to verify two things: the connection is encrypted, and the site is who it claims to be. Without a certificate, your browser shows a warning and the connection is insecure.

Portlama needs certificates for every domain it serves — `panel.example.com`, `auth.example.com`, `myapp.example.com`, and so on. Buying certificates would be expensive and tedious, so Portlama uses Let's Encrypt, a free certificate authority that issues certificates automatically.

Think of Let's Encrypt like a free notary service. Portlama asks "I need a certificate for myapp.example.com," and Let's Encrypt says "prove you control that domain." Portlama proves it by serving a specific file on that domain (an HTTP challenge). Let's Encrypt verifies the file is there and issues the certificate. The whole process takes a few seconds and happens without any human intervention.

Let's Encrypt certificates expire every 90 days. Portlama sets up automatic renewal so you never need to think about it. A system timer checks twice daily whether any certificates need renewing and handles it silently.

For the IP-based admin panel (`https://<ip>:9292`), there is no domain to verify, so Portlama uses a self-signed certificate instead. Your browser shows a security warning for self-signed certificates, but the connection is still encrypted. The real authentication for the admin panel comes from the [mTLS client certificate](mtls.md), not from the server certificate.

## For Users

### Certificate types in Portlama

| Type            | Where used                            | Issued by          | Validity | Auto-renew          |
| --------------- | ------------------------------------- | ------------------ | -------- | ------------------- |
| Let's Encrypt   | Domain-based vhosts (`*.example.com`) | Let's Encrypt CA   | 90 days  | Yes (systemd timer) |
| Self-signed TLS | IP-based panel (`https://IP:9292`)    | Portlama installer | 10 years | No (long validity)  |
| mTLS CA         | nginx client cert verification        | Portlama installer | 10 years | No (long validity)  |
| mTLS client     | Browser authentication                | Portlama CA        | 2 years  | Manual rotation     |

### When certificates are issued

- **Self-signed + mTLS certs** — created during `npx @lamalibre/create-portlama` installation
- **Core Let's Encrypt certs** — issued during onboarding for `panel`, `auth`, and `tunnel` subdomains
- **App Let's Encrypt certs** — issued when you create a new tunnel

### Viewing certificates

The Certificates page in the management panel shows all certificates with:

- Domain name
- Issuer (Let's Encrypt or self-signed)
- Expiry date
- Days remaining
- Status (valid, expiring soon, expired)

### Certificate renewal

Let's Encrypt certificates are automatically renewed by a systemd timer (`certbot.timer`). The timer runs twice daily and renews any certificate expiring within 30 days.

You can also manually trigger renewal from the Certificates page:

1. Find the certificate in the list
2. Click "Renew"
3. Portlama runs `certbot renew` for that certificate
4. nginx reloads to pick up the new certificate

### mTLS client certificate rotation

Your admin client certificate expires after 2 years. The Certificates page shows when it expires. To rotate it:

1. Click "Rotate Client Certificate" on the Certificates page
2. Portlama generates a new key pair and certificate, signed by the same CA
3. A new `.p12` file is generated with a new random password
4. Download the new `.p12` file and import it into your browser
5. Remove the old certificate from your browser/keychain

**Important:** after rotation, the old certificate is immediately invalid. Download and import the new one before closing the page or navigating away.

### What happens when certificates expire

| Certificate     | If it expires                          | Impact                                                          | Recovery                                          |
| --------------- | -------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| Let's Encrypt   | Browsers show security warning         | Visitors see "not secure" for that domain                       | Renew via panel or `certbot renew`                |
| Self-signed TLS | Browser warning changes                | Minimal — browsers already show a warning for self-signed certs | Re-run installer                                  |
| mTLS CA         | Client certs can no longer be verified | Admin panel becomes inaccessible                                | Re-provision PKI (requires SSH)                   |
| mTLS client     | nginx rejects the certificate          | Admin panel inaccessible from that browser                      | Rotate from panel (if another device still works) |

The most critical scenario is the mTLS CA expiring, but it has a 10-year validity, making this a distant concern.

## For Developers

### Let's Encrypt implementation

Portlama uses certbot with the nginx plugin for certificate issuance. The implementation lives in `packages/panel-server/src/lib/certbot.js`.

#### Issuing a certificate

```javascript
export async function issueCert(fqdn, email) {
  try {
    await execa('sudo', [
      'certbot',
      'certonly',
      '--nginx',
      '-d',
      fqdn,
      '--email',
      email,
      '--agree-tos',
      '--non-interactive',
    ]);
  } catch (err) {
    const stderr = err.stderr || err.message;

    if (stderr.includes('too many certificates') || stderr.includes('rate limit')) {
      throw new Error(`Let's Encrypt rate limit reached for ${fqdn}...`);
    }

    if (stderr.includes('DNS problem') || stderr.includes('NXDOMAIN')) {
      throw new Error(`DNS is not pointing ${fqdn} to this server...`);
    }

    throw new Error(`Failed to issue certificate for ${fqdn}: ${stderr}`);
  }

  return {
    issued: true,
    domain: fqdn,
    certPath: `/etc/letsencrypt/live/${fqdn}/fullchain.pem`,
    keyPath: `/etc/letsencrypt/live/${fqdn}/privkey.pem`,
  };
}
```

The error handling distinguishes between rate limits, DNS problems, and nginx configuration issues, providing specific guidance for each failure mode.

#### HTTP-01 challenge

The `--nginx` plugin uses the HTTP-01 challenge method:

```
1. Certbot creates a challenge file at /.well-known/acme-challenge/<token>
2. Certbot temporarily modifies nginx to serve this file
3. Let's Encrypt's servers request https://fqdn/.well-known/acme-challenge/<token>
4. If the response matches, the domain is verified
5. Let's Encrypt issues the certificate
6. Certbot restores the nginx configuration
```

This requires that the FQDN resolves to the VPS IP and that port 443 is accessible from the internet. See [DNS and Domains](dns-and-domains.md) for DNS configuration details.

#### Core certificate issuance

During onboarding, certificates are issued sequentially for the three core subdomains:

```javascript
export async function issueCoreCerts(domain, email) {
  const subdomains = ['panel', 'auth', 'tunnel'];
  const results = [];

  for (const sub of subdomains) {
    const fqdn = `${sub}.${domain}`;
    const result = await issueCert(fqdn, email);
    results.push(result);
  }

  return results;
}
```

Sequential issuance avoids triggering Let's Encrypt rate limits from parallel requests.

#### Tunnel certificate issuance

When creating a tunnel, the system checks for existing coverage before issuing a new certificate:

```javascript
export async function issueTunnelCert(fqdn, email) {
  // 1. Check for wildcard cert
  const baseDomain = fqdn.split('.').slice(1).join('.');
  if (await hasWildcardCert(baseDomain)) {
    return { skipped: true, reason: 'wildcard', certPath: `.../${baseDomain}/` };
  }

  // 2. Check for existing valid individual cert
  const existing = await isCertValid(fqdn);
  if (existing.valid) {
    return { skipped: true, reason: 'exists', certPath: `.../${fqdn}/` };
  }

  // 3. Issue new certificate
  await issueCert(fqdn, email);
  return { skipped: false, certPath: `.../${fqdn}/` };
}
```

This three-step check prevents unnecessary certificate issuance and respects rate limits.

#### Input validation

The `issueTunnelCert` function validates both the FQDN and email before proceeding:

```javascript
if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(fqdn)) {
  throw new Error(`Invalid FQDN: ${fqdn}`);
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error(`Invalid email: ${email}`);
}
```

These checks prevent command injection through the certbot CLI arguments.

### Certificate validity checks

The `isCertValid` function uses OpenSSL to check if a certificate exists and is valid for at least 24 more hours:

```javascript
export async function isCertValid(fqdn) {
  const certPath = `/etc/letsencrypt/live/${fqdn}/fullchain.pem`;

  try {
    // Check if cert is valid for at least 24 more hours
    await execa('sudo', ['openssl', 'x509', '-checkend', '86400', '-noout', '-in', certPath]);

    // Get expiry date
    const { stdout } = await execa('sudo', [
      'openssl',
      'x509',
      '-enddate',
      '-noout',
      '-in',
      certPath,
    ]);
    const match = stdout.match(/notAfter=(.+)/);
    const expiryDate = match ? new Date(match[1]).toISOString() : null;

    return { valid: true, certPath, expiryDate };
  } catch (err) {
    if (err.stderr?.includes('No such file')) {
      return { valid: false, certPath: null, expiryDate: null };
    }
    if (err.exitCode === 1) {
      // Certificate expires within 24 hours
      return { valid: false, certPath, expiryDate: null };
    }
    return { valid: false, certPath: null, expiryDate: null };
  }
}
```

The `openssl x509 -checkend 86400` command exits with code 0 if the certificate is valid for at least 86400 seconds (24 hours) and code 1 otherwise. This provides a simple binary check without parsing dates.

### Listing certificates

The `listCerts` function parses the output of `certbot certificates` to build a structured list:

```javascript
export async function listCerts() {
  const { stdout } = await execa('sudo', ['certbot', 'certificates']);

  if (stdout.includes('No certificates found')) return [];

  const blocks = stdout.split('Certificate Name:').slice(1);
  return blocks.map((block) => {
    // Parse: name, domains, expiry, cert path, key path, validity
    // ...
    return { name, domains, expiryDate, daysRemaining, certPath, keyPath, isValid };
  });
}
```

This list is combined with mTLS certificate information from `packages/panel-server/src/lib/mtls.js` to present a unified certificate view in the panel.

### Auto-renewal setup

During onboarding provisioning, the certbot systemd timer is enabled:

```javascript
export async function setupAutoRenew() {
  await execa('sudo', ['systemctl', 'enable', 'certbot.timer']);
  await execa('sudo', ['systemctl', 'start', 'certbot.timer']);

  const { stdout } = await execa('systemctl', ['is-active', 'certbot.timer']);
  if (stdout.trim() !== 'active') {
    throw new Error('Certbot timer is not active after enabling.');
  }
  return { enabled: true };
}
```

The certbot timer runs twice daily (standard certbot behavior). It only renews certificates that expire within 30 days, so most runs are no-ops.

After renewal, certbot automatically reloads nginx via a deploy hook, ensuring the new certificate is served immediately.

### Self-signed certificate for IP access

The installer generates a self-signed certificate during nginx setup:

```bash
openssl req -x509 -nodes \
  -days 3650 \
  -newkey rsa:2048 \
  -keyout /etc/portlama/pki/self-signed-key.pem \
  -out /etc/portlama/pki/self-signed.pem \
  -subj "/CN=203.0.113.42/O=Portlama" \
  -addext "subjectAltName=IP:203.0.113.42"
```

The `-addext subjectAltName=IP:...` flag embeds the IP address in the Subject Alternative Name field. Without this, modern browsers reject the certificate even for IP-based access.

The self-signed certificate uses a 2048-bit key (smaller than the 4096-bit mTLS keys) because it serves a less critical role — it is only for IP-based access where the browser already shows a warning.

### Certificate file layout

```
/etc/letsencrypt/live/
├── panel.example.com/
│   ├── fullchain.pem        Let's Encrypt cert chain
│   ├── privkey.pem          Private key
│   ├── cert.pem             Server certificate only
│   └── chain.pem            Intermediate CA chain
├── auth.example.com/
│   └── (same structure)
├── tunnel.example.com/
│   └── (same structure)
└── myapp.example.com/
    └── (same structure)

/etc/portlama/pki/
├── self-signed.pem          Self-signed TLS cert (IP access)
├── self-signed-key.pem      Self-signed TLS key
├── ca.crt                   mTLS CA certificate
├── ca.key                   mTLS CA private key
├── client.crt               mTLS client certificate
├── client.key               mTLS client private key
├── client.p12               PKCS12 bundle for browser import
├── .p12-password            Password for the .p12 file
├── revoked.json             Revoked certificate serials
├── enrollment-tokens.json   Pending hardware-bound enrollment tokens
└── agents/
    ├── registry.json        Agent certificate registry
    └── <label>/
        └── client.p12       Agent PKCS12 bundle
```

### mTLS certificate expiry monitoring

The panel server reads mTLS certificate expiry dates using OpenSSL:

```javascript
export async function readCertExpiry(certPath) {
  const { stdout } = await execa('sudo', [
    'openssl',
    'x509',
    '-in',
    certPath,
    '-enddate',
    '-noout',
  ]);
  const match = stdout.match(/notAfter=(.+)/);
  const expiryDate = new Date(match[1]);
  const daysUntilExpiry = Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return { expiresAt: expiryDate.toISOString(), daysUntilExpiry };
}
```

Certificates with 30 or fewer days remaining are flagged as `expiringSoon` in the API response.

### Source files

| File                                                   | Purpose                                  |
| ------------------------------------------------------ | ---------------------------------------- |
| `packages/panel-server/src/lib/certbot.js`             | Let's Encrypt issuance, renewal, listing |
| `packages/panel-server/src/lib/mtls.js`                | mTLS cert expiry, rotation, download     |
| `packages/panel-server/src/routes/management/certs.js` | Certificate management API               |
| `packages/create-portlama/src/tasks/nginx.js`          | Self-signed cert generation              |
| `packages/create-portlama/src/tasks/mtls.js`           | mTLS CA and client cert generation       |
| `packages/panel-server/src/lib/csr-signing.js`         | CSR signing for hardware-bound enrollment|
| `packages/panel-server/src/lib/enrollment.js`          | Enrollment token management              |
| `packages/panel-server/src/routes/enrollment.js`       | Public enrollment route                  |

## Quick Reference

### Certificate types

| Type            | Location                            | Issued by        | Validity | Key size     |
| --------------- | ----------------------------------- | ---------------- | -------- | ------------ |
| Let's Encrypt   | `/etc/letsencrypt/live/<fqdn>/`     | Let's Encrypt CA | 90 days  | 2048-bit RSA |
| Self-signed TLS | `/etc/portlama/pki/self-signed.pem` | Self             | 10 years | 2048-bit RSA |
| mTLS CA         | `/etc/portlama/pki/ca.crt`          | Self             | 10 years | 4096-bit RSA |
| mTLS client     | `/etc/portlama/pki/client.crt`      | Portlama CA      | 2 years  | 4096-bit RSA |

### certbot commands

```bash
# List all certificates
sudo certbot certificates

# Renew a specific certificate
sudo certbot renew --cert-name panel.example.com

# Renew all certificates due for renewal
sudo certbot renew

# Issue a new certificate
sudo certbot certonly --nginx -d myapp.example.com --email admin@example.com --agree-tos --non-interactive

# Check auto-renewal timer
systemctl status certbot.timer
```

### OpenSSL commands

```bash
# View certificate details
openssl x509 -in /etc/letsencrypt/live/panel.example.com/fullchain.pem -text -noout

# Check certificate expiry date
openssl x509 -in /etc/letsencrypt/live/panel.example.com/fullchain.pem -enddate -noout

# Check if cert is valid for 30+ days
openssl x509 -checkend 2592000 -noout -in /path/to/cert.pem

# Verify certificate chain
openssl verify -CAfile /etc/letsencrypt/live/panel.example.com/chain.pem \
  /etc/letsencrypt/live/panel.example.com/cert.pem
```

### API endpoints

| Method | Path                       | Description                                  |
| ------ | -------------------------- | -------------------------------------------- |
| GET    | `/api/certs`               | List all certificates (Let's Encrypt + mTLS) |
| POST   | `/api/certs/:domain/renew` | Force renewal of a specific certificate      |
| POST   | `/api/certs/mtls/rotate`   | Rotate the mTLS client certificate           |
| GET    | `/api/certs/mtls/download` | Download the current `.p12` bundle           |
| POST   | `/api/certs/agent/enroll`  | Generate enrollment token (admin)            |
| POST   | `/api/enroll`              | Enroll agent with token (public)             |
| POST   | `/api/certs/admin/upgrade-to-hardware-bound` | Upgrade admin auth (admin)   |
| GET    | `/api/certs/admin/auth-mode` | Get admin auth mode (admin)                |

### Let's Encrypt rate limits

| Limit                              | Value               | Notes                                   |
| ---------------------------------- | ------------------- | --------------------------------------- |
| Certificates per registered domain | 50/week             | Covers all subdomains of `example.com`  |
| Duplicate certificates             | 5/week              | Same set of domains                     |
| Failed validations                 | 5/hour              | Per account per hostname                |
| Certificate renewals               | Exempt from 50/week | Renewals do not count against the limit |

### Related documentation

- [mTLS](mtls.md) — client certificate details and PKCS12 bundles
- [DNS and Domains](dns-and-domains.md) — DNS must be correct for Let's Encrypt
- [nginx Reverse Proxy](nginx-reverse-proxy.md) — nginx uses these certificates
- [Security Model](security-model.md) — TLS as part of defense-in-depth
