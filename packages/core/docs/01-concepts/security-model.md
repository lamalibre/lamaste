# Security Model

> Lamaste uses a defense-in-depth strategy with multiple independent security layers — OS hardening, firewall, TLS encryption, mTLS authentication, TOTP 2FA, and service isolation — so that no single vulnerability compromises the system.

## In Plain English

Security in Lamaste works like layers of protection around a castle. Each layer is independent, so even if an attacker gets past one, they face another.

The outermost layer is the **firewall** — only four doors exist (ports 22, 80, 443, and 9292), and all others are sealed shut. The next layer is **encryption** — every conversation is in a secret language (TLS). Then comes **authentication** — the admin panel checks your digital ID card (client certificate), and the tunneled apps check your password and phone code (TOTP). The innermost layer is **isolation** — each service runs in its own room, and even if one is compromised, it cannot reach the others.

No single layer is perfect. Firewalls can be misconfigured. TLS has had vulnerabilities. Passwords get stolen. But the chance of all layers failing simultaneously is vanishingly small. This approach — multiple imperfect layers that together provide strong security — is called defense in depth.

## For Users

### What protects you

Here is every security measure Lamaste puts in place, from the outside in:

#### 1. Firewall (UFW)

Only four ports are open on your VPS:

| Port     | Service | Who needs it                                                       |
| -------- | ------- | ------------------------------------------------------------------ |
| 22/tcp   | SSH     | You, during installation only                                      |
| 80/tcp   | HTTP    | Let's Encrypt HTTP-01 challenge (certificate issuance and renewal) |
| 443/tcp  | HTTPS   | Everyone (domains)                                                 |
| 9292/tcp | HTTPS   | You (admin panel via IP; disabled when panel 2FA is enabled)       |

Every other port is blocked. A port scan of your VPS shows only these four services.

#### 2. fail2ban

An automated intrusion prevention system that watches log files for suspicious activity:

- **SSH jail** — bans an IP for 1 hour after 5 failed login attempts
- **nginx jail** — bans an IP for 1 hour after 5 failed HTTP authentication attempts

Banning means adding a firewall rule that drops all packets from the offending IP.

#### 3. SSH hardening

After installation, SSH is locked down:

| Setting                           | Value               | Effect                          |
| --------------------------------- | ------------------- | ------------------------------- |
| `PasswordAuthentication`          | `no`                | Only key-based auth accepted    |
| `PermitRootLogin`                 | `prohibit-password` | Root can log in with keys only  |
| `ChallengeResponseAuthentication` | `no`                | No keyboard-interactive prompts |

This means SSH brute-force attacks (trying passwords) are impossible. An attacker would need your private SSH key.

#### 4. TLS encryption

Every connection to your VPS is encrypted with TLS 1.2 or 1.3. Even if someone intercepts the traffic (e.g., on a public Wi-Fi network), they cannot read or modify it.

- Domain-based vhosts use Let's Encrypt certificates (trusted by all browsers)
- The IP-based admin panel uses a self-signed certificate (browser warning, but still encrypted)

#### 5. mTLS for admin and agent access

The admin panel requires a client certificate at the TLS layer. Without the certificate, nginx rejects the connection before any HTTP traffic is exchanged. See [mTLS](mtls.md) for full details.

**Agent-side TLS verification:** The agent verifies both servers it talks to. The panel uses a self-signed TLS server certificate that is separate from the mTLS CA used to sign client certificates, so `lamaste-agent setup` pins the panel's public key on first contact (trust on first use) and every later panel call rejects any other key; `lamaste-agent panel reset-pin` re-captures it after a deliberate rotation. The tunnel relay, `tunnel.<domain>`, has a publicly trusted Let's Encrypt certificate that the agent's Chisel client verifies normally (see 5a below).

**Admin clients verify the panel too.** Whatever an admin client sends — the registry token, plugin settings, a TOTP code, a new user's password, storage keys, the 2FA session cookie — only ever reaches a server that proved it is the panel, and none of them falls back to skipping verification:

- **`lamaste-server`** (root, on the relay) reaches the panel through nginx's IP vhost on loopback port 9292. That port is not privileged: whenever nginx does not hold it — panel 2FA switches the IP vhost off, nginx is stopped — any local user could listen there. So the CLI refuses before connecting when panel 2FA is on or the IP vhost is not enabled, and every request verifies the listener against the vhost's own certificate, read from disk as root (`/etc/lamalibre/lamaste/pki/self-signed.pem`; curl `--cacert` with the address the certificate names, connected to `127.0.0.1`; no `.curlrc`, no proxy). It offers TLS 1.2 forward-secret suites only, so an impostor — even one presenting the public certificate — fails the handshake before the CLI presents the admin client certificate, let alone a request. With panel 2FA on, the panel-backed commands (tunnels, sites, plugins, registry credential, push install, audit, chisel) are unavailable: use the panel in the browser, or turn 2FA off.
- **The desktop app** verifies a panel reached at its domain (`https://panel.<domain>`) by its publicly trusted certificate. A panel reached at its IP address presents the self-signed certificate, so the app pins its public key per server, the same pin agents keep: read from the server over SSH when the app provisioned or recovered it, reported by the installer (or read from the certificate file) for a local install, otherwise taken from the first connection (trust on first use). The pin is stored with the server (`panelServerPubkeySha256` in `servers.json`) and shown on its card on the Servers page; only an explicit **Re-pin** there replaces it, after the app has shown the key the panel presents now. Every call — admin calls, health checks, the panel update, the hardware-bound upgrade — carries the pin (`--pinnedpubkey`); a different key aborts the connection before anything is sent. Agent calls use the pin the agent captured at enrollment.
- **`create-lamaste-admin`** (the hardware-bound upgrade) installs the CA the panel answers with as trusted in the login keychain, so it verifies the panel the same way: the desktop passes the server's pin; run by hand against an IP address, it shows the key the panel presents before the operator confirms.

`sudo lamaste-server panel-pin` prints the pin of the panel's IP certificate on the relay — compare it with what an agent (`lamaste-agent panel reset-pin`) or the desktop app shows to know they pinned the panel and not something in between.

**P12 password security:** The agent never passes the P12 password as a command-line argument. Curl calls use a temporary config file (created with mode `0600`, deleted after use), and openssl calls use the `LAMALIBRE_LAMASTE_P12_PASS` environment variable. This prevents the password from being visible in process listings (`ps aux`).

**Request bodies and session cookies:** A request body that carries a credential — the enrollment token, the registry token, a TOTP code, a user's password, storage keys — is never a curl argument either. `lamaste-agent setup` (enrollment), `lamaste-server` and the desktop app hand curl the body on stdin (`--data-binary @-`). `lamaste-server` runs as root, so its config file for the P12 password is created exclusively (`O_EXCL`, `0600`) in a private `mkdtemp` directory (`0700`) that is removed on every path. The desktop app keeps the panel's 2FA session cookie in its private `0600` config file next to the certificate password, and sends its calls to the local agent daemon with the Bearer token and the body in one curl config on stdin (`-K -`).

**Hardware-bound certificates:** Agents can enroll using a one-time token and a locally generated CSR, binding the private key to the macOS Keychain so it is non-extractable. The public `POST /api/enroll` endpoint uses the token as its sole authentication gate — no mTLS is required for enrollment itself, since the agent does not yet have a certificate. After enrollment, the agent authenticates with the Keychain-backed identity just like any other mTLS client. Admins can optionally upgrade their own authentication to hardware-bound mode (set `adminAuthMode` to `"hardware-bound"` in `panel.json`), which disables P12 download and certificate rotation through the panel UI. If the admin Keychain identity is lost, recovery is possible by running `lamaste-reset-admin` on the server, which reverts to standard P12 authentication.

Lamaste supports three types of certificates with different access levels:

- **Admin certificate** (`CN=admin`) — full access to all panel endpoints (for browser-based management)
- **Agent certificate** (`CN=agent:<label>`) — capability-based access (for tunnel agents on macOS and Linux)
- **Plugin-agent certificate** (`CN=plugin-agent:<delegator>:<name>`) — minimal identity for plugin agents participating in the ticket system, created via delegated enrollment

Agent certificates are generated from the panel UI and should be used instead of the admin certificate when connecting agents. Plugin-agent certificates are created when an existing agent delegates enrollment for a plugin's agents (e.g., a Sync server vouching for its Sync agents). Each agent is assigned granular capabilities that control what it can access:

| Capability       | Grants                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------- |
| `tunnels:read`   | List the agent's own tunnels and fetch its Chisel config (always-on)                   |
| `tunnels:write`  | Create, update and delete tunnels the agent carries (restricted access mode only)      |
| `services:read`  | View service status                                                                    |
| `services:write` | Start/stop/restart services                                                            |
| `system:read`    | View system stats (CPU, RAM, disk)                                                     |
| `sites:read`     | List assigned sites and browse their files                                             |
| `sites:write`    | Upload and delete files on assigned sites                                              |
| `panel:expose`   | Expose agent management panel at `agent-<label>.<domain>` via mTLS-protected subdomain |
| `identity:read`  | Parse Authelia identity headers on plugin routes                                       |
| `identity:query` | Query panel for Authelia user metadata                                                 |

Capabilities are stored server-side and can be updated without reissuing the certificate. Regular agents default to `["tunnels:read"]`, while plugin-agents start with no capabilities at all — the admin must explicitly grant capabilities. Plugins can declare additional capabilities in their manifest (flat array or nested `{ agent: [...] }` format); these are merged with base capabilities dynamically and available for assignment to agent certificates. Ticket scopes also contribute capabilities dynamically: when a scope like `shell` declares `scopes: [{ name: 'shell:connect' }]`, the capability `shell:connect` becomes available for assignment alongside base and plugin capabilities. Users, certificates, agent management, and logs always remain admin-only. Site creation and deletion are also admin-only operations.

In addition to capabilities, regular agent certificates support **per-site scoping** via `allowedSites`. Each agent has a list of site names it is permitted to access. When an agent calls `GET /api/sites`, it only sees sites in its `allowedSites` list. File operations (upload, list, delete) require both the relevant capability and the site name in the agent's `allowedSites`. The admin manages site assignments from **Panel** > **Certificates** > edit agent > **Site Access**, or via the `PATCH /api/certs/agent/:label/allowed-sites` endpoint. Plugin-agents never have site access.

**Cascade revocation:** When a regular agent is revoked, all plugin-agents it delegated are automatically cascade-revoked in the same atomic operation. This ensures that revoking a compromised agent immediately terminates all downstream identities.

This three-level model (certificate type + capabilities + site scoping) means that even if a machine is compromised, the attacker is limited to whichever capabilities and sites were assigned to that agent — and the admin can revoke or reduce them immediately.

#### 5a. Tunnel ownership and the tunnel relay

Every tunnel is carried by exactly one agent (its `agentLabel`), and three things enforce that:

- **The panel API.** An agent certificate sees and acts on only its own tunnels — others are absent from its list and answer `404`. `GET /api/tunnels/agent-config` returns only the caller's tunnels. An agent cannot create a tunnel for another agent or move one; only an admin can. A plugin-agent certificate cannot create tunnels at all (it holds no Chisel credential). Every tunnel change runs under one lock with its validation inside it, so two concurrent requests cannot both claim a subdomain or port.
- **The Chisel authfile.** Each `agent-<label>` Chisel user may reverse-bind exactly `^R:127\.0\.0\.1:<port>$` for the enabled tunnels it owns, and nothing else. A second enrolled machine cannot bind another agent's port and take over its hostname. A `lamaste-no-grants` sentinel user keeps the authfile non-empty, because Chisel disables authentication outright on an empty authfile. The authfile holds every agent's password, so it is `0640`, group `lamaste-chisel` — readable by the Chisel process (`User=nobody`, `Group=lamaste-chisel`) and by nobody else.
- **Reserved ports.** A tunnel vhost proxies to `127.0.0.1:<port>` on the relay, so the ports of Lamaste's own services — 3100 (panel), 9090 (Chisel), 9091 (Authelia), 9292 (IP panel listener), 9294 (Gatekeeper) — can never be tunnel ports. A tunnel on 3100 or 9292 would otherwise publish the panel API, which trusts the client-certificate headers nginx sets: an administrator takeover. The rule is enforced by the request schema, inside the tunnel workflow, and again when the authfile grants are rendered; a port claimed by two tunnels is never granted either.
- **TLS verification on the agent.** The agent's Chisel client connects to `https://tunnel.<domain>:443` and verifies its Let's Encrypt certificate — there is no `--tls-skip-verify`. A machine on the path cannot impersonate the relay to collect the agent's credential or read tunnelled traffic. The credential itself is delivered through a 0600 environment file (Linux) or 0600 plist (macOS), never on the command line. The agent only ever connects to `tunnel.<enrolled domain>` and refuses a panel that reports a different domain. Agents upgraded from a version that exposed the credential in process arguments and 0644 unit files rotate it once, automatically.
- **Revocation releases tunnels.** Revoking an agent certificate removes its Chisel credential and detaches it from its tunnels (app tunnels become unassigned, its panel tunnel is removed), so a later enrollment reusing the label inherits nothing.
- **Fail closed at startup.** On every start the panel rewrites the Chisel unit and authfile from its state in the background. If that fails, Chisel is **stopped and disabled** (so a reboot cannot start it either) rather than left running with an authfile from an older version that may grant more than it should; reconciliation retries with backoff until it succeeds, then re-enables and starts it.

See [Tunneling](tunneling.md#ownership-and-grants) for the mechanics.

#### 5b. Tickets for agent-to-agent authorization

When agents need to communicate with each other (e.g., remote shell, file transfer), the ticket system adds two more layers of isolation on top of certificate capabilities:

1. **Certificate capability check** — both source and target agents must have the relevant scope capability on their certificates
2. **Ticket binding** — the source must own the instance, and the target must be explicitly assigned to it by the admin

Tickets are 256-bit random tokens, valid for 30 seconds, single-use, and validated with timing-safe comparison. After a ticket is consumed, a session tracks the connection with heartbeat re-validation every 60 seconds — checking that both certificates are still valid, capabilities still present, and the assignment still exists. If any condition fails, the session is immediately terminated.

A third isolation layer (transport CA) is available plugin-side for end-to-end verification, but is not enforced by the panel.

Rate limiting (10 tickets/agent/minute) and hard caps (200 instances, 1000 tickets, 500 sessions) protect against resource exhaustion on the 512 MB server.

See [Tickets](tickets.md) for the full model.

mTLS is stronger than a login page because:

- There is no password to brute-force
- There is no session to hijack
- There is no login endpoint to discover or attack
- The rejection happens before any application code runs

#### 5c. The agent daemon (`lamaste-agentd`) and relay assertions

The agent daemon listens on `127.0.0.1:<port>` (9393 by default) of the agent machine. It is reached by the agent's owner directly and by the relay through two kinds of tunnel, and admits:

| Caller                                                   | Proof                                                                    | Access                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| The agent's owning OS user (desktop app, scripts)        | `Authorization: Bearer <token>` from `~/.lamalibre/lamaste/agentd.token` | Full                                                                        |
| The admin certificate, on `agent-<label>.<domain>`       | A relay assertion signed by the panel                                    | Full                                                                        |
| The agent's own certificate, on `agent-<label>.<domain>` | A relay assertion signed by the panel                                    | The capabilities the panel lists for it; owner-only routes refused          |
| An Authelia user, on a plugin tunnel (`type: 'plugin'`)  | A relay assertion signed by Gatekeeper                                   | That plugin's routes, never `/api/*`; the plugin sees the asserted identity |

**Threat model.** Binding to loopback is not an authentication boundary. Two kinds of process can open a connection to the daemon without going through nginx: any OS user on the agent machine (`127.0.0.1:<port>`), and any process on the relay (the tunnel's port on the relay's loopback, which Chisel carries to the agent). Up to 4.2 the daemon took its caller from request headers that nginx sets — `X-SSL-Client-Verify: SUCCESS` with `X-SSL-Client-DN: CN=admin` meant full control, plugin install included (code execution as the agent's user), and `Remote-User` meant any Authelia identity on plugin routes — so either kind of process could claim to be anyone. Its check of whether a request needs a caller also tested the raw URL, while the router decodes percent-escapes: `/%61pi/...` reached `/api/...` routes and `/%68erd/...` a plugin's routes with no credential at all.

**Relay assertions.** From 4.3 the relay vouches for each request it sends with `X-Lamalibre-Relay-Assertion` — an Ed25519 signature over the agent the request is for (`aud`), the tunnel port, the caller, the method, the target (the exact `$request_uri` for a certificate caller; the plugin route for an Authelia user, whose request nginx rewrites), the issue time, a nonce and the key id. The daemon verifies it against the relay's public key and refuses it for another agent or port, for another method or target, older than 60 seconds (5 seconds of clock skew), or seen before. The signing key, `/etc/lamalibre/lamaste/relay-signing-key.json` (0600, `lamaste`), is created by the panel at startup:

- **Agent-panel vhost:** nginx asks the panel about every request (`auth_request` to `GET /api/agent-panel/authz/<label>`, with the client certificate's verification result, the method and `$request_uri`). The panel's mTLS middleware refuses a revoked certificate — before, the agent panel could not check revocation at all — and the panel admits the admin certificate and the agent's own, then signs.
- **Plugin tunnels:** Gatekeeper, which already validates the Authelia session for them, signs for the user it found; the answer is never cached (an assertion is single use).

Agents hold only the public key. The daemon fetches it, with the label the relay knows the agent by (the audience of its assertions, which a local `--label` need not equal), from `GET /api/agents/me/relay-keys` over its pinned mTLS channel, keeps both in memory and fetches again when an assertion names an unknown key — at most once per 30 seconds. Nothing stored on an agent machine lets anyone mint an assertion, for that agent or another.

The owner's token is as good as the owner: the desktop app hands it to curl on stdin, never in a process's arguments, which other local users can read.

Headers that only claim a caller — `X-SSL-Client-*`, `Remote-*` and the assertion itself — are removed from every request before a route or plugin sees it; `Remote-*` are set again only from a verified user assertion, so a plugin reading identity headers (`@lamalibre/lamaste-identity`) reads the relay's word. Whether a request needs a caller follows the route the daemon matched, not the URL: every route does except the health check, the plugin bundles and the SPA's static files, and so does a path no route matches under an installed plugin's name (a plugin may answer it with its own not-found handler). The claim headers are removed from `rawHeaders` too.

**What remains.** The relay's loopback is still the relay's trust boundary: the panel itself trusts the `X-SSL-Client-*` headers nginx sends to `127.0.0.1:3100`, so a process on the relay that can forge those can obtain an assertion as well — what it could do to agents before 4.3. With panel 2FA on it reaches further into agents than into the panel: forged (or stolen) admin-certificate headers no longer pass the panel's own management routes, but the agent-panel authorization is exempt from 2FA (the browser on `agent-<label>.<domain>` carries no 2FA cookie), so they still mint admin assertions — full control of every agent with a panel tunnel. Agent panels are guarded by the client certificate alone, as before; authenticating nginx to the panel is the relay-wide fix. An assertion binds the agent, the port, the method and the target, not the request body: a process on the agent machine that holds the daemon's port while the daemon is down receives the relay's requests, and could replay one with another body if the daemon comes back within the assertion's 65 seconds.

#### 5d. The app host on agents

An agent half Lamaste installs runs on its agent as a service of its own, so something on the agent has to act as root: create an account and a unit, write under `/opt`, `/var/lib` and `/etc`, install system packages. That is `lamaste-apphost`, enabled once per machine by the agent's operator (`sudo lamaste-agent apphost enable`). See [App Host](../04-api-reference/app-host.md) for the helper, its files and the unit.

**What the sudoers rule grants.** The agent's user may run one root-owned program, `/usr/local/sbin/lamaste-apphost`, with any arguments, a reset environment and Node.js's code-loading variables deleted. The program validates every argument, derives every path from the route and the agent label, takes content on stdin, reads nothing the agent's user can write, and does five things: install a version, write a plugin config, switch the current version, remove, report status. It never runs plugin code: the agent half runs as its own account (`lamaste-app-<route>`) under a hardened unit — no capabilities, `NoNewPrivileges`, the file system read-only but its data directory, its code root-owned 0644. `enable` installs the program only from a root-owned `lamaste-agent` install, so root never runs or copies code another user could have changed.

**Why jobs are relay-signed.** Without a signature, the agent's user — or whoever takes its account — could have the helper install any package it can produce with any system packages, activate any kept version, or purge data, as root. Approval of what an agent half brings happens on the relay, so the relay signs every `app-install`, `app-activate` and `app-remove` with its Ed25519 relay key when it creates the job, over the agent's label, the route, the job id, the kind, the payload (the exact package, version, tarball integrity, service and system packages; the version and package to activate; the purge flag and package) and a deadline of at most an hour. The helper verifies it with the key pinned for that agent, compares the payload with what it is asked, and runs each job id once. The agent's sync carries the signature from `agent-config` to the helper; it can neither make nor change one.

**The pin is trust on first use.** `enable` and `pin` fetch the relay's key as the agent's user, over that agent's pinned mTLS channel, and root checks the label and the key's shape: a label of that user's agents — from the user's agent registry, which root reads itself as a file that user owns, and never a label root's own agents use when the user is another, since a pin is per label for the whole machine — and an Ed25519 key whose id is derived from it. An agent account that is already compromised at that moment could hand root its own key for its own labels. Compare the pinned id with the relay's once: on the relay the panel logs it at start-up (`Relay assertion signing key ready`, `kid`) and `GET /api/agents/me/relay-keys` with the admin certificate returns it; on the agent `sudo lamaste-agent apphost status` lists each label's pin. The panel shows the first 12 hex digits each agent reports pinned and does not let an agent whose pin is not the relay's key host an agent half. A pin is a root-owned file in root-owned directories; the helper refuses one anyone else could have written or linked. After the relay's key is replaced, the helper refuses its jobs until `sudo lamaste-agent apphost pin` runs.

**Owner records.** A route belongs to the agent label and the agent package that first installed it — a root-owned record outside the agent half's data. Another label, or another package, is refused that route and the data kept with it until the owner purges it; the account an agent half runs as names its route, and an account that does not is never reused, given files or deleted. A relay can therefore neither take over another relay's agent half on a shared machine nor hand one package's data to another.

**Several agents on one machine.** Agents of different relays may share a machine and its helper. The rule names one OS user, so they run as that user (or root) — `enable` for another user is refused unless `--force`, since the first user's agents could no longer manage their agent halves; each label has its own pin, and a relay's signature names its own label for the agent, so a job signed for one agent is not run as another's.

**What a compromised agent account can still do:** read and rewrite the plugin configs it already holds (`config` is not signed) — breaking the admin API of that agent half; run `status`; run a signed job it received when it likes before the job expires, or not at all; report results that are not true (the relay's view of what runs on the agent is the agent's report); stop its tunnel and its sync. **What it cannot:** run anything as root beyond those fixed operations; install, switch or remove anything the relay did not sign, or anything other than exactly what it signed; replay a job; pin a key (root only); read or write an agent half's data directory (0700, another account); act on a route another label or package owns. **A compromised relay** can do on its agents what its signature allows: install any `@lamalibre/` package from its registry at any version, with system packages from the agent's configured apt sources, running as a service account — never plugin code as root — and remove or purge the agent halves it owns.

#### 5e. Plugin settings and secrets

An agent-hosted plugin's settings may hold secrets — a data provider's API key, a token for another service. The agent half uses them, so the agent half keeps them; the relay never does. See [Settings](../04-api-reference/agent-hosted-plugins.md#settings) for the contract.

**The secret's path.** An administrator types the secret into the panel's form — a password input whose value never enters the page's state or its query cache — or gives it to `lamaste-server plugins configure` (a masked prompt, or a JSON object on stdin; `--set` refuses a secret, since a command line is readable by other local users) or to the desktop app; both clients hand the request body to curl on stdin. The panel's route takes the body off the request before anything else, checks it — with messages that never contain a value — and sends the change through the plugin's internal tunnel to the agent half, `PUT /admin/settings` with a caller assertion naming Lamaste itself. The agent half writes the secret to `secrets.json` in its data directory — `0600`, its own service account's, atomically, refusing a link in the file's place — and answers with its state, which names the secrets that are set and when, never their values. On the relay the secret existed only in the memory of that request; nothing keeps a reference to it afterwards.

**What the relay keeps.** A cache per plugin in `state.db` (`plugin_settings`): the non-secret values, `{ key: setAt }` for each secret that is set, and whether the plugin still needs configuration. The table has no column for a secret's value, and the relay parses every answer of the agent half into a fresh object of the contract's fields, so nothing else the agent half sends reaches it. The panel can therefore show the settings while the agent is offline, and a backup of the relay holds none of these secrets.

**Where a secret never appears:** a log line, an error or validation message, an API response (a secret reads as `{ "set": true, "setAt": … }`), the audit log (`plugin.settings.updated` names keys only), a notification, an operation step, a process argument, a relay hook's input (relay hooks get the non-secret values only), or any file on the relay. Hosting takes no settings, so no secret waits in the panel's memory through an operation that can take minutes. A field an update retypes is dropped, never converted: a secret whose field becomes a string never lands in `settings.json` or in the relay's cache.

**Only Lamaste reads and writes settings.** The forwarder reserves `/admin/settings` and everything under it — `404` however the path is spelled, in any case or percent-encoded — as it reserves `/admin/hooks/*`, and the agent half's settings handler accepts only the caller `lamaste` (`401` for a bad assertion, `403` for an administrator or an agent). No forwarded caller, administrator or agent with the plugin's capability, can read the settings or change them past the panel's checks, and the relay's cache cannot drift from the agent half.

**The agent half's answers.** When the agent half refuses a change field by field (`422`), the relay passes its messages on only under keys a setting can have, cut to 300 characters, and replaces any that contains a secret of the change with `Invalid value`: the agent half is Lamaste code that never repeats a value, but the relay does not answer with one on its word.

**A manifest's regular expressions.** A string field's `pattern` comes from the plugin's manifest. It runs in the administrator's browser and in the agent half — never in the panel process, and never in `lamaste-server`, which runs as root — so a pathological expression can neither stall the panel nor run as root.

**What remains.** The agent half — the plugin's own code — holds its secrets in memory and in its file and uses them as it likes; its account and unit (5d above) keep them from other accounts on the agent, but root on the agent can read them, and they stay with the agent half's retained data when it is removed without purge. On the relay, a secret is readable for the duration of a change by whoever can read the panel process's memory (root, or the `lamaste` account itself). A process on the relay holding the plugin's installation secret (`plugin-hostings.json`, `0600`, `lamaste`) can sign as Lamaste and read or change the settings — though never read a secret back: no answer carries one.

#### 6. TOTP 2FA for app access

Visitors to your tunneled apps authenticate through Authelia with a password and a TOTP code from their phone. See [Authentication](authentication.md) for full details.

#### 6b. Optional panel 2FA (admin only)

The admin can optionally enable a built-in TOTP 2FA layer for the panel itself. When enabled, the admin must present their mTLS client certificate **and** enter a TOTP code. Agents are exempt and continue to authenticate with mTLS only.

Key details:

- **Session cookie:** `lamaste_2fa_session`, HMAC-SHA256 signed, with 12-hour absolute expiry and 2-hour inactivity timeout. Cookie flags: `HttpOnly`, `Secure`, `SameSite=Strict`
- **Rate limiting:** 5 failed attempts within 2 minutes trigger a 5-minute ban
- **TOTP standard:** RFC 6238, SHA-1, 30-second period, +/-1 step clock drift, replay protection
- **IP vhost disabled:** When panel 2FA is enabled, the IP-based vhost (`https://<IP>:9292`) is disabled and access is domain-only. This is necessary because session cookies require a domain scope. `lamaste-server`'s panel commands, which use that vhost on loopback and hold no 2FA session, refuse to run while 2FA is on (see "Admin clients verify the panel too" above)
- **Recovery:** `sudo lamaste-reset-admin` clears 2FA settings and re-enables the IP vhost

See [Authentication](authentication.md) for setup details.

#### 7. Service isolation

Every internal service binds to `127.0.0.1` (localhost) only. Even if an attacker somehow reaches your VPS's internal network, they cannot connect to these services from outside:

| Service       | Bind address | Port |
| ------------- | ------------ | ---- |
| Panel server  | `127.0.0.1`  | 3100 |
| Authelia      | `127.0.0.1`  | 9091 |
| Chisel server | `127.0.0.1`  | 9090 |

nginx is the only service listening on public interfaces. It acts as a gateway, proxying authenticated requests to the internal services.

### The RAM constraint and bcrypt

Your VPS has only 512MB of RAM. This matters for security because some password hashing algorithms are memory-hungry. Argon2id (the "gold standard" for password hashing) allocates ~93MB per hash. On a 512MB system running multiple services, a single authentication attempt with argon2id can consume all available memory and crash everything.

Lamaste uses bcrypt instead. Bcrypt uses ~4KB per hash — over 23,000 times less memory — while still providing strong protection against brute-force attacks. The cost factor is set to 12, meaning each hash computation takes roughly 250ms, making large-scale password cracking impractical.

### Cloud provisioning security

When using the desktop app to create servers on DigitalOcean, the app enforces several safeguards:

- **Custom-scoped tokens** — the app requires 5 DigitalOcean resource groups (account, droplet, regions, ssh_key, tag) and rejects tokens with dangerous permissions (`database:delete`, `kubernetes:create`, `account:write`, etc.). An optional 6th group (`domain`) enables automatic DNS record creation during provisioning
- **Credential storage** — API tokens and P12 passwords are stored in the OS credential store (macOS Keychain / Linux libsecret), never in plaintext files or CLI arguments
- **`lamalibre:managed` + `product:lamaste` tag** — the app tags droplets it creates and refuses to destroy untagged droplets
- **Ephemeral SSH keys** — temporary ed25519 keys are generated for installation, then securely deleted afterward

**If you have other infrastructure on DigitalOcean, create a dedicated DigitalOcean team for Lamaste.** API tokens are account-wide — a token with `droplet:delete` can delete any droplet in the account, not just ones created by Lamaste. A separate team provides true resource-level isolation at no extra cost. See the [Cloud Provisioning guide](../02-guides/cloud-provisioning.md) for setup instructions.

### What is NOT included

Lamaste does not include:

- **Rate limiting at the application level** — fail2ban handles this at the network level
- **WAF (Web Application Firewall)** — your tunneled apps should implement their own input validation
- **DDoS protection** — consider Cloudflare or DigitalOcean's cloud firewall for DDoS mitigation
- **Automatic security updates** — enable Ubuntu's unattended-upgrades for OS patches

## For Developers

### Layer diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Internet                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Layer 1: UFW Firewall                                          │
│  Only ports 22, 80, 443, 9292 open                               │
│  Everything else: DROP                                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Layer 2: fail2ban                                              │
│  Monitors /var/log/auth.log and /var/log/nginx/error.log        │
│  Bans IPs after 5 failed attempts (1 hour)                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Layer 3: nginx TLS Termination                                 │
│  TLS 1.2/1.3 only, strong ciphers                              │
│  Panel vhosts: mTLS (client cert required)                      │
│  App vhosts: Gatekeeper/Authelia (per access mode)              │
└────────────────────────────┬────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
┌─────────────▼──┐  ┌───────▼───────┐  ┌──▼──────────────┐
│ Panel Server   │  │ Authelia      │  │ Chisel Server   │
│ 127.0.0.1:3100 │  │ 127.0.0.1:9091│  │ 127.0.0.1:9090  │
│ mTLS verified  │  │ TOTP verified │  │ per-agent grants│
└────────────────┘  └───────────────┘  └─────────────────┘
```

### UFW firewall implementation

The installer configures UFW in `packages/create-lamaste/src/tasks/harden.js`:

```javascript
// Set defaults
await execa('ufw', ['default', 'deny', 'incoming']);
await execa('ufw', ['default', 'allow', 'outgoing']);

// Allow only required ports
const requiredPorts = ['22/tcp', '80/tcp', '443/tcp', '9292/tcp'];
for (const port of requiredPorts) {
  await execa('ufw', ['allow', port]);
}

// Enable firewall
await execa('ufw', ['--force', 'enable']);
```

The task is idempotent — if UFW is already active with all required ports allowed, it skips the setup entirely. If UFW is active but missing some ports, it adds only the missing rules without resetting existing configuration.

### fail2ban configuration

fail2ban is configured via a drop-in file at `/etc/fail2ban/jail.d/lamaste.conf`:

```ini
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime = 3600

[nginx-http-auth]
enabled = true
port = http,https
filter = nginx-http-auth
logpath = /var/log/nginx/error.log
maxretry = 5
bantime = 3600
```

Two jails are configured:

| Jail              | Monitors                   | Trigger             | Ban duration |
| ----------------- | -------------------------- | ------------------- | ------------ |
| `sshd`            | `/var/log/auth.log`        | 5 failed SSH logins | 1 hour       |
| `nginx-http-auth` | `/var/log/nginx/error.log` | 5 failed HTTP auths | 1 hour       |

Using a drop-in file in `jail.d/` rather than modifying `jail.local` preserves any existing fail2ban configuration and makes the Lamaste rules easy to identify and remove.

### SSH hardening implementation

The installer modifies `/etc/ssh/sshd_config` with a safe sequence:

```
1. Read original sshd_config
2. Check if all settings are already correct → skip if so
3. Apply regex modifications to produce new content
4. Write modified content to a temp file
5. Validate with sshd -t -f /path/to/temp
6. If validation fails → delete temp, leave original untouched
7. If validation passes → back up original, move temp into place
8. Restart sshd
```

The settings applied:

```
PasswordAuthentication no
PermitRootLogin prohibit-password
ChallengeResponseAuthentication no
```

The pre-installation backup is saved to `/etc/ssh/sshd_config.pre-lamaste` and is only created once (subsequent re-runs skip the backup step to preserve the original).

### Swap file

The installer creates a 1GB swap file as a safety net against memory pressure:

```javascript
await execa('fallocate', ['-l', '1G', '/swapfile']);
await execa('chmod', ['600', '/swapfile']);
await execa('mkswap', ['/swapfile']);
await execa('swapon', ['/swapfile']);
```

Swappiness is set to 10 (conservative — the kernel prefers using RAM and only swaps under heavy pressure):

```ini
# /etc/sysctl.d/99-lamaste.conf
vm.swappiness=10
```

The swap file is added to `/etc/fstab` to persist across reboots.

### RAM budget

The 512MB VPS RAM is carefully allocated:

| Service      | Typical RAM | Notes                             |
| ------------ | ----------- | --------------------------------- |
| OS baseline  | ~120MB      | Kernel, systemd, base processes   |
| nginx        | ~15MB       | Low-memory reverse proxy          |
| Authelia     | ~25MB       | Go binary, minimal footprint      |
| Chisel       | ~20MB       | Go binary, WebSocket multiplexing |
| Panel server | ~30MB       | Node.js, Fastify                  |
| fail2ban     | ~35MB       | Python-based, log monitoring      |
| **Total**    | **~245MB**  |                                   |
| **Headroom** | **~265MB**  | Available for spikes              |
| **Swap**     | **1GB**     | Safety net                        |

This budget is why bcrypt (not argon2id) is mandatory for password hashing. Argon2id's ~93MB per hash would consume over a third of total RAM on a single authentication attempt.

### bcrypt configuration

Authelia is configured with bcrypt cost factor 12:

```yaml
authentication_backend:
  file:
    path: /etc/authelia/users.yml
    password:
      algorithm: bcrypt
      bcrypt:
        cost: 12
```

Cost factor 12 means 2^12 = 4096 iterations. Benchmarks on typical hardware:

| Cost factor | Time per hash | Suitable for                    |
| ----------- | ------------- | ------------------------------- |
| 10          | ~65ms         | High-traffic sites              |
| 12          | ~250ms        | Lamaste (good balance)          |
| 14          | ~1000ms       | Very high security requirements |

At cost 12, an attacker with a stolen hash trying 4 passwords per second would need ~8 years to try 100 million passwords. This is sufficient for a self-hosted system that also has fail2ban and network-level protections.

### Service isolation details

All internal services bind to `127.0.0.1`, which means they only accept connections from the same machine. Even if an attacker gains network access to the VPS (e.g., through a compromised container on the same network segment), they cannot reach these services.

The Chisel server explicitly sets `--host 127.0.0.1` in its systemd unit, and runs unprivileged:

```ini
User=nobody
Group=lamaste-chisel
ExecStart=/usr/local/bin/chisel server --reverse --port 9090 --host 127.0.0.1 --keyfile /etc/lamalibre/lamaste/chisel-server.key --authfile /etc/lamalibre/lamaste/chisel-users
```

The unit also sets `NoNewPrivileges`, an empty `CapabilityBoundingSet`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp` and `PrivateDevices`. The binary is Chisel 1.12.0, which `create-lamaste` downloads from its fixed release URL and verifies against a pinned SHA-256 before unpacking it. The panel never installs or replaces it: at startup it only checks the installed version and, if it is not the pinned release, logs an error and restarts Chisel on every authfile change until `create-lamaste` is re-run.

`--authfile` restricts every connecting client to its own credential and port grants. The reverse listeners Chisel opens for agents also bind `127.0.0.1` only: agents may only request `R:127.0.0.1:<port>` remotes.

Authelia is configured in its YAML:

```yaml
server:
  address: 'tcp://127.0.0.1:9091/'
```

Authelia is reachable from the internet (`auth.<domain>`), so it runs as neither root nor `lamaste` but as its own system account, `lamaste-authelia`. Its unit (written by `create-lamaste`) sets `UMask=027`, `NoNewPrivileges`, an empty `CapabilityBoundingSet`, `ProtectSystem=strict` with `ReadWritePaths=/etc/authelia /var/log/authelia`, `PrivateTmp`, `PrivateDevices` and `SystemCallFilter=@system-service`. It can read its configuration through its group and write only its database, notification file, `users.yml` (rewritten on a password change) and its log. The binary is Authelia 4.39.28, downloaded by `create-lamaste` from its fixed release URL and verified against a pinned SHA-256 per architecture; a newer installed Authelia is kept, never downgraded.

The panel server binds to localhost in its Fastify configuration.

nginx is the only service with a public-facing socket. It listens on:

- `0.0.0.0:80`, which only redirects to HTTPS (and answers Let's Encrypt HTTP-01 challenges while certbot runs)
- `0.0.0.0:443` for domain-based vhosts
- `0.0.0.0:9292` for the IP-based admin panel

Tunnel vhosts never pass client-supplied `X-SSL-Client-*` headers to the app (the panel treats those headers from nginx as proof of a client certificate), and public tunnel vhosts also clear the `Remote-*` identity headers, which only an authenticated vhost may set.

### File permissions

Sensitive files use restrictive permissions:

| File                                                                | Mode  | Rationale                                         |
| ------------------------------------------------------------------- | ----- | ------------------------------------------------- |
| `/etc/lamalibre/lamaste/pki/ca.key`                                 | `600` | CA private key — can sign new client certs        |
| `/etc/lamalibre/lamaste/pki/client.key`                             | `600` | Client private key                                |
| `/etc/lamalibre/lamaste/pki/client.p12`                             | `600` | PKCS12 bundle with private key                    |
| `/etc/lamalibre/lamaste/pki/.p12-password`                          | `600` | Password for the .p12 file                        |
| `/etc/authelia/configuration.yml`                                   | `640` | JWT and session secrets; group `lamaste-authelia` |
| `/etc/authelia/.secrets.json`                                       | `600` | Secret backup; the panel (`lamaste`) only         |
| `/etc/authelia/users.yml`                                           | `660` | Password hashes; Authelia rewrites it             |
| `/etc/authelia/db.sqlite3`, `notifications.txt`                     | `600` | Owned by `lamaste-authelia`                       |
| `/etc/lamalibre/lamaste/chisel-server.key`                          | `640` | Chisel SSH host key; group `lamaste-chisel`       |
| `/etc/lamalibre/lamaste/chisel-credentials.json`                    | `600` | Per-agent Chisel passwords                        |
| `/etc/lamalibre/lamaste/chisel-sentinel`                            | `600` | Sentinel Chisel user password                     |
| `/etc/lamalibre/lamaste/chisel-users`                               | `640` | Chisel authfile; group `lamaste-chisel` only      |
| `~/.lamalibre/lamaste/agents/<label>/`                              | `700` | Agent data directory (agent machine)              |
| `~/.lamalibre/lamaste/agents/<label>/chisel.json`, `chisel.env`     | `600` | Agent's Chisel credential (agent machine)         |
| `~/Library/LaunchAgents/com.lamalibre.lamaste.chisel-<label>.plist` | `600` | Carries `AUTH` in its environment (macOS agent)   |
| `/etc/lamalibre/lamaste/pki/`                                       | `700` | PKI directory itself                              |
| `/etc/sudoers.d/lamaste-apphost`                                    | `440` | The app host rule (agent machine)                 |
| `/etc/lamalibre/apps/<route>/plugin-config.json`                    | `600` | An agent half's port and secret; its account      |
| `/var/lib/lamalibre/apps/<route>/`                                  | `700` | An agent half's data; its account                 |
| `/var/lib/lamalibre/apps/<route>/secrets.json`, `settings.json`     | `600` | A plugin's settings and secrets; its account      |
| `/var/lib/lamalibre/apps/.jobs/`, `.trash/`                         | `700` | Signed jobs that ran; purged data (root)          |

Mode `600` means only the file owner can read or write. Mode `640` adds read access for the file's group, `660` also write access. Mode `700` means only the directory owner can list, read, or modify contents. See [Configuration Files](../06-reference/config-files.md#file-permissions-table) for the owner of every directory.

### Privilege boundary

The panel runs as the unprivileged `lamaste` user and cannot become root. `/etc/sudoers.d/lamaste` contains no wildcard: a sudoers `*` matches any characters, spaces included, so a rule such as `mv /tmp/site-index-* /var/www/lamaste/*` also accepts `-t /etc/sudoers.d`, `find /var/www/lamaste/*` accepts `-exec`, `cat /etc/authelia/*` reads `/etc/shadow`, `certbot renew --cert-name * ...` accepts `--deploy-hook <command>`, and an `openssl` rule accepts `-engine`. Every rule is either a fixed command line or a root-owned program that validates its own arguments:

| Rule                                       | What it allows                                                                                                                                                                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `systemctl <verb> <service>` (fixed lines) | `start`/`stop`/`restart` of `nginx`, `chisel`, `authelia`, `lamalibre-lamaste-serverd`, `lamalibre-lamaste-gatekeeper`; `reload` of `nginx` and `authelia`; `try-restart`/`enable`/`disable` of `chisel`; `enable` of `authelia`; `enable`/`start` of `certbot.timer` |
| `nginx -t`                                 | Test the nginx configuration                                                                                                                                                                                                                                          |
| `/usr/local/sbin/lamaste-priv`             | Install/enable/remove the panel's own vhosts, store a TOTP secret, start a self-update (see below)                                                                                                                                                                    |
| `/usr/local/sbin/lamaste-certbot`          | `certbot certonly --nginx` (validated hostnames and email), `renew`, `renew-all`, `list`                                                                                                                                                                              |
| `/usr/local/sbin/lamaste-cert-info`        | Read-only `openssl` queries (expiry, 24 h validity, SAN) on a Let's Encrypt lineage                                                                                                                                                                                   |

There is no rule for `mv`, `cp`, `rm`, `chmod`, `chown`, `mkdir`, `cat`, `find`, `du`, `test`, `ln`, `openssl`, `systemd-run` or `systemctl daemon-reload`. What the panel does without them:

- **Its own files.** The PKI directory (the panel is the CA, and signs agent CSRs itself — see [Certificates](certificates.md)), the web root (`/var/www/lamaste`, `lamaste:www-data`), Authelia's configuration (`/etc/authelia`, `lamaste:lamaste-authelia`) and the Chisel authfile and key (group `lamaste-chisel`, of which `lamaste` is a member) belong to it or to a group it shares.
- **Binaries, units, accounts.** Chisel and Authelia (pinned, digest-verified releases), their systemd units and the service accounts are installed by `create-lamaste`, which runs as root. The panel never writes a unit or a binary; onboarding only checks they exist.
- **Code.** `/opt/lamalibre/lamaste` (panel, gatekeeper, `lamaste-server` CLI, UI, docs) is root-owned and read-only for `lamaste`, so a compromised panel cannot rewrite code that root later runs through `sudo lamaste-server`.

#### Plugin code on the relay: the hook runner

Server plugins run inside the panel (the `@lamalibre/` scope is their trust boundary). Agent-hosted plugins never do: the panel does not import them. Their **relay hooks** — code an administrator approves by digest — run in `lamalibre-lamaste-hooks@<route>.service`: a systemd dynamic user, a read-only file system without Lamaste's state, Authelia, certificates, nginx or SSH configuration, its own network namespace with Unix sockets only, no capabilities, Node's permission model allowing reads of the runner and the approved module only, an empty environment, and its output discarded. The panel calls it over a socket only the `lamaste` group can open; a hook can affect nothing but its answer and the rate-limited effects Lamaste performs for it. See [Lifecycle Hooks](../04-api-reference/lifecycle-hooks.md#the-hook-runner).

#### `lamaste-priv`

`/usr/local/sbin/lamaste-priv` is a root-owned (`0755`), zero-dependency Node.js program installed by `create-lamaste`. Content (vhost text, TOTP secrets) arrives on stdin, never on the command line, so it is not written to the sudo log. It reads nothing the `lamaste` user can write.

| Operation                                                                           | Does                                                                                                                                                            |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nginx-site write\|backup\|restore\|discard-backup\|enable\|disable\|remove <name>` | Manage `sites-available/<name>` (and its `.bak`) and its `sites-enabled` link. `write` validates the vhost on stdin first.                                      |
| `authelia-totp <username>`                                                          | Store the TOTP secret from stdin with Authelia's CLI, run as `lamaste-authelia` (the database is that account's file)                                           |
| `self-update <version>`                                                             | Start `npx @lamalibre/create-lamaste@<version> --yes` in a transient systemd unit two seconds later (`MAJOR.MINOR.PATCH` only)                                  |
| `hooks install <route> <sha256\|none>`                                              | Write a plugin's approved relay hook module (stdin, checked against the digest) root-owned to `/opt/lamalibre/lamaste/hooks/<route>/`, enable its runner socket |
| `hooks activate\|restart\|remove <route> [sha256]`                                  | Point the runner back at the kept previous module; stop a stuck runner; disable it and delete its modules                                                       |

Site names are limited to the panel's own vhosts: `lamalibre-lamaste-panel-domain`, `-auth`, `-tunnel`, `-app-<subdomain>`, `-agent-panel-<label>` and `-site-<uuid>`. `lamalibre-lamaste-panel-ip` (written by `create-lamaste`) may only be enabled or disabled.

**Why vhosts are validated.** nginx's master process runs as root and opens the files a configuration names: `access_log /etc/cron.d/x` with a crafted `log_format` would be a root shell. `lamaste-priv` parses every vhost and accepts only directives on a per-context allow-list, with arguments that cannot name a file outside what Lamaste serves:

- `listen 443` (`[::]:443`), optionally `ssl` / `http2` — port 80 belongs to the installer's HTTPS redirect
- `server_name` with hostnames only
- `ssl_certificate` / `ssl_certificate_key` only under `/etc/letsencrypt/live/<name>/{fullchain,privkey}.pem`
- `include` only `/etc/nginx/snippets/lamalibre-lamaste-*.conf`
- `root` / `alias` only under `/var/www/lamaste/`
- `proxy_pass` only `http://127.0.0.1:<port>[/path]`
- the `proxy_*`, `auth_request`, `auth_request_set`, `limit_req`, `limit_req_zone`, `map`, `add_header`, `error_page`, `return`, `rewrite`, `try_files`, `if`, `index`, `ssl_protocols`/`ssl_ciphers` directives the panel's generators use

Anything else is refused — including directives nginx would accept, backslashes, `${`, and non-ASCII text outside comments. A refused write leaves the previous vhost in place. `npm test` runs the allow-list's refusal tests and checks that every vhost the panel generates passes it.

#### Root code never writes through the panel's paths

`create-lamaste` (including a self-update the panel triggers) and `sudo lamaste-server` run as root on directories `lamaste` can write to, which a compromised panel could have seeded with symlinks. So root never writes through an existing path there: new files are created `O_EXCL | O_NOFOLLOW` under a random name, `fchown`ed and renamed into place; temporary directories are `mkdtemp`; `lamaste-server reset-admin` runs `openssl`, `cp` and `chmod` as `lamaste`; `lamaste-server plugins install|enable|disable|uninstall` change nothing on disk themselves: they call the panel's plugin routes with the admin certificate (the panel runs npm and writes its registry as `lamaste`), and root only restarts the panel.

### Secret generation

All secrets are generated using `crypto.randomBytes`, which reads from the operating system's cryptographically secure random number generator (`/dev/urandom` on Linux):

```javascript
import { randomBytes } from 'crypto';
const password = randomBytes(24).toString('base64url');
```

No secrets are hardcoded in the codebase. Each installation generates unique secrets for:

- PKCS12 bundle password
- Authelia JWT secret
- Authelia session secret
- Authelia storage encryption key

### Onboarding state transitions

The onboarding system enforces a strict state machine that prevents accessing management features before the system is fully provisioned:

```
FRESH → DOMAIN_SET → DNS_READY → PROVISIONING → COMPLETED
```

| State          | Onboarding endpoints | Management endpoints |
| -------------- | -------------------- | -------------------- |
| `FRESH`        | Available            | Return 503           |
| `DOMAIN_SET`   | Available            | Return 503           |
| `DNS_READY`    | Available            | Return 503           |
| `PROVISIONING` | Available            | Return 503           |
| `COMPLETED`    | Return 410 Gone      | Available            |

After onboarding completes, all onboarding endpoints return 410 Gone. This prevents re-running onboarding, which could overwrite configuration or issue duplicate certificates.

### Atomic file writes

Configuration files that are read live by services (like Authelia's `users.yml`) are written atomically: a temporary file in the same directory, `fsync`, then `rename`. The rename is atomic on the same filesystem, so Authelia never reads a partially written file. `/etc/authelia` is setgid `lamaste-authelia`, so the new file belongs to that group; its mode decides whether Authelia may read it (`0640`), also rewrite it (`0660`), or not see it (`0600`). No `sudo` is involved.

### Source files

| File                                                                | Purpose                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| `packages/create-lamaste/src/tasks/harden.js`                       | Swap, UFW, fail2ban, SSH hardening                     |
| `packages/create-lamaste/src/tasks/mtls.js`                         | PKI generation, file permissions                       |
| `packages/create-lamaste/src/tasks/nginx.js`                        | mTLS snippet, self-signed cert                         |
| `packages/lamaste-serverd/src/lib/authelia.js`                      | bcrypt hashing, atomic writes                          |
| `packages/lamaste-serverd/src/lib/mtls.js`                          | Certificate rotation with rollback                     |
| `packages/lamaste-serverd/src/lib/nginx.js`                         | Vhost write-with-rollback pattern                      |
| `packages/lamaste-serverd/src/middleware/mtls.js`                   | Request-level mTLS check                               |
| `packages/lamaste-serverd/src/lib/totp.js`                          | Panel 2FA TOTP verification and replay protection      |
| `packages/lamaste-serverd/src/lib/session.js`                       | HMAC-SHA256 session cookie signing                     |
| `packages/lamaste-serverd/src/middleware/twofa-session.js`          | 2FA session enforcement (after mTLS, before roleGuard) |
| `packages/core/lib/src/relay-assertion.ts`                          | Relay assertions: signing key file, sign, verify       |
| `packages/core/lib/src/server/agent-panel-authz.ts`                 | Who may use an agent panel through the relay           |
| `packages/server/daemon/src/routes/management/agent-panel-authz.js` | The agent-panel vhost's `auth_request` target          |
| `packages/sdks/gatekeeper/src/server/routes/authz.ts`               | Assertions for Authelia users on plugin tunnels        |
| `packages/agent/daemon/src/lib/auth.js`                             | lamaste-agentd's authentication hook                   |
| `packages/core/lib/src/app-job-signature.ts`                        | Relay-signed app jobs: envelope, sign, verify          |
| `packages/agent/cli/scripts/lamaste-apphost`                        | The app host helper (root, Node.js built-ins only)     |
| `packages/agent/cli/src/lib/apphost-setup.js`                       | Root-owned install check, sudoers rule, relay key pins |
| `packages/server/daemon/src/lib/agent-jobs.js`                      | Agent jobs; app jobs signed when created               |
| `packages/core/lib/src/plugin-settings.ts`                          | Settings schema, validation without values, wire types |
| `packages/core/lib/src/agent/plugin-settings-store.ts`              | The agent half's settings files and `/admin/settings`  |
| `packages/server/daemon/src/lib/plugin-settings.js`                 | Settings through the tunnel; the cache without secrets |

## Quick Reference

### Security layers

| Layer                | Technology                              | Blocks                                |
| -------------------- | --------------------------------------- | ------------------------------------- |
| Firewall             | UFW                                     | Connections to non-allowed ports      |
| Intrusion prevention | fail2ban                                | Repeated failed login attempts        |
| SSH hardening        | sshd_config                             | Password-based SSH access             |
| TLS encryption       | Let's Encrypt / self-signed             | Traffic interception and tampering    |
| Admin auth           | mTLS client certificates                | Unauthorized admin access             |
| Admin 2FA (optional) | Built-in TOTP                           | Stolen certificate abuse              |
| Agent-to-agent auth  | Tickets (time-limited, single-use)      | Unauthorized cross-agent access       |
| Tunnel ownership     | Chisel authfile per-agent grants        | One agent hijacking another's host    |
| Reserved ports       | Tunnel port validation                  | Publishing internal services          |
| Privileged commands  | No-wildcard sudoers, `lamaste-priv`     | Root code execution via extra flags   |
| Relay authenticity   | Agent verifies `tunnel.<domain>` TLS    | Relay impersonation, credential theft |
| Panel authenticity   | Pinned panel key, CA for its domain     | Panel impersonation, credential theft |
| Agent daemon auth    | Relay assertions (Ed25519), owner token | Callers forged on an agent's loopback |
| Agent root helper    | Relay-signed app jobs, pinned key       | Root actions the relay did not sign   |
| Agent half sandbox   | Own account, hardened systemd unit      | Plugin code as root                   |
| Plugin secrets       | Agent half only, through the tunnel     | Plugin secrets at rest on the relay   |
| App auth             | Authelia TOTP 2FA                       | Unauthorized app access               |
| Service isolation    | `127.0.0.1` binding                     | Direct access to internal services    |
| File permissions     | `chmod 600`                             | Unauthorized secret access            |
| Atomic writes        | `mv` pattern                            | Partial file reads by services        |

### Firewall rules

```bash
# View current UFW rules
sudo ufw status verbose

# Expected output:
# 22/tcp    ALLOW IN    Anywhere
# 80/tcp    ALLOW IN    Anywhere
# 443/tcp   ALLOW IN    Anywhere
# 9292/tcp  ALLOW IN    Anywhere
```

### fail2ban commands

```bash
# Check jail status
sudo fail2ban-client status

# Check specific jail
sudo fail2ban-client status sshd
sudo fail2ban-client status nginx-http-auth

# Unban an IP manually
sudo fail2ban-client set sshd unbanip 1.2.3.4
```

### RAM budget

| Service           | RAM        | Percentage of 512MB |
| ----------------- | ---------- | ------------------- |
| OS baseline       | ~120MB     | 23%                 |
| nginx             | ~15MB      | 3%                  |
| Authelia (bcrypt) | ~25MB      | 5%                  |
| Chisel            | ~20MB      | 4%                  |
| Panel server      | ~30MB      | 6%                  |
| fail2ban          | ~35MB      | 7%                  |
| **Total**         | **~245MB** | **48%**             |
| **Available**     | **~265MB** | **52%**             |

### Password hashing comparison

| Algorithm          | Memory per hash | Time per hash | Suitable for 512MB VPS |
| ------------------ | --------------- | ------------- | ---------------------- |
| bcrypt (cost 12)   | ~4KB            | ~250ms        | Yes                    |
| argon2id (default) | ~93MB           | ~300ms        | No (causes OOM)        |

### Related documentation

- [mTLS](mtls.md) — client certificate authentication in detail
- [Authentication](authentication.md) — Authelia TOTP 2FA in detail
- [nginx Reverse Proxy](nginx-reverse-proxy.md) — nginx as the security gateway
- [Certificates](certificates.md) — TLS certificate management
- [Tunneling](tunneling.md) — secure tunnel architecture
