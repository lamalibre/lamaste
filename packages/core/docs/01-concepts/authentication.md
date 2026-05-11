# Authentication

> Lamaste uses two separate authentication systems: mTLS client certificates for admin access, and Authelia TOTP two-factor authentication for end-user access to tunneled apps.

## In Plain English

Lamaste protects two different things, and each uses a different type of lock.

The **admin panel** is protected by a client certificate — like a digital ID card that your browser presents automatically. Only you, the server operator, have this ID card. No username, no password, no login page. This is [mTLS](mtls.md).

The **tunneled apps** (the web apps you expose to the internet) are protected by a separate system called Authelia. When a visitor tries to access your app, they see a login page where they enter a username, password, and a 6-digit code from an authenticator app on their phone (like Google Authenticator or Authy). This is TOTP two-factor authentication — something you know (password) plus something you have (your phone).

Think of it this way: the admin panel is your house's back door, opened only by a fingerprint scanner (the certificate). The tunneled apps are the front door, opened by a key and an alarm code (password plus TOTP).

These two systems are completely independent. Admin certificate holders do not automatically get access to tunneled apps, and Authelia users cannot access the admin panel.

There is also an **optional built-in 2FA layer** for the admin panel itself. When enabled, the admin must present their client certificate _and_ enter a TOTP code to access the panel. This adds a second factor on top of mTLS, protecting against scenarios where the certificate file is compromised. Agents are exempt from this requirement — they authenticate with mTLS only.

## For Users

### Who uses what

| Person          | Accesses                                | Authentication method                          |
| --------------- | --------------------------------------- | ---------------------------------------------- |
| You (the admin) | Management panel at `https://<IP>:9292` | Client certificate (mTLS), optionally + TOTP   |
| Your users      | Tunneled apps at `myapp.example.com`    | Username + password + TOTP code                |
| Agents          | Panel API                               | Client certificate (mTLS) — 2FA does not apply |

### Managing users

From the Users page in the management panel, you can:

- **Create users** — set a username, display name, email, and password
- **Delete users** — remove a user (you cannot delete the last user)
- **Reset TOTP** — generate a new TOTP secret if a user loses their authenticator (separate step via `POST /api/users/:username/reset-totp`)
- **Update password** — change a user's password

### Creating a user

1. Navigate to the Users page in the management panel
2. Click "Add User"
3. Enter a username, display name, email, and password
4. Lamaste creates the user in `users.yml` and restarts Authelia
5. Share the credentials with the user — they enroll in TOTP on first login

### TOTP enrollment flow

TOTP enrollment is a separate step from user creation. There are two paths:

**First-login enrollment:** When a new user visits a Lamaste-protected app for the first time, Authelia presents a QR code during their initial login. The user scans it with their authenticator app to complete enrollment.

**Admin-initiated reset:** If a user loses their authenticator, the admin clicks "Reset TOTP" on the Users page, which calls `POST /api/users/:username/reset-totp`. This writes the new TOTP secret to Authelia's SQLite database via the `authelia storage user totp generate` CLI command. A QR code is displayed for the user to scan.

```
Admin creates user → User visits protected app
                   → Authelia prompts for TOTP enrollment on first login
                   → User scans QR code with authenticator app
                   → Authenticator generates 6-digit codes every 30 seconds
```

The QR code encodes a standard `otpauth://` URI:

```
otpauth://totp/Lamaste:username?secret=BASE32SECRET&issuer=Lamaste&algorithm=SHA1&digits=6&period=30
```

### How a user logs in

When a visitor browses to a tunneled app (e.g., `https://myapp.example.com`), nginx checks if they are authenticated via Authelia. If not:

1. They are redirected to `https://auth.example.com` — the Authelia login portal
2. They enter their username and password
3. They enter the current 6-digit TOTP code from their authenticator app
4. Authelia sets a session cookie and redirects them back to the app
5. On subsequent visits (within the session), they are not prompted again

Session duration is 12 hours, with a 2-hour inactivity timeout. After that, the user must authenticate again.

### What happens when a user loses their authenticator

If a user loses their phone or uninstalls their authenticator app, you (the admin) can reset their TOTP from the Users page. This generates a new TOTP secret and displays a new QR code for them to scan.

### Optional panel 2FA (admin only)

You can enable a built-in TOTP 2FA layer for admin panel access. This is separate from Authelia (which protects tunneled apps) and adds a second factor on top of the mTLS client certificate.

**How it works:**

1. Enable 2FA from the panel settings. A QR code is displayed for your authenticator app.
2. On subsequent visits, after mTLS succeeds, a TOTP prompt appears. Enter the 6-digit code to proceed.
3. A session cookie (`lamaste_2fa_session`) is set with a 12-hour absolute expiry and a 2-hour inactivity timeout. The cookie is HMAC-SHA256 signed using a `sessionSecret` stored in `panel.json`, and is marked `HttpOnly`, `Secure`, and `SameSite=Strict`.

**Important behavior changes when 2FA is enabled:**

- The IP-based vhost (`https://<IP>:9292`) is **disabled**. Panel access is domain-only. This prevents session cookies from being scoped to an IP address.
- Rate limiting applies: 5 failed TOTP attempts within 2 minutes trigger a 5-minute ban.
- Agents are **not affected** — they authenticate via mTLS only and bypass the 2FA check entirely.

**TOTP parameters:** RFC 6238, SHA-1, 30-second period, 6 digits, +/-1 step clock drift tolerance, replay protection (each code can only be used once).

**Configuration:** Panel 2FA state is stored in `panel.json` under `panel2fa: { enabled, secret, setupComplete }`. The session signing key is stored as `sessionSecret` in the same file, generated with `crypto.randomBytes` on first 2FA setup.

**Recovery:** If you lose your authenticator, run `sudo lamaste-reset-admin` on the server. This clears 2FA, re-enables the IP-based vhost, and reverts to standard mTLS-only admin access. See [Disaster Recovery](../02-guides/disaster-recovery.md) for details.

## For Developers

### Authelia overview

[Authelia](https://www.authelia.com/) is an open-source authentication and authorization server written in Go. Lamaste uses it specifically for TOTP two-factor authentication via the nginx forward-auth pattern.

Authelia runs as a systemd service on the VPS, binding to `127.0.0.1:9091`. It is never exposed directly to the internet — nginx proxies `auth.example.com` to it.

### Why Authelia

Several factors led to choosing Authelia:

- **Single binary** — no runtime dependencies, simple deployment
- **Low memory** — ~25MB RAM at idle, fitting the 512MB budget
- **File-based users** — reads `users.yml` directly, no database required
- **TOTP built-in** — native support for time-based one-time passwords
- **nginx forward-auth** — designed for the `auth_request` integration pattern
- **bcrypt support** — critical for the RAM constraint (see below)

### bcrypt vs argon2id — the RAM constraint

Authelia supports both bcrypt and argon2id for password hashing. Lamaste **must** use bcrypt.

Argon2id is generally considered the stronger algorithm, but it is memory-hard by design. Each hash operation allocates ~93MB of RAM. On a 512MB droplet running multiple services, a single authentication attempt with argon2id can trigger the Linux OOM killer, crashing the entire server.

Bcrypt uses minimal memory (~4KB per hash) and is configured with cost factor 12, which provides strong resistance to brute-force attacks without memory pressure:

```yaml
# From Authelia configuration
authentication_backend:
  file:
    path: /etc/authelia/users.yml
    password:
      algorithm: bcrypt
      bcrypt:
        cost: 12
```

### Authelia configuration

The full configuration is written during onboarding provisioning (`packages/lamaste-serverd/src/lib/authelia.js`):

```yaml
server:
  address: 'tcp://127.0.0.1:9091/'

log:
  level: info
  file_path: /var/log/authelia/authelia.log

identity_validation:
  reset_password:
    jwt_secret: <random-64-byte-hex>

authentication_backend:
  file:
    path: /etc/authelia/users.yml
    password:
      algorithm: bcrypt
      bcrypt:
        cost: 12

access_control:
  default_policy: two_factor

session:
  name: lamaste_session
  secret: <random-64-byte-hex>
  cookies:
    - domain: example.com
      authelia_url: https://auth.example.com
      default_redirection_url: https://example.com
  expiration: 12h
  inactivity: 2h

regulation:
  max_retries: 5
  find_time: 2m
  ban_time: 5m

storage:
  encryption_key: <random-64-byte-hex>
  local:
    path: /etc/authelia/db.sqlite3

notifier:
  filesystem:
    filename: /etc/authelia/notifications.txt

totp:
  issuer: Lamaste
  period: 30
  digits: 6
```

Key configuration choices:

- **`server.address: 'tcp://127.0.0.1:9091/'`** — binds to localhost only; nginx handles public access
- **`default_policy: two_factor`** — requires password + TOTP for all authenticated users
- **`session.cookies`** — array format (Authelia v4.38+) specifying the domain and Authelia URL for session cookies
- **`notifier.filesystem`** — writes notifications to a file instead of sending email (suitable for small-scale use)
- **`totp.period: 30`** — standard 30-second TOTP window

### Users file format

Authelia reads user data from `/etc/authelia/users.yml`:

```yaml
users:
  alice:
    displayname: alice
    password: $2b$12$xxxxx... # bcrypt hash
    email: alice@lamaste.local
    groups:
      - admins
```

Lamaste manages this file through the panel server API. All writes are atomic: content is written to a temporary file first, then moved into place. This prevents Authelia from reading a partially written file.

After every write to `users.yml`, the panel server reloads Authelia via `systemctl restart authelia` so the changes take effect.

### Creating users programmatically

The panel server creates users by hashing the password with bcrypt and writing to `users.yml`:

```javascript
// From packages/lamaste-serverd/src/lib/authelia.js
export async function createUser(username, password) {
  // Hash password using bcrypt with cost factor 12
  const hash = await bcrypt.hash(password, 12);

  // Read existing users or start fresh
  let usersData = { users: {} };
  try {
    const { stdout } = await execa('sudo', ['cat', AUTHELIA_USERS]);
    const parsed = yaml.load(stdout);
    if (parsed && parsed.users) usersData = parsed;
  } catch {
    // File doesn't exist — start fresh
  }

  usersData.users[username] = {
    displayname: username,
    password: hash,
    email: `${username}@lamaste.local`,
    groups: ['admins'],
  };

  await writeUsers(usersData);
  return { username, created: true };
}
```

### TOTP secret generation

TOTP secrets are generated using `crypto.randomBytes` and encoded as base32:

```javascript
// From packages/lamaste-serverd/src/lib/authelia.js
export function generateTotpSecret(username, opts) {
  const issuer = opts?.issuer ?? 'Lamaste';
  const secretBytes = crypto.randomBytes(20);
  const secret = base32Encode(secretBytes);
  const uri =
    `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?` +
    `secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri };
}
```

This function is also reused by the panel 2FA feature (`lib/totp.js`) with `{ issuer: 'Lamaste Panel' }` to generate a distinct TOTP entry for admin panel access.

The `otpauth://` URI follows the [Google Authenticator Key URI format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format). This URI is rendered as a QR code in the panel client.

### nginx forward-auth pattern

The forward-auth pattern is how nginx delegates authentication decisions to Authelia. For each request to a protected app, nginx sends a sub-request to Authelia asking "is this user authenticated?"

Here is the nginx configuration for a protected app vhost:

```nginx
# Internal location — subrequest to Authelia
location /authelia {
    internal;
    proxy_pass http://127.0.0.1:9091/api/verify?rd=https://auth.example.com/;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
    proxy_set_header X-Forwarded-Method $request_method;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $http_host;
    proxy_set_header X-Forwarded-Uri $request_uri;
    proxy_set_header X-Forwarded-For $remote_addr;
}

# Main location — protected by auth_request
location / {
    auth_request /authelia;
    auth_request_set $user $upstream_http_remote_user;
    auth_request_set $groups $upstream_http_remote_groups;
    auth_request_set $name $upstream_http_remote_name;
    auth_request_set $email $upstream_http_remote_email;

    proxy_set_header Remote-User $user;
    proxy_set_header Remote-Groups $groups;
    proxy_set_header Remote-Name $name;
    proxy_set_header Remote-Email $email;

    proxy_pass http://127.0.0.1:PORT;
}

# Unauthenticated users are redirected to Authelia
error_page 401 =302 https://auth.example.com/?rd=$scheme://$http_host$request_uri;
```

The flow works like this:

```
1. Visitor requests myapp.example.com
2. nginx sends subrequest to Authelia's /api/verify endpoint
3. Authelia checks for a valid session cookie:
   a. Cookie present and valid → returns 200 with user headers
   b. No cookie or expired → returns 401
4. If 200: nginx proxies to the app with Remote-User/Groups/Name/Email headers
5. If 401: nginx redirects to auth.example.com with the original URL as ?rd= parameter
6. User authenticates on Authelia portal
7. Authelia sets session cookie and redirects back to the original URL
8. On the redirect, step 3a succeeds and the user sees the app
```

### User headers

When authentication succeeds, Authelia returns user information in response headers. nginx captures these with `auth_request_set` and forwards them to the proxied app:

| Header          | Content                | Example               |
| --------------- | ---------------------- | --------------------- |
| `Remote-User`   | Username               | `alice`               |
| `Remote-Groups` | Comma-separated groups | `admins`              |
| `Remote-Name`   | Display name           | `alice`               |
| `Remote-Email`  | Email address          | `alice@lamaste.local` |

Your tunneled app can read these headers to identify the authenticated user without implementing its own authentication.

### Atomic YAML writes

The `users.yml` file is read live by Authelia. To prevent Authelia from reading a partially written file, writes use atomic operations:

```javascript
export async function writeUsers(usersData) {
  const yamlContent = yaml.dump(usersData, { lineWidth: -1 });
  // sudoWriteFile: writes to a temp file, then mv into place
  await sudoWriteFile(AUTHELIA_USERS, yamlContent, '600');
}
```

The `sudoWriteFile` helper writes to a random temp file in `/tmp/`, then uses `sudo mv` to atomically replace the target. Since `mv` on the same filesystem is atomic at the kernel level, Authelia never sees a half-written file.

### Secrets management

Authelia requires three secrets, all generated with `crypto.randomBytes`:

| Secret                 | Purpose                  | Storage                           |
| ---------------------- | ------------------------ | --------------------------------- |
| `jwtSecret`            | Signs JWT tokens         | `/etc/authelia/configuration.yml` |
| `sessionSecret`        | Encrypts session cookies | `/etc/authelia/configuration.yml` |
| `storageEncryptionKey` | Encrypts SQLite database | `/etc/authelia/configuration.yml` |

A copy is also stored in `/etc/authelia/.secrets.json` (mode `600`) for reference. The configuration file itself is mode `600` to prevent unauthorized reading of these secrets.

### Safety rule: never delete the last user

The panel server API prevents deleting the last Authelia user. If only one user exists and you try to delete them, the API returns an error. This prevents a lockout scenario where no one can authenticate to reach the tunneled apps.

### Source files

| File                                                         | Purpose                                              |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| `packages/lamaste-serverd/src/lib/authelia.js`               | Install, configure, user CRUD, TOTP generation       |
| `packages/lamaste-serverd/src/routes/management/users.js`    | User management API endpoints                        |
| `packages/lamaste-serverd/src/lib/nginx.js`                  | App vhost with Authelia forward-auth block           |
| `packages/lamaste-serverd/src/lib/certbot.js`                | TLS cert for `auth.example.com` subdomain            |
| `packages/lamaste-serverd/src/lib/totp.js`                   | Panel 2FA TOTP verification and replay protection    |
| `packages/lamaste-serverd/src/lib/session.js`                | HMAC-SHA256 session cookie signing and validation    |
| `packages/lamaste-serverd/src/middleware/twofa-session.js`   | Fastify plugin enforcing 2FA session for admin certs |
| `packages/lamaste-serverd/src/routes/management/settings.js` | Panel 2FA setup, verify, and disable endpoints       |

## Quick Reference

### Two authentication systems

| System    | Protects      | Method                           | Session                                             |
| --------- | ------------- | -------------------------------- | --------------------------------------------------- |
| mTLS      | Admin panel   | Client certificate               | Permanent (cert-based)                              |
| Panel 2FA | Admin panel   | mTLS + TOTP (opt-in, admin only) | 12h absolute, 2h inactivity (`lamaste_2fa_session`) |
| Authelia  | Tunneled apps | Password + TOTP                  | 12h expiry, 2h inactivity                           |

### Authelia service

| Property     | Value                             |
| ------------ | --------------------------------- |
| Binary       | `/usr/local/bin/authelia`         |
| Config       | `/etc/authelia/configuration.yml` |
| Users        | `/etc/authelia/users.yml`         |
| Database     | `/etc/authelia/db.sqlite3`        |
| Log          | `/var/log/authelia/authelia.log`  |
| Listen       | `127.0.0.1:9091`                  |
| Systemd unit | `authelia.service`                |
| RAM usage    | ~25MB                             |

### TOTP parameters

| Parameter     | Value               |
| ------------- | ------------------- |
| Algorithm     | SHA-1               |
| Digits        | 6                   |
| Period        | 30 seconds          |
| Issuer        | `Lamaste`           |
| Secret length | 20 bytes (160 bits) |
| Encoding      | Base32              |

### Systemd commands

```bash
# Check Authelia status
systemctl status authelia

# View recent logs
journalctl -u authelia -n 50 --no-pager

# Restart after users.yml changes
sudo systemctl restart authelia
```

### API endpoints

| Method | Path                              | Description                                                 |
| ------ | --------------------------------- | ----------------------------------------------------------- |
| GET    | `/api/users`                      | List all users (without password hashes)                    |
| POST   | `/api/users`                      | Create user with username, displayname, email, and password |
| PUT    | `/api/users/:username`            | Update user password or display name                        |
| DELETE | `/api/users/:username`            | Delete user (not the last one)                              |
| POST   | `/api/users/:username/reset-totp` | Generate new TOTP secret                                    |

### Password hashing

| Property         | Value                                   |
| ---------------- | --------------------------------------- |
| Algorithm        | bcrypt                                  |
| Cost factor      | 12                                      |
| Memory per hash  | ~4KB                                    |
| Why not argon2id | ~93MB per hash, causes OOM on 512MB VPS |

### Related documentation

- [mTLS](mtls.md) — client certificate authentication for the admin panel
- [nginx Reverse Proxy](nginx-reverse-proxy.md) — forward-auth configuration details
- [Security Model](security-model.md) — authentication as part of defense-in-depth
- [Tunneling](tunneling.md) — how tunneled apps reach the internet
