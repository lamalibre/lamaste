# DNS and Domains

> Lamaste uses DNS to map human-readable domain names to your VPS IP address, routing visitors to the right tunneled app through subdomain-based virtual hosts.

## In Plain English

Every website has an address. When you type `example.com` into your browser, your computer asks a DNS server "what is the IP address for example.com?" The DNS server responds with something like `203.0.113.42`, and your browser connects to that IP.

Lamaste uses this system to make your tunneled apps accessible at friendly URLs. Instead of telling people "go to 203.0.113.42 port 3000," you tell them "go to myapp.example.com." Behind the scenes, DNS translates `myapp.example.com` to your VPS's IP address, and nginx on the VPS routes the request to the right app.

Think of DNS like a phone directory. The domain name is the person's name, and the IP address is their phone number. Lamaste uses subdomains like departments within a company — `panel.example.com` is the admin office, `auth.example.com` is security, and `myapp.example.com` is the department where your app lives.

## For Users

### What you need

To use Lamaste with a domain, you need:

1. **A domain name** — purchased from any registrar (Namecheap, Cloudflare, GoDaddy, etc.)
2. **Access to DNS settings** — ability to create A records in your registrar's DNS panel
3. **A VPS with a public IP** — your DigitalOcean droplet (e.g., `203.0.113.42`)

### DNS records you create

During the onboarding wizard, Lamaste tells you exactly which DNS records to create. You need A records pointing several subdomains to your VPS IP:

| Type | Name                 | Value          | Purpose                     |
| ---- | -------------------- | -------------- | --------------------------- |
| A    | `panel.example.com`  | `203.0.113.42` | Admin panel (domain access) |
| A    | `auth.example.com`   | `203.0.113.42` | Authelia login portal       |
| A    | `tunnel.example.com` | `203.0.113.42` | Chisel WebSocket endpoint   |

When you create tunnels later, you add one more A record per app:

| Type | Name                | Value          | Purpose               |
| ---- | ------------------- | -------------- | --------------------- |
| A    | `myapp.example.com` | `203.0.113.42` | Your tunneled web app |

All records point to the same IP address. nginx on the VPS looks at the domain name in the request and routes it to the correct internal service.

### The onboarding DNS flow

1. You enter your domain and email in the onboarding wizard
2. Lamaste displays the DNS records you need to create
3. You go to your DNS provider and create the A records
4. You click "Verify DNS" in the wizard
5. Lamaste checks that each subdomain resolves to your VPS IP
6. Once verified, onboarding proceeds to provision the stack

### DNS propagation

After creating DNS records, they do not take effect instantly. DNS propagation — the time it takes for the new records to spread across the internet — can take anywhere from a few minutes to 48 hours, though most registrars propagate within 5-15 minutes.

If the "Verify DNS" step fails, wait a few minutes and try again. You can also check propagation status using online tools like [dnschecker.org](https://dnschecker.org).

### IP access always works

Even without a domain, the admin panel is always reachable at `https://<ip>:9292`. This IP-based access:

- Uses a self-signed certificate (browser shows a warning)
- Requires the [mTLS client certificate](mtls.md)
- Does not depend on DNS or Let's Encrypt
- Serves as your emergency backdoor

If your domain's DNS is misconfigured, your registrar is having issues, or your Let's Encrypt certificates expire, you can still reach the admin panel through the IP address.

### Adding tunnels later

When you create a new tunnel from the management panel, you need to add a DNS A record for the new subdomain. The tunnel creation process tells you the record to create:

```
Create DNS A record:
  Name:  myapp.example.com
  Value: 203.0.113.42
```

Lamaste then issues a Let's Encrypt certificate for the subdomain (which requires DNS to be pointing correctly) and creates an nginx vhost.

### Using a DNS provider with an API

Some DNS providers (Cloudflare, DigitalOcean DNS, Route 53) offer APIs that could automate DNS record creation. Lamaste currently requires manual DNS record creation, but the architecture supports adding API-based automation in the future.

### Wildcard considerations

If you manage many subdomains, creating individual A records for each one is tedious. An alternative is to create a single wildcard A record:

| Type | Name            | Value          |
| ---- | --------------- | -------------- |
| A    | `*.example.com` | `203.0.113.42` |

This routes all subdomains to your VPS. nginx then handles routing based on the `server_name` directive in each vhost.

The trade-off: a wildcard A record means _any_ subdomain resolves to your VPS, including ones you have not configured. Requests to unconfigured subdomains get nginx's default behavior (usually a connection refused or a wrong vhost response). This is a minor concern for most setups.

Wildcard A records work with individual Let's Encrypt certificates (HTTP-01 challenge). Wildcard _TLS certificates_ require DNS-01 challenges, which Lamaste does not currently automate.

## For Developers

### DNS verification

During onboarding, the panel server verifies DNS records by performing a DNS lookup for each required subdomain and comparing the result to the VPS's own IP address.

The verification checks three core subdomains:

```
panel.example.com  → must resolve to VPS IP
auth.example.com   → must resolve to VPS IP
tunnel.example.com → must resolve to VPS IP
```

The verification endpoint is `POST /api/onboarding/verify-dns`. It performs DNS resolution and returns the status of each record.

### Why subdomains, not paths

Lamaste routes traffic by subdomain (e.g., `myapp.example.com`) rather than by URL path (e.g., `example.com/myapp`). This is a deliberate design choice:

1. **Isolation** — each app has its own TLS certificate, session cookies, and security context
2. **WebSocket compatibility** — some apps assume they are at the root path and break when nested
3. **Authelia sessions** — cookie scope is per-subdomain, preventing cross-app session leakage
4. **nginx simplicity** — one vhost per app is cleaner than complex location blocks with path rewriting

### Subdomain naming

When creating a tunnel, the subdomain must follow DNS naming rules:

- Lowercase letters, digits, and hyphens only
- Cannot start or end with a hyphen
- Maximum 63 characters
- Must be unique (no two tunnels can use the same subdomain)

Reserved subdomains that cannot be used for tunnels or static sites:

| Subdomain | Reason                       |
| --------- | ---------------------------- |
| `panel`   | Admin panel                  |
| `auth`    | Authelia portal              |
| `tunnel`  | Chisel WebSocket endpoint    |
| `www`     | Conventionally the main site |
| `mail`    | Email subdomain              |
| `ftp`     | File transfer subdomain      |
| `api`     | API subdomain                |

### DNS and TLS certificate issuance

Let's Encrypt uses the HTTP-01 challenge to verify domain ownership. The process requires that:

1. The domain resolves to the VPS IP (DNS A record exists and has propagated)
2. nginx is running and can serve the challenge file on port 80 or via the nginx plugin
3. No firewall blocks the Let's Encrypt validation servers

If DNS is not pointing to the VPS, certbot fails with an error like:

```
DNS problem: NXDOMAIN looking up A for myapp.example.com
```

The panel server's certbot integration detects this specific error and returns a clear message telling the user to check their DNS configuration.

### Core subdomains

During onboarding provisioning, Lamaste creates vhosts and issues certificates for three core subdomains:

```javascript
// From packages/lamaste-serverd/src/lib/certbot.js
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

Each certificate is issued sequentially because Let's Encrypt rate limits apply per domain. Issuing them in parallel could trigger rate limit errors.

### Per-tunnel certificates

When a tunnel is created, Lamaste issues a certificate for the tunnel's subdomain. The `issueTunnelCert` function checks for existing coverage first:

```
1. Does a wildcard cert (*.example.com) already cover this FQDN?
   → If yes, skip issuance and use the wildcard cert path
2. Does an individual cert already exist and is it valid?
   → If yes, skip issuance
3. Neither exists → issue a new cert via certbot
```

This logic lives in `packages/lamaste-serverd/src/lib/certbot.js` and prevents unnecessary certificate issuance that could hit Let's Encrypt rate limits.

### Wildcard certificate detection

The panel server checks for wildcard certificates when determining the cert path for a new tunnel:

```javascript
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

export async function getCertPath(fqdn, domain) {
  if (await hasWildcardCert(domain)) {
    return `/etc/letsencrypt/live/${domain}/`;
  }
  return `/etc/letsencrypt/live/${fqdn}/`;
}
```

If a wildcard certificate exists, all new tunnel vhosts use that certificate's path instead of requesting individual certificates.

### Domain storage

The domain and email are stored in the panel configuration file at `/etc/lamalibre/lamaste/panel.json`:

```json
{
  "ip": "203.0.113.42",
  "domain": "example.com",
  "email": "admin@example.com",
  "dataDir": "/etc/lamalibre/lamaste",
  "onboarding": { "status": "COMPLETED" }
}
```

Once set during onboarding, the domain is used throughout the system for constructing FQDNs, certificate paths, and nginx vhost configurations.

### Source files

| File                                                    | Purpose                                      |
| ------------------------------------------------------- | -------------------------------------------- |
| `packages/lamaste-serverd/src/routes/onboarding/domain.js` | Domain + email submission endpoint           |
| `packages/lamaste-serverd/src/routes/onboarding/dns.js`    | DNS verification endpoint                    |
| `packages/lamaste-serverd/src/lib/certbot.js`              | Certificate issuance per subdomain           |
| `packages/lamaste-serverd/src/lib/nginx.js`                | Vhost creation with domain-based server_name |
| `packages/lamaste-serverd/src/lib/state.js`                | Domain storage in panel.json                 |

## Quick Reference

### Required DNS records (onboarding)

| Type | Name                 | Value  |
| ---- | -------------------- | ------ |
| A    | `panel.example.com`  | VPS IP |
| A    | `auth.example.com`   | VPS IP |
| A    | `tunnel.example.com` | VPS IP |

### Per-tunnel DNS record

| Type | Name                      | Value  |
| ---- | ------------------------- | ------ |
| A    | `<subdomain>.example.com` | VPS IP |

### Optional wildcard record

| Type | Name            | Value  |
| ---- | --------------- | ------ |
| A    | `*.example.com` | VPS IP |

### Reserved subdomains

| Subdomain | Used by                      |
| --------- | ---------------------------- |
| `panel`   | Admin panel                  |
| `auth`    | Authelia login portal        |
| `tunnel`  | Chisel WebSocket endpoint    |
| `www`     | Conventionally the main site |
| `mail`    | Email subdomain              |
| `ftp`     | File transfer subdomain      |
| `api`     | API subdomain                |

### Subdomain naming rules

| Rule                               | Example                  |
| ---------------------------------- | ------------------------ |
| Lowercase letters, digits, hyphens | `my-app-v2`              |
| Cannot start/end with hyphen       | `my-app` (not `-my-app`) |
| Max 63 characters                  | Standard DNS label limit |
| Must be unique                     | No duplicate subdomains  |

### DNS verification checklist

```bash
# Check if a subdomain resolves correctly
dig +short panel.example.com
# Expected output: 203.0.113.42

# Check all core subdomains
for sub in panel auth tunnel; do
  echo "$sub.example.com → $(dig +short $sub.example.com)"
done

# Check from a public DNS (bypass local cache)
dig @8.8.8.8 +short panel.example.com
```

### Let's Encrypt rate limits

| Limit                              | Value                               |
| ---------------------------------- | ----------------------------------- |
| Certificates per registered domain | 50 per week                         |
| Duplicate certificates             | 5 per week                          |
| Failed validations                 | 5 per hour per account per hostname |
| New orders                         | 300 per 3 hours                     |

### Related documentation

- [Certificates](certificates.md) — Let's Encrypt certificate issuance and renewal
- [nginx Reverse Proxy](nginx-reverse-proxy.md) — how vhosts route traffic by subdomain
- [Tunneling](tunneling.md) — how tunnels map subdomains to local ports
- [Security Model](security-model.md) — DNS as part of the access chain
