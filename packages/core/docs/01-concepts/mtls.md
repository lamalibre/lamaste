# Mutual TLS (mTLS)

> Lamaste uses client certificates to authenticate admin access — your browser proves its identity at the TLS level before any HTTP request is sent.

## In Plain English

When you visit a normal HTTPS website, your browser checks the server's certificate to verify you are talking to the real site. This is one-way trust: the browser trusts the server.

Mutual TLS (mTLS) adds a second direction. The server also checks _your_ certificate to verify you are an authorized admin. This is two-way trust: the browser trusts the server, and the server trusts the browser.

Think of it like a members-only club with ID checks at the door. The club has a sign outside proving it is legitimate (the server certificate). But to get in, you also need to show your membership card (the client certificate). If you do not have the card, the bouncer does not even let you through the door — you never reach the lobby.

This is exactly how Lamaste protects its admin panel. During installation, a digital "membership card" (a `.p12` file) is generated. You import it into your browser once, and from then on, every time you visit the panel, your browser automatically presents the certificate. No username, no password, no login page. If someone without the certificate tries to access the panel, nginx rejects the connection at the TLS layer — before any HTTP traffic is exchanged.

This approach is inspired by [LXD](https://documentation.ubuntu.com/lxd/en/latest/), which uses the same client certificate model for its management API.

## For Users

### When you encounter mTLS

You encounter mTLS during two moments:

1. **After installation** — the installer prints a `.p12` file path and password. You download this file and import it into your browser or OS keychain.
2. **Every time you visit the panel** — your browser silently presents the certificate. You see no login prompt; you are simply authenticated.

### Importing the certificate

After running `npx @lamalibre/create-lamaste`, the installer prints something like:

```
╔══════════════════════════════════════════════════════════════╗
║  Client certificate ready                                    ║
║                                                              ║
║  Download:  scp root@203.0.113.42:/etc/lamalibre/lamaste/pki/client.p12 .  ║
║  Password:  a7f3b2e1d9c8456e                                ║
║  Panel URL: https://203.0.113.42:9292                        ║
╚══════════════════════════════════════════════════════════════╝
```

You copy the `.p12` file to your local machine and import it.

#### macOS (Safari and Chrome)

1. Double-click the `.p12` file
2. Keychain Access opens — choose "login" keychain
3. Enter the password printed by the installer
4. The certificate appears under "My Certificates" in Keychain Access
5. Visit `https://203.0.113.42:9292` — Safari/Chrome prompts you to select a certificate
6. Select the "Lamaste Client" certificate and click OK

macOS remembers this selection. Future visits present the certificate automatically.

#### macOS (Firefox)

Firefox uses its own certificate store, separate from Keychain Access:

1. Open Firefox → Settings → Privacy & Security → Certificates → View Certificates
2. Click "Your Certificates" tab → "Import"
3. Select the `.p12` file and enter the password
4. Visit `https://203.0.113.42:9292` — Firefox prompts you to select a certificate

#### Windows (Chrome and Edge)

1. Double-click the `.p12` file
2. The Certificate Import Wizard opens
3. Choose "Current User" and click Next
4. Enter the password and click Next
5. Choose "Automatically select the certificate store" and click Next
6. Visit `https://203.0.113.42:9292`

#### Linux (Chrome)

1. Open Chrome → Settings → Privacy and Security → Security → Manage certificates
2. Click "Your certificates" → "Import"
3. Select the `.p12` file and enter the password
4. Visit `https://203.0.113.42:9292`

### What happens without a certificate

If you visit the panel URL in a browser that does not have the client certificate imported, nginx rejects the TLS handshake. Instead of the panel, you see a certificate help page explaining what happened and how to import the certificate.

The rejection happens at the TLS level — no HTTP request ever reaches the panel server. This is a stronger security boundary than a login page, which at minimum requires the server to parse and respond to HTTP requests.

### Zero-login access

Once the certificate is imported, you never see a login page for the admin panel. Your browser presents the certificate automatically on every HTTPS connection to the panel. This is what "zero-login" means — authentication is handled by the TLS layer, not by the application.

This does not affect the tunneled apps. Visitors to your tunneled apps authenticate through [Authelia TOTP 2FA](authentication.md), which is a separate system entirely.

### Multiple devices

The `.p12` file can be imported into multiple browsers and devices. If you want to access the admin panel from both your laptop and your phone, import the same `.p12` file on each.

If you lose access to the certificate and need a new one, you can rotate the client certificate from the Certificates page in the management panel (assuming you still have access from another device).

### Agent certificates

When connecting a machine to Lamaste using `lamaste-agent`, you should **not** use the admin certificate. Instead, generate a scoped agent certificate from the panel:

1. Open the Lamaste panel → Certificates → Agent Certificates
2. Click "Generate" and enter a label (e.g., `macbook-pro`)
3. Save the displayed password — it cannot be retrieved later
4. Download the `.p12` file
5. Share the `.p12` file and password with the Mac user through a secure channel

Agent certificates have capability-based access. By default, a new agent can only read tunnel configuration. Admins can grant additional capabilities per-agent from the panel UI:

| Capability       | What it grants                                                                         |
| ---------------- | -------------------------------------------------------------------------------------- |
| `tunnels:read`   | List tunnels, download plist (always-on)                                               |
| `tunnels:write`  | Create and delete tunnels                                                              |
| `services:read`  | View service status                                                                    |
| `services:write` | Start/stop/restart services                                                            |
| `system:read`    | View system stats (CPU, RAM, disk)                                                     |
| `sites:read`     | List sites and browse files                                                            |
| `sites:write`    | Upload and delete files on assigned sites                                              |
| `panel:expose`   | Expose agent management panel at `agent-<label>.<domain>` via mTLS-protected subdomain |
| `identity:read`  | Parse Authelia identity headers on plugin routes                                       |
| `identity:query` | Query panel for Authelia user metadata                                                 |

Capabilities are stored server-side, so changing what an agent can do does not require reissuing its certificate. Users, certificates, agent management, and logs always remain admin-only.

If a machine is compromised, the attacker is limited to whichever capabilities were assigned to that agent's certificate — and the admin can revoke or reduce capabilities at any time from the panel. The agent will immediately lose access.

## For Developers

### PKI hierarchy

Lamaste generates a minimal two-level PKI (Public Key Infrastructure) during installation:

```
Lamaste CA (self-signed, 10-year validity)
    │
    ├── Admin certificate (CN=admin, signed by CA, 2-year validity)
    │     └── Full panel access
    │
    └── Agent certificates (CN=agent:<label>, signed by CA, 2-year validity)
          └── Capability-based access (one per agent)
```

The CA (Certificate Authority) is self-signed because there is no need for external trust. The only party that needs to trust the CA is nginx on the same server. nginx is configured with the CA's public certificate and rejects any client certificate not signed by that CA.

All certificates — admin and agent — are signed by the same CA. The difference is the Common Name (CN): the mTLS middleware parses the CN to determine the role and restricts access accordingly.

### Certificate generation

The installer (`packages/create-lamaste/src/tasks/mtls.js`) generates the PKI in five steps:

```
1. Generate CA private key     (4096-bit RSA)
2. Create self-signed CA cert  (CN=Lamaste CA, 10-year, SHA-256)
3. Generate client private key (4096-bit RSA)
4. Create CSR and sign it      (CN=admin, 2-year, SHA-256)
5. Export PKCS12 bundle        (client key + cert + CA cert)
```

Each step uses OpenSSL CLI commands via `execa`:

```javascript
// Step 1: CA key
await execa('openssl', ['genrsa', '-out', `${pkiDir}/ca.key`, '4096']);

// Step 2: CA certificate
await execa('openssl', [
  'req',
  '-x509',
  '-new',
  '-nodes',
  '-key',
  `${pkiDir}/ca.key`,
  '-sha256',
  '-days',
  '3650',
  '-out',
  `${pkiDir}/ca.crt`,
  '-subj',
  '/CN=Lamaste CA/O=Lamaste',
]);

// Step 3: Client key
await execa('openssl', ['genrsa', '-out', `${pkiDir}/client.key`, '4096']);

// Step 4: CSR + sign
await execa('openssl', [
  'req',
  '-new',
  '-key',
  `${pkiDir}/client.key`,
  '-out',
  `${pkiDir}/client.csr`,
  '-subj',
  '/CN=admin/O=Lamaste',
]);
await execa('openssl', [
  'x509',
  '-req',
  '-in',
  `${pkiDir}/client.csr`,
  '-CA',
  `${pkiDir}/ca.crt`,
  '-CAkey',
  `${pkiDir}/ca.key`,
  '-CAcreateserial',
  '-out',
  `${pkiDir}/client.crt`,
  '-days',
  '730',
  '-sha256',
]);

// Step 5: PKCS12 bundle
await execa('openssl', [
  'pkcs12',
  '-export',
  '-keypbe',
  'PBE-SHA1-3DES',
  '-certpbe',
  'PBE-SHA1-3DES',
  '-macalg',
  'sha1',
  '-out',
  `${pkiDir}/client.p12`,
  '-inkey',
  `${pkiDir}/client.key`,
  '-in',
  `${pkiDir}/client.crt`,
  '-certfile',
  `${pkiDir}/ca.crt`,
  '-passout',
  `pass:${password}`,
]);
```

### PKCS12 compatibility flags

The PKCS12 export uses legacy encryption algorithms (`PBE-SHA1-3DES`) and SHA-1 MAC. This is deliberate. Modern OpenSSL 3.x defaults to AES-256-CBC with SHA-256, which macOS Keychain Access cannot import. The legacy flags ensure compatibility across all platforms:

| Platform              | Modern PKCS12 | Legacy PKCS12 (PBE-SHA1-3DES) |
| --------------------- | :-----------: | :---------------------------: |
| macOS Keychain Access |     fails     |             works             |
| Firefox               |     works     |             works             |
| Chrome (Windows)      |     works     |             works             |
| Chrome (Linux)        |     works     |             works             |

### nginx mTLS enforcement

The installer writes an nginx snippet at `/etc/nginx/snippets/lamalibre-lamaste-mtls.conf`:

```nginx
ssl_client_certificate /etc/lamalibre/lamaste/pki/ca.crt;
ssl_verify_client optional;
```

This snippet is included in every nginx vhost that should require mTLS. The `ssl_verify_client optional` directive enables client certificate verification at the TLS level while still allowing connections without a certificate (needed for public endpoints like `/api/enroll` and `/api/invite`). Protected locations enforce mTLS via `if ($ssl_client_verify != SUCCESS) { return 496; }` in each vhost's location blocks. If a client presents a certificate not signed by the specified CA, nginx returns a 495 or 496 error — before any application code runs.

The panel vhost includes this snippet and uses per-location `if` checks to enforce mTLS on protected locations while allowing public endpoints through:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 9292 ssl;
    server_name _;

    ssl_certificate /etc/lamalibre/lamaste/pki/self-signed.pem;
    ssl_certificate_key /etc/lamalibre/lamaste/pki/self-signed-key.pem;

    include /etc/nginx/snippets/lamalibre-lamaste-mtls.conf;

    # Show help page when client cert is missing
    error_page 495 496 /cert-help.html;
    location = /cert-help.html {
        root /opt/lamalibre/lamaste/lamaste-server-ui;
        internal;
    }

    # Protected locations — reject if client cert missing or invalid
    location / {
        if ($ssl_client_verify != SUCCESS) {
            return 496;
        }
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header X-SSL-Client-Verify $ssl_client_verify;
        proxy_set_header X-SSL-Client-DN $ssl_client_s_dn;
        proxy_set_header X-SSL-Client-Serial $ssl_client_serial;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Public API paths — no mTLS check, cert headers cleared
    location /api/enroll {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header X-SSL-Client-Verify "";
        proxy_set_header X-SSL-Client-DN "";
        proxy_set_header X-SSL-Client-Serial "";
        # ... standard proxy headers
    }

    location /api/invite {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header X-SSL-Client-Verify "";
        proxy_set_header X-SSL-Client-DN "";
        proxy_set_header X-SSL-Client-Serial "";
        # ... standard proxy headers
    }

    # API paths with WebSocket upgrade support (mTLS required)
    location /api {
        if ($ssl_client_verify != SUCCESS) {
            return 496;
        }
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header X-SSL-Client-Verify $ssl_client_verify;
        proxy_set_header X-SSL-Client-DN $ssl_client_s_dn;
        proxy_set_header X-SSL-Client-Serial $ssl_client_serial;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

The `error_page 495 496` directive shows a help page explaining how to import the certificate, rather than showing a cryptic TLS error. Public endpoints (`/api/enroll` for agent enrollment and `/api/invite` for user invitations) clear the client certificate headers so that the Fastify server treats them as unauthenticated requests, matching their registration in the `publicContext` (no mTLS middleware).

### Certificate help page

When a visitor without a client certificate hits the panel, nginx serves a static HTML page from `/opt/lamalibre/lamaste/lamaste-server-ui/cert-help.html`. This page explains what mTLS is and provides step-by-step import instructions. The page is generated during installation with the VPS IP address embedded, so the SCP command is ready to copy.

### Client certificate headers

After TLS negotiation succeeds, nginx forwards client certificate information to the panel server via headers:

```nginx
proxy_set_header X-SSL-Client-Verify $ssl_client_verify;
proxy_set_header X-SSL-Client-DN $ssl_client_s_dn;
proxy_set_header X-SSL-Client-Serial $ssl_client_serial;
```

The panel server's mTLS middleware checks these headers in order:

1. **`X-SSL-Client-Verify`** — must be `SUCCESS` (valid client cert); any other value (`FAILED`, `NONE`) results in a 403 Forbidden response.
2. **`X-SSL-Client-Serial`** — checked against the revocation list (`revoked.json`); if the serial is revoked, the request is rejected with 403.
3. **`X-SSL-Client-DN`** — the CN is parsed to determine the role. `CN=admin` grants full access; `CN=agent:<label>` grants capability-based access with permissions looked up from the agent registry.

In development (`NODE_ENV=development`), all checks are skipped.

### Certificate rotation

Client certificates expire after 2 years. The management panel's Certificates page shows the expiry date and provides a rotation function.

Rotation (`packages/lamaste-serverd/src/lib/mtls.js`) follows a safe sequence:

```
1. Verify CA key exists
2. Generate new client key (4096-bit RSA)
3. Create CSR and sign with existing CA (2-year validity)
4. Create new PKCS12 bundle with random password
5. Back up current client.key, client.crt, client.p12
6. Move new files into place
7. Clean up CSR and serial file
8. Set restrictive file permissions
```

After rotation, the server returns the new PKCS12 password and a warning: "Your current browser certificate is now invalid. Download and import the new certificate before closing this page."

The CA certificate is never rotated — it has a 10-year validity. Since nginx trusts the CA, and all client certificates are signed by the same CA, rotating the client cert does not require any nginx changes.

### Idempotent installation

The mTLS generation task is idempotent. If `ca.key` and `client.p12` already exist (e.g., the installer is re-run), the entire generation is skipped. This prevents invalidating a previously imported client certificate:

```javascript
const alreadyProvisioned = existsSync(`${pkiDir}/ca.key`) && existsSync(`${pkiDir}/client.p12`);

if (alreadyProvisioned) {
  // Read existing p12 password for the summary display
  ctx.p12Password = await readFile(`${pkiDir}/.p12-password`, 'utf8');
  return; // Skip all generation steps
}
```

### File layout

```
/etc/lamalibre/lamaste/pki/
├── ca.key              (600) CA private key — never leaves the server
├── ca.crt              (644) CA certificate — nginx uses this to verify clients
├── client.key          (600) Admin client private key — bundled into .p12
├── client.crt          (644) Admin client certificate — bundled into .p12
├── client.p12          (600) Admin PKCS12 bundle — downloaded by admin
├── .p12-password       (600) Password for the admin .p12 file
├── self-signed.pem     (644) Self-signed TLS cert for IP access
├── self-signed-key.pem (600) Key for self-signed TLS cert
├── revoked.json        (600) Revoked certificate serial numbers
└── agents/                   Agent certificate storage
    ├── registry.json   (600) Metadata for all agent certs
    └── <label>/              Per-agent directory
        ├── client.key  (600) Agent private key
        ├── client.crt  (644) Agent certificate (CN=agent:<label>)
        └── client.p12  (600) Agent PKCS12 bundle
```

### Source files

| File                                                      | Purpose                                            |
| --------------------------------------------------------- | -------------------------------------------------- |
| `packages/create-lamaste/src/tasks/mtls.js`               | PKI generation during installation                 |
| `packages/create-lamaste/src/tasks/nginx.js`              | mTLS snippet and panel vhost                       |
| `packages/lamaste-serverd/src/lib/mtls.js`                | Certificate rotation, expiry checks, .p12 download |
| `packages/lamaste-serverd/src/middleware/mtls.js`         | Request-level mTLS verification                    |
| `packages/lamaste-serverd/src/routes/management/certs.js` | Certificate management API endpoints               |

## Quick Reference

### PKI hierarchy

| Certificate                         | Signed by   | Validity | Key size     | Purpose                         |
| ----------------------------------- | ----------- | -------- | ------------ | ------------------------------- |
| CA (`ca.crt`)                       | Self-signed | 10 years | 4096-bit RSA | Trust anchor for nginx          |
| Admin (`client.crt`)                | CA          | 2 years  | 4096-bit RSA | Full panel access (browser)     |
| Agent (`agents/<label>/client.crt`) | CA          | 2 years  | 4096-bit RSA | Capability-based access (agent) |
| Self-signed TLS                     | Self-signed | 10 years | 2048-bit RSA | HTTPS for IP access             |

### File permissions

| File            | Mode  | Owner | Access              |
| --------------- | ----- | ----- | ------------------- |
| `ca.key`        | `600` | root  | CA signing only     |
| `ca.crt`        | `644` | root  | nginx reads this    |
| `client.key`    | `600` | root  | Bundled in .p12     |
| `client.crt`    | `644` | root  | Bundled in .p12     |
| `client.p12`    | `600` | root  | Downloaded by admin |
| `.p12-password` | `600` | root  | Installer summary   |

### nginx directives

| Directive                | Value                               | Effect                                                       |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------ |
| `ssl_client_certificate` | `/etc/lamalibre/lamaste/pki/ca.crt` | CA that signs valid client certs                             |
| `ssl_verify_client`      | `optional`                          | Enable client cert verification (per-location `if` enforces) |
| `error_page 495 496`     | `/cert-help.html`                   | Show help when cert is missing                               |

### OpenSSL commands

```bash
# View CA certificate details
openssl x509 -in /etc/lamalibre/lamaste/pki/ca.crt -text -noout

# View client certificate details
openssl x509 -in /etc/lamalibre/lamaste/pki/client.crt -text -noout

# Check client certificate expiry
openssl x509 -in /etc/lamalibre/lamaste/pki/client.crt -enddate -noout

# Verify client cert is signed by CA
openssl verify -CAfile /etc/lamalibre/lamaste/pki/ca.crt /etc/lamalibre/lamaste/pki/client.crt

# Inspect PKCS12 bundle contents
openssl pkcs12 -in /etc/lamalibre/lamaste/pki/client.p12 -info -nokeys
```

### API endpoints

| Method | Path                                    | Description                          |
| ------ | --------------------------------------- | ------------------------------------ |
| POST   | `/api/certs/mtls/rotate`                | Rotate admin client certificate      |
| GET    | `/api/certs/mtls/download`              | Download current admin `.p12` file   |
| GET    | `/api/certs`                            | List all certificates including mTLS |
| POST   | `/api/certs/agent`                      | Generate agent-scoped certificate    |
| GET    | `/api/certs/agent`                      | List agent certificates              |
| GET    | `/api/certs/agent/:label/download`      | Download agent `.p12` file           |
| PATCH  | `/api/certs/agent/:label/capabilities`  | Update agent capabilities            |
| PATCH  | `/api/certs/agent/:label/allowed-sites` | Update agent site access             |
| DELETE | `/api/certs/agent/:label`               | Revoke agent certificate             |

### Related documentation

- [Authentication](authentication.md) — how tunneled apps use Authelia TOTP (separate from mTLS)
- [Certificates](certificates.md) — Let's Encrypt certificates for domains
- [Security Model](security-model.md) — mTLS as part of the defense-in-depth strategy
- [nginx Reverse Proxy](nginx-reverse-proxy.md) — how nginx enforces mTLS
