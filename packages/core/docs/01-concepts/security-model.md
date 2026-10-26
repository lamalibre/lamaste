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
- **Revocation releases tunnels.** Revoking an agent certificate removes its Chisel credential and detaches it from its tunnels (app tunnels become unassigned, its panel tunnel is removed), so a later enrollment reusing the label inherits nothing. An app tunnel bound as a plugin's user surface keeps its binding but serves none of it from then on (5f), and its vhost loses those locations.
- **Authelia's session cookie never reaches a backend.** Authelia scopes its session cookie (`authelia_session`) to the base domain, so a browser sends it to every tunnel host. Every nginx location that proxies to a tunnel or agent backend — public, authenticated and restricted app tunnels, plugin tunnels, agent panels — sends the backend `Cookie: $lamaste_backend_cookie`: the browser's other cookies, with every `authelia_session` pair removed by an http-level map create-lamaste installs (`/etc/nginx/conf.d/lamalibre-lamaste-backend-cookie.conf`, rendered by core `renderBackendCookieMap` from the cookie name Authelia is configured with). The map strips up to four pairs and fails closed: a request carrying more gets no `Cookie` header at all. Without it, any application on any agent — or whatever took a tunnel's port on the relay — could harvest every visitor's session and replay it on every authenticated host and every plugin's user surface. See [nginx Configuration](../03-architecture/nginx-configuration.md#the-backend-cookie-map).
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

#### 5e. Plugin settings and secrets, and the internal tunnel

An agent-hosted plugin's settings may hold secrets — a data provider's API key, a token for another service. The agent half uses them, so the agent half keeps them; the relay never does. See [Settings](../04-api-reference/agent-hosted-plugins.md#settings) for the contract.

**Anything that takes a tunnel's loopback port serves nothing and opens no secret.** The internal tunnel ends on loopback ports that every process on the relay and on the agent can reach — and take: on the relay while the hosting agent is offline (chisel listens only while it is connected), on the agent while an agent half restarts. Up to 4.3, a process holding such a port received Lamaste's calls in clear and could answer them as the agent half: pass the health probe, take a settings change with its secrets, replay a caller assertion with another body, or serve the plugin's `panel.js` into the panel's own document. On the agent, systemd now holds the port of an agent half Lamaste installs (a socket unit beside its service, passed to it as descriptor 3), so the port stays bound while the agent half restarts, is updated or is stopped ([App Host](../04-api-reference/app-host.md)); an agent half installed by hand binds its port itself. Whoever holds a port, three mechanisms, all keyed with the hosting's installation secret, leave it nothing to serve and no secret to open ([Authentication between the relay and the agent half](../04-api-reference/agent-hosted-plugins.md#authentication-between-the-relay-and-the-agent-half)):

- **Body-bound assertions.** Lamaste's calls with a body sign the SHA-256 of the exact bytes (`bodySha256`); the agent half's hook and settings handlers require it, so an assertion lifted onto another body is refused (`wrong_body`).
- **Authenticated answers.** Every answer the agent half gives a verified request carries `X-Lamalibre-Responder`, an HMAC with the secret that verified the request over its nonce, the status and — for Lamaste's own calls — the SHA-256 of the exact answer body. The relay believes nothing without it: a settings call or a hook call fails as `unauthenticated`, the health probe counts the plugin's application as down, and the forwarder answers `502` before a status, header or byte of the answer reaches the client. Every `/admin/*` response of an agent half must carry it; core's handlers, `createHealthHandler` and `responderHeaderFor` produce it.
- **Sealed secrets.** Each secret of a settings change crosses the tunnel encrypted (AES-256-GCM, key derived with HKDF-SHA256 from the installation secret per plugin) and bound to the plugin, the call's nonce, the field and the revision; the agent half opens it with the secret that verified the call.

Agent halves built against `@lamalibre/lamaste` 4.3 must be rebuilt: one that does not sign its answers is down to the relay.

**What a port's squatter still receives.** These mechanisms authenticate answers and seal secrets; they do not keep the relay from _sending_. A squatter cannot pass a single health probe (it holds no installation secret), so the health monitor marks the hosting down after three failed probes in a row, 10 s apart. From then on **neither forwarder sends anything to the port**: a user's request is answered `503` by the panel, and an administrator's or agent's request on the admin API is answered as a request into a dead tunnel is — the plugin's `tunnel:down` fallback, or `502` with the reason (`tunnel` or `app`) — without a connection being made. So a forwarded request — its method, path, query and body, and the caller assertion with an administrator, an agent, or a user's `userId`, username and roles — can reach a relay-loopback squatter only in the window before the hosting is marked down, about 30 seconds after the agent went away (and, when the agent comes back, a squatter that still holds the port is what the probes find: the hosting stays down). Lamaste's own calls do not go through the forwarders and keep reaching the port — the health probe has to, to see the agent half come back: their bodies are bound to their assertions and a settings change's secrets are sealed, so a squatter learns their non-secret content and nothing it can replay.

**The secret's path.** An administrator types the secret into the panel's form — a masked text input, not a password input (browsers offer to save a password input's value in their password managers whatever its `autocomplete` says), whose value never enters the page's state or its query cache and is read once when the form submits — or gives it to `lamaste-server plugins configure` (a masked prompt, or a JSON object on stdin; `--set` refuses a secret, since a command line is readable by other local users, and says to rotate it) or to the desktop app; both clients hand the request body to curl on stdin. The panel's route takes the body off the request before anything else, checks it — with messages that never contain a value — and sends the change through the plugin's internal tunnel to the agent half, `PUT /admin/settings` with a caller assertion naming Lamaste itself, each secret sealed to that call. The agent half opens it, writes it to `secrets.json` in its data directory — `0600`, its own service account's, atomically, refusing a link in the file's place — and answers with its state, which names the secrets that are set and when, never their values. On the relay the secret existed in clear only in the memory of that request; nothing keeps a reference to it afterwards.

**What the relay keeps.** A cache per plugin in `state.db` (`plugin_settings`): the non-secret values, `{ key: setAt }` for each secret that is set, and whether the plugin still needs configuration. The table has no column for a secret's value, and the relay parses every answer of the agent half into a fresh object of the contract's fields — a `setAt` must be an ISO 8601 UTC timestamp — so nothing else the agent half sends reaches it. When an update changes the settings schema, the cache is pruned in the transaction that installs the new schema: a value whose field became a secret is dropped, and a secret whose field became a plain value is no longer reported set. The panel can therefore show the settings while the agent is offline, and a backup of the relay holds none of these secrets.

**Where a secret never appears:** a log line, an error or validation message, an API response (a secret reads as `{ "set": true, "setAt": … }`), the audit log (`plugin.settings.updated` names keys only), a notification, an operation step, a process argument, a relay hook's input (relay hooks get the non-secret values only), the tunnel in clear, or any file on the relay. Hosting takes no settings, so no secret waits in the panel's memory through an operation that can take minutes. A field an update retypes is dropped, never converted: a secret whose field becomes a string never lands in `settings.json` or in the relay's cache. Such an update always waits for an administrator's approval (`settings.secret-to-plain` in `pendingUpdate.approvalRequired`), whatever its code digest and whether or not auto-approve is on — what is typed into the field next is kept on the relay and shown in clear — and the panel and the CLI warn about it in the update's preview; a plain string field whose name looks like a credential carries a hint to use a secret field.

**Only Lamaste reads and writes settings.** The forwarder reserves every path whose segment after `/admin` — percent-decoded until it is stable (at most three rounds; anything that still decodes, or does not, is reserved), lower-cased and stripped to `a-z0-9` — starts with `settings` or `hooks`, so no spelling a framework's router might resolve (`/admin/Settings`, `/admin/%2573ettings`, `/admin/settings.json`) reaches the agent half; and the agent half's settings handler accepts only the caller `lamaste` (`401` for a bad assertion, `403` for an administrator or an agent). No forwarded caller, administrator or agent with the plugin's capability, can read the settings or change them past the panel's checks, and the relay's cache cannot drift from the agent half.

**Changes made outside Lamaste are reported.** Because only Lamaste writes settings, every revision of the agent half's should be one Lamaste wrote. The relay remembers the last revision it wrote or adopted; a read — on every live read, when the plugin comes up, and once when the panel starts — that finds another one records `plugin.settings.changed-outside-lamaste` in the audit log with the names of the settings that differ (never a value) and the revisions, warns the administrators, and adopts it, so each change is reported once. A change whose answer was lost (a timeout) is remembered by key names, so finding it stored is recorded as the administrator's change, not as an outside one. This is how a change made with the installation secret on the agent — see what remains, below — or files put back there becomes visible.

**The agent half's answers.** When the agent half refuses a change field by field (`422`), the relay passes on only messages Lamaste's own validation produces, matched exactly against its fixed and templated messages (`normalizeSettingsErrorMessage`), and only under keys of the installed schema; anything else reads `Invalid value`. Names a schema does not know are counted (`2 unknown settings`), never repeated, by the panel, the agent half and the CLI alike: a token pasted where a key belongs must not come back.

**A manifest's regular expressions and text.** A string field's `pattern` comes from the plugin's manifest. It runs in the administrator's browser and in the agent half — never in the panel process, and never in `lamaste-server`, which runs as root. The relay validates manifests at install, at update and at every start, so it only compiles a pattern and never tests even the field's own default against it (the agent half does, when it reads its manifest): a pathological expression can neither stall the panel nor run as root. Text a manifest shows an administrator — labels, descriptions, options, string defaults, patterns — refuses control characters and bidirectional overrides, and `lamaste-server` strips them from everything a manifest, an agent half or the panel supplies before printing it.

**Plugin admin bundles share the panel's document.** A plugin's `panel.js` comes from its agent half and runs in the panel's own page, with the panel's origin. The forwarder serves it only when the answer authenticates itself, strips `Set-Cookie`, `Service-Worker-Allowed` and `Clear-Site-Data` from every answer and refuses a request for a service worker's script, so an answer cannot install a service worker over the panel or wipe its storage. The bundle's own code is not confined, though: it can do in the page what the administrator can. That is acceptable while every plugin comes from the `@lamalibre/` scope; isolating plugin UIs in sandboxed frames is its own slice, before any third-party plugin is installable.

**What remains.** The installation secret is held by the relay's panel (`plugin-hostings.json`, `0600`, `lamaste`), by the hosting **agent's account** (its plugin config, `0600`) and by the **agent half's own account** (`/etc/lamalibre/apps/<route>/plugin-config.json`, `0600`). Whoever holds one of them can sign as Lamaste and answer as the agent half. The agent account runs the tunnel's client, so it can route the tunnel to a listener of its own and open the sealed secrets of a change sent then; any holder can read and change the settings through the agent half's handler — though never read a secret back from it, since no answer carries one, and a change made that way is reported as made outside Lamaste. Relay-signed assertions with a key the agent half holds alone would be the next step; until then the agent account and the agent half's account are inside the secrets' trust boundary. The agent half — the plugin's own code — holds its secrets in memory and in its file and uses them as it likes; its account and unit (5d above) keep them from other accounts on the agent, but root on the agent can read them, and they stay with the agent half's retained data when it is removed without purge. On the relay, a secret is readable in clear for the duration of a change by whoever can read the panel process's memory (root, or the `lamaste` account itself). None of the processes that hold these secrets writes a core dump: the units of the panel, Gatekeeper, the hook runner and every agent half set `LimitCORE=0`.

#### 5f. Users of agent-hosted plugins: who attests what

An agent-hosted plugin that declares `identity` serves its users at `/api/<route>/app/*` on a tunnel host bound as its user surface, and learns who is calling from Lamaste — never from a header it has to take on faith ([Users and identity](../04-api-reference/agent-hosted-plugins.md#users-and-identity)). Three parties vouch, each for what it knows:

| Who                | Attests                                                                                                                                                        | How                                                                                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gatekeeper**     | The Authelia **session**: this request comes from the user signed in as `<username>` (and, on a restricted tunnel, the user holds its grant)                   | A relay assertion for the panel — Ed25519 with the relay signing key, audience `@panel` (no agent label can be one), port 3100, the username alone, bound to the method and the raw request target, 60 s, single use, never cached |
| **The panel**      | The **identity** applications see: the directory's `userId`, the username and the user's roles in this plugin — or a refusal (disabled, removed, not entitled) | The HMAC caller assertion keyed with the hosting's installation secret, caller `{ type: "user", userId, username, roles }`, on the request it forwards to the agent half's `/app/*`                                                |
| **The agent half** | Its answer is its own                                                                                                                                          | The responder signature over the request's nonce and the status — without it the panel sends the client a `502`                                                                                                                    |

Gatekeeper attests the session; the panel issues the identity. Gatekeeper never signs a role or an attribute, and the panel never believes a username it did not receive in a Gatekeeper assertion bound to that very request. nginx sends the panel the request target exactly as the browser sent it, so the target the assertion binds is the one the panel checks byte for byte; every server on the way applies one path rule — no `.` or `..` segment, no backslash, no percent-encoded `.`, `/`, `\` or `%` (a `%25` would let a server that decodes twice read `%252e%252e` as `..`), no escape that does not decode — so the path a check approves is the path the next server resolves. Every caller assertion, whoever the caller, names an origin-form path — one leading `/`, never `//`, no scheme or host — or is neither signed nor verified (`wrong_request`).

**Only the hosting agent's host.** A tunnel can be bound as a plugin's user surface only when the agent that carries it hosts the plugin, and its host serves the route only while that stays so: the tunnel moved to another agent, its agent revoked, or the plugin hosted elsewhere or not at all — the binding stays, but the vhost loses its locations (status `not_hosting_agent`), Gatekeeper refuses to vouch (it reads the hosting agent from the plugin's internal tunnel in `tunnels.json`) and the panel refuses a request for the route even with an assertion. A host whose sessions reach the plugin's users is never another agent's to serve — or, through its backend, to read.

**Gatekeeper and the session cookie.** Gatekeeper reads Authelia's session cookie alone, sends Authelia `authelia_session=<value>` and nothing of the browser's other cookies, and refuses a request carrying more than one `authelia_session` (`401`): another host under the domain can plant a second one with another path, and which one Authelia would read is not Gatekeeper's to guess. Its session cache is keyed by the cookie's value **and the tunnel host** — Authelia decides per host, so a session it accepted on one host is asked about again on another — and its rate limit counts per client address and tunnel host (nginx sets `X-Forwarded-For` to the address it accepted, and Gatekeeper trusts that header from `127.0.0.1` only), so one client cannot exhaust the others' authorizations. A refusal is logged with the tunnel and a reason, never the username.

**The `/app` boundary.** On the agent half, paths are a boundary between callers: a `user` caller is valid only under `/app` (read literally), and every other caller — an administrator's certificate, an agent, Lamaste itself — never for a path a router could take for `/app` (`/App`, `/%61pp`, `//app`, `/app.json`). Signing refuses either mistake and verifying answers `wrong_request`: an administrator's assertion cannot act on a user's routes, a user's never reaches `/admin`. On the panel, `/api/<route>/app*` are routes of the user surface's own context — no mTLS, no 2FA session, the assertion alone — which win over the admin forwarder's wildcard, so the admin forwarder no longer reaches an agent half's `/admin/app*`. Panel, auth, agent-panel and IP-panel vhosts clear a client's `X-Lamalibre-Relay-Assertion`, as do tunnel vhosts that do not set Gatekeeper's; a user-surface location also clears the browser's `Cookie`, `Authorization`, `Remote-*`, `X-SSL-Client-*` and `X-Forwarded-Host` before the panel sees the request.

**CSRF and cross-site reads.** The Authelia session cookie travels with requests other sites start, so the panel refuses any user-surface request whose `Sec-Fetch-Site` is present and neither `same-origin` nor `none` — `cross-site`, and `same-site`, which every other tunnel host is — whatever its method (`403`). A request that may change something — any method but `GET`, `HEAD` and `OPTIONS` — must also carry `Origin` equal to the bound host as the tunnel state names it (never the request's `Host`); otherwise `403`. A user-surface request without a session gets a JSON `401`, never a redirect, and the panel never passes a `Set-Cookie` back.

**The answers.** Every user-surface answer — the agent half's, a hook's, the panel's own refusals and errors — carries `Cross-Origin-Resource-Policy: same-origin`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox; default-src 'none'` (the application's own policy stays as a further one), and no `Access-Control-*` header — the panel's CORS is off for these routes — so an answer from a compromised application can neither be read by another origin nor run as a page of the bound host. No answer from any agent half, on the user surface or the admin API, passes `X-Accel-*` to nginx (which would obey `X-Accel-Redirect` from the panel's port); the forwarder sets `X-Accel-Buffering: no` itself on an event stream. No request reaches an agent half with a header that makes some frameworks take it for another method or path than the one the caller assertion signs (`X-HTTP-Method-Override`, `X-Original-URL`, `X-Forwarded-Prefix`, …), and no request hook may set one. The panel's own errors on a user surface are fixed texts per status, never an internal message.

**Open responses end with access.** A response that stays open — an event stream, a slow download — would otherwise outlive what admitted it. The panel keeps every user-surface response it is sending with its user and roles, and every 5 seconds re-resolves each through the directory: one whose user is disabled, removed, no longer entitled, holds other roles, or whose route the host no longer serves is ended at once, the request to the agent half with it. No user-surface response lives longer than an hour (`USER_SURFACE_MAX_RESPONSE_SECONDS`); nginx's timeouts on these locations are the same hour.

**Data minimisation.** A plugin always receives a user's `userId` and **username** — in the caller assertion of every request and in every member and last-known record of its feed — and of the other attributes only those its manifest declares (`displayName`, `email`); widening them waits for an administrator's approval that auto-approve never gives (`identity.changed`). Nothing identity is ever sent to a plugin that does not declare `identity`. A user who leaves keeps, on the plugin's side, only what it last received. The feed's batches travel **sealed**: their changes are encrypted (AES-256-GCM) with a key derived from the hosting's installation secret — domain-separated from the settings secrets' — and bound to the caller assertion's nonce and the batch envelope, so the chisel server and whatever holds a loopback end of the internal tunnel never see a member in clear. Audit entries name users by `userId` alone, and the feed's wire parsers never echo a received value. The panel and Gatekeeper log one metadata line per request — method, **route pattern** (never the URL or its query), status, duration, certificate role, and the client address only for certificate holders, never for a person — instead of Fastify's own request lines; the panel's log lines name users by `userId`; Gatekeeper's principal removal and access-log purge take the username in a request body, never a URL. `users.yml`'s content never reaches a log, even when it cannot be parsed. What nginx's access log, journald and Authelia's log keep, and for how long: [Monitoring](../05-operations/monitoring.md#logs-and-personal-data).

**Offboarding and erasure.** One offboarding function, keyed by `userId`, runs for every user who stops being one — disabled or deleted through the users API, or disabled or removed in `users.yml` outside it (adopted by the minute's reconcile): their desktop sessions end (an epoch keyed by `userId`; sessions are bound to the `userId`, so a username given to someone else revives none), their registry tokens are revoked, Gatekeeper drops its cached session verdicts, and for a removal their legacy plugin-access grants, Gatekeeper principal (every grant and group membership under the username) and Authelia second factors (TOTP configuration, WebAuthn credentials) go. Disabling is effective at once: the directory is written in the same step, so the user surface refuses them (`403`), Authelia ends their session at their next request, and every audience shows them disabled; a disable that Authelia's own rewrite of `users.yml` undoes is made again, and reported when it does not stick. Deleting keeps a tombstone (the `userId` and the last known name and address, `removed`) so history stays readable. **A re-created username is a new user with a new `userId` and inherits no grant, group, role, second factor or session**: at every creation over a tombstone Gatekeeper drops everything under the username and Authelia its second factors (refused while either cannot), a username a deleted user held and nobody holds takes no grant or membership (`409 username_deleted`), and grants are given under the users lock so none races a deletion. The one exception Lamaste cannot remove is the **OpenID Connect identity**: Authelia's opaque identifier (`sub`) for a username cannot be deleted, so a username Authelia holds one for is never given to a new user (`409 username_has_oidc_identity`). **Erasing** scrubs the tombstone, the user's invitations, Gatekeeper's access-request log rows and Authelia's second factors, and rewrites the user's row to `remove/erased` in every plugin that ever had them — uninstalled plugins whose data an agent keeps and plugins that no longer declare identity included (a plugin's audience is its erasure ledger, dropped only when no agent keeps its data); its agent half scrubs its row and anonymises its own data in one transaction, never takes the user back afterwards (erasure is sticky in its projection), and the panel shows the erasure as pending until each plugin's data has it. Outside Lamaste's reach: Authelia's opaque identifier and authentication log, nginx's access logs, journald's older entries, and backups taken before ([Backup and Restore](../05-operations/backup-and-restore.md) on restoring a relay).

**What remains.** Plain `authenticated` and `restricted` app tunnels still pass the user to their backend as **unsigned** `Remote-User`, `Remote-Groups`, `Remote-Name` and `Remote-Email` headers set from Gatekeeper's answer: nginx replaces whatever the client sent, but the backend's port is reachable on the relay's and the agent's loopback by any local process, which can send any `Remote-*` it likes. Only plugin tunnels (a relay assertion for lamaste-agentd, 5c) and plugin user surfaces carry a signed identity; Gatekeeper-signed identity for plain tunnels is future work. A backend never receives the session cookie (5a), but it answers on a host under the relay's domain and can set cookies there — a second `authelia_session` with another path, which Gatekeeper refuses rather than guess. Until the hosting is marked down, a forwarded request — a user's or an administrator's — can reach a relay-loopback squatter (5e). The relay's loopback stays the relay's trust boundary: a process on the relay that can read the relay signing key can mint assertions for the panel, as it could for agents before.

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

The units of the panel (`lamalibre-lamaste-serverd`), Gatekeeper and the hook runner (`lamalibre-lamaste-hooks@.service`) — like every agent half's unit on agents ([App Host](../04-api-reference/app-host.md)) — set `LimitCORE=0`, soft and hard: no core dump of a process that holds the CA and signing keys, sessions, installation secrets or a settings secret in transit — or, for a hook, the application data it inspects — and the process cannot raise the limit.

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

| Operation                                                                           | Does                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nginx-site write\|backup\|restore\|discard-backup\|enable\|disable\|remove <name>` | Manage `sites-available/<name>` (and its `.bak`) and its `sites-enabled` link. `write` validates the vhost on stdin first.                                                                                               |
| `authelia-totp <username>`                                                          | Store the TOTP secret from stdin with Authelia's CLI, run as `lamaste-authelia` (the database is that account's file)                                                                                                    |
| `authelia-user purge-second-factors <username>`                                     | Delete the user's TOTP configuration and every WebAuthn credential with Authelia's CLI, as `lamaste-authelia` (nothing there is fine)                                                                                    |
| `authelia-user has-oidc-identifier <username>`                                      | Print `yes`/`no`: whether Authelia holds an OpenID Connect opaque identifier for the username — the table exported as `lamaste-authelia` to a `/run` directory only it and root can enter, read, overwritten and removed |
| `self-update <version>`                                                             | Start `npx @lamalibre/create-lamaste@<version> --yes` in a transient systemd unit two seconds later (`MAJOR.MINOR.PATCH` only)                                                                                           |
| `hooks install <route> <sha256\|none>`                                              | Write a plugin's approved relay hook module (stdin, checked against the digest) root-owned to `/opt/lamalibre/lamaste/hooks/<route>/`, enable its runner socket                                                          |
| `hooks activate\|restart\|remove <route> [sha256]`                                  | Point the runner back at the kept previous module; stop a stuck runner; disable it and delete its modules                                                                                                                |

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

## Several domains on one relay

A relay may serve several base domains with one user directory and an explicit member list per domain ([Domains API](../04-api-reference/domains.md)).

- **Membership is enforced twice, from one source** (the panel's `state.db`, and Gatekeeper's grants for external members): Authelia (groups Lamaste owns in `users.yml`, named by `access_control` rules with deny last and `default_policy: deny`, and by one OIDC authorization policy per user-facing client) and Gatekeeper (the `domains.json` projection, fail closed; read again on every cache bust and every minute, whatever its file watcher saw). Either alone keeps a non-member out of tunnels and plugin surfaces; static sites rely on Authelia, OIDC sign-ins on the clients' authorization policies. One lock (`withDomainRendering`) serializes everything that writes what members may do. Both are always rendered — one failing never keeps the other at older members — and a failing rendering is audited (`domain.render.failed`) and raised to the administrators until it succeeds.
- **A protected site is never served open:** a protected static site whose hostname is under none of the relay's domains (possible since 4.6) answers `403` to everyone, and editing or re-verifying it is refused until it is unprotected or its domain is added.
- **A user-facing OIDC client is always gated by membership:** a client is either a service (`client_credentials` alone) or user-facing, never both — Authelia gives a `client_credentials` client `one_factor`, never a domain's member policy.
- **Cookies never cross domains:** domains may not overlap **and may not share a registrable domain** (eTLD+1 by the Public Suffix List; a public suffix is never a domain) — otherwise an application on `cust1.example.net` could set an `authelia_session` on `example.net` that the browser sends to `cust2.example.net` (a planted session, a forced sign-in, a lock-out) and both would be one site for `SameSite`. So one domain's session cookie never reaches another's hosts; the backend cookie map strips `authelia_session` on every domain. Each `auth.<domain>` passes Authelia its own name as `X-Forwarded-Host` / `-Proto` — a client cannot make one domain's portal act as another's issuer or cookie domain.
- **Nothing lands on a domain as it changes:** adding, activating and removing a domain hold the tunnel and sites locks under which tunnels, sites and plugin moves resolve their domain and sites take hostnames; the registry credential is written under the domains lock. The relay's own hostnames (`auth.`, `panel.`, `tunnel.`, `agent-*`) of a pending domain are kept free, and a domain is added and activated only while no tunnel, site or alias holds one. An invitation grants, at acceptance, only the domains it names that existed when it was made — a domain removed and added again is not one of them.
- **Registry tokens follow the registry's sign-in**: a user whom none of the registry's own sign-in clients (the user-facing clients whose audience is the registry) admits any more — whatever narrowed them, a revocation with Gatekeeper's own CLI included — loses their Feria tokens (best effort; they sign in again); none such client, or one that cannot be read, revokes (fail closed). Changing the credential's domains revokes those of everyone outside the new ones. Every narrowing is audited (`directory.access.narrowed`, by id).
- **One issuer per domain:** a token carries the issuer it was obtained at; a relying party trusting one issuer refuses the others.
- **External members reach only what names them** — `restricted` tunnels and surfaces that grant them, static sites that list them, OIDC clients granted to them — checked by Authelia (an external member's rule admits them only on a host whose name is one of their groups, and the panel gives them a host's group only for a grant on it; an `authenticated` host has none, so it is closed to them from its first request) and again by Gatekeeper (the projection carries the kind). They hold no Authelia group (`admins`, `feria-*`), so no group grants them anything by membership; Lamaste (Gatekeeper) groups in grants apply to them. Making a member external takes effect at their next request.
- **Who is let in changes without a restart.** Memberships, kinds, grants, users and sites' listed users are groups Lamaste owns in `users.yml`, which Authelia watches and re-reads at each request (`refresh_interval: always`, rendered); if its configuration could not be brought to that, a change of the file restarts it. The panel touches the file 0.6 s after its last write — read again, Lamaste's groups applied again, written — because Authelia skips a reload within 0.5 s of the previous one; the start and the identity tick touch it too. Authelia's own password change and reset, which would write the file from an older copy, are disabled. A write never drops a user it was not told to delete, never gives a user the rendering did not know (a reused username) any of Lamaste's groups, and only narrows after a rendering failed; when the grants cannot be read, external members hold no granted host or client until they can (fail closed). The names of those groups are reserved: an administrator assigns only `[A-Za-z0-9_-]` names, and the panel removes any owned-looking group it did not render — compared folded as Authelia compares (`ſ` is `s`), under every domain and every removed one.
- **Grants are access, kept until revoked**: Gatekeeper consumes only a local plugin grant (its desktop enrolment), and sweeps only those; tunnel, site, agent-plugin and OIDC-client grants were swept 90 days after creation before 4.7. Uninstalling a plugin revokes the grants on its OIDC clients.
- **The accepted shared blast radius:** one droplet, nginx, panel, Gatekeeper and Authelia serve every domain, and the admin certificate manages all of them. A compromise of the relay reaches every domain it serves — the normal hosting trade-off, documented rather than engineered around. A customer who must keep its users off the relay needs a relay of its own (or, later, an external identity provider for its domain).
- **Same-site:** applications on one domain share its registrable domain as before; a customer's applications on their own domain are now a separate site from Code Lama's.

**What remains.**

- **OIDC access tokens already issued.** Authelia checks a client's authorization policy — membership of its domain, or an external member's grant — when a user authorizes it, not afterwards. Plugin clients therefore get no refresh tokens (the manifest refuses the `refresh_token` grant and the `offline` / `offline_access` scopes; a plugin installed before is served without them), and the access and ID tokens of user-facing clients live 15 minutes: a user removed from a domain, or whose grant was revoked, keeps at most those, until they expire. Feria's own tokens are revoked (above).
- **One session store.** Authelia keeps every domain's sessions in one store; the separation between domains is the browser's cookie scoping plus membership by username — a session value moved to another domain's cookie would be accepted there for a member. The backend cookie map keeps session values away from every backend.
- **Structural changes restart Authelia** — a domain added, activated or removed, a static site protected, unprotected, created or removed, the set of OIDC clients or a plugin's domain changed — which ends every session on every domain (Authelia keeps sessions in memory): an availability cost, not an access one, and an administrator's action (R3, narrowed in 4.7).
- **Authelia's device-code flow reads a session's groups as they were** (R5): unlike the authorization-code flow, it checks a client's policy against the groups the session last refreshed. So a change that takes a device-code client (`feria login`) away from someone — a membership ended or made external on a domain serving one, a grant on one revoked — restarts Authelia, ending every session on every domain. External members without such a grant (corral's) never cause it. To be reported upstream.
- **Lamaste's groups reach an OIDC client that asks for `groups`** (R4): Authelia's standard `groups` claim cannot be filtered, so such a client — one the administrator installed, Feria's `feria login` — sees the user's groups. They are opaque — a random key per domain (`lamaste:m:<key>`, `lamaste:x:<key>`), a site's id — so no domain or site is named; what remains is that two users sharing a key share a domain, the client ids granted to an external member, and an external member's granted hostnames on their own domain. Gatekeeper keeps them from every tunnel backend.

### Per-domain branding of the auth pages

A domain's brand ([Domains API — Branding](../04-api-reference/domains.md#branding)) reaches the sign-in origin `auth.<domain>` only as files the panel rendered from validated fields:

- **No operator bytes on the sign-in origin.** The name is 1–64 printable characters without control, bidirectional or invisible characters and without `<` `>` `{` `}` — it is spliced into Authelia's translation strings, some of which carry `<policy>` tags and `{{…}}` interpolations; the colour matches `#[0-9a-f]{6}`; the logo is parsed as a PNG (signature, IHDR, IEND; ≤ 512 KiB, ≤ 1024 a side) and the favicon as an ICO with a valid directory or a PNG — **never SVG**, a script carrier on that origin. The stylesheet is generated from the colour alone; the locale files are Authelia's own with one value substituted. No CSS, HTML or SVG of the operator's exists anywhere in the model.
- **Content type by extension, never by bytes** (the vhost of the later wave adds `nosniff`); Authelia's CSP stays untouched — a same-origin stylesheet and image are what `style-src 'self'` / `img-src 'self'` allow, nothing inline is added.
- **The record is the truth, the files a rendering**: each rendering is a directory of its own (0640 files, 0750 directories, fsynced) and the domain's entry a symbolic link switched in one `rename`, never written through an existing path, the old directory renamed aside before it is removed; `rendered.json` is opened without following a link on the file; a plain directory or a foreign link at a domain's entry is replaced, never followed; the reconcile re-renders what is stale and removes what has no record. A rendering that fails leaves the previous one in place and is audited once per streak.
- **The placeholder logo in Authelia's asset directory** (`/etc/authelia/assets/logo.png`, Lamaste's own, 0640 for the `lamaste-authelia` group) exists only to switch the portal's logo slot on at Authelia's start; it is never a visitor's — the per-domain vhost of the later wave decides what each domain shows.
- **Logs and the audit log name the domain, the field names and the asset digests** — never the image bytes, never the name.

## Quick Reference

### Security layers

| Layer                | Technology                                 | Blocks                                |
| -------------------- | ------------------------------------------ | ------------------------------------- |
| Firewall             | UFW                                        | Connections to non-allowed ports      |
| Intrusion prevention | fail2ban                                   | Repeated failed login attempts        |
| SSH hardening        | sshd_config                                | Password-based SSH access             |
| TLS encryption       | Let's Encrypt / self-signed                | Traffic interception and tampering    |
| Admin auth           | mTLS client certificates                   | Unauthorized admin access             |
| Admin 2FA (optional) | Built-in TOTP                              | Stolen certificate abuse              |
| Agent-to-agent auth  | Tickets (time-limited, single-use)         | Unauthorized cross-agent access       |
| Tunnel ownership     | Chisel authfile per-agent grants           | One agent hijacking another's host    |
| Reserved ports       | Tunnel port validation                     | Publishing internal services          |
| Privileged commands  | No-wildcard sudoers, `lamaste-priv`        | Root code execution via extra flags   |
| Relay authenticity   | Agent verifies `tunnel.<domain>` TLS       | Relay impersonation, credential theft |
| Panel authenticity   | Pinned panel key, CA for its domain        | Panel impersonation, credential theft |
| Agent daemon auth    | Relay assertions (Ed25519), owner token    | Callers forged on an agent's loopback |
| Agent root helper    | Relay-signed app jobs, pinned key          | Root actions the relay did not sign   |
| Agent half sandbox   | Own account, hardened systemd unit         | Plugin code as root                   |
| Plugin secrets       | Agent half only, through the tunnel        | Plugin secrets at rest on the relay   |
| Plugin users         | Gatekeeper attests, the panel identifies   | Forged users on a plugin's `/app`     |
| Session confinement  | Backend cookie map, per-host session cache | Session theft by a tunnel backend     |
| App auth             | Authelia TOTP 2FA                          | Unauthorized app access               |
| Service isolation    | `127.0.0.1` binding                        | Direct access to internal services    |
| File permissions     | `chmod 600`                                | Unauthorized secret access            |
| Atomic writes        | `mv` pattern                               | Partial file reads by services        |

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
