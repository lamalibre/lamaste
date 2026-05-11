# Standalone Plugin with Lamaste Tickets

> This guide walks through deploying a plugin (e.g., Sync) as a standalone server that uses Lamaste's tunneling and ticket system for authorization — without running the plugin as a Lamaste panel plugin.

## Scenario

You are an admin who has:

1. A **Lamaste server** running on a DigitalOcean droplet
2. A **Mac** with a Lamaste agent enrolled and a standalone Sync server installed
3. A **Raspberry Pi** running a Sync agent that needs to sync files with the Sync server

The Sync server is **not** a Lamaste plugin — it runs as its own process on its own port. However, it leverages Lamaste for:

- **Tunneling** — making the Sync server reachable through a Lamaste subdomain
- **Tickets** — authorizing which agents can connect to the Sync server

## Step-by-Step Walkthrough

### 1. Install the Lamaste Desktop App

The desktop app is a management shell for existing CLI tools — it does not install them. If the Lamaste agent CLI or Sync CLI are not already installed, install them first.

### 2. Provision a Lamaste Server

Using the desktop app's cloud provisioning wizard:

- Enter your DigitalOcean API token
- Select a region and droplet size
- The wizard calls `@lamalibre/lamaste-cloud` to create the droplet
- Progress streams back as NDJSON events in the desktop UI
- Complete onboarding in the browser panel

### 3. Enroll a Lamaste Agent on the Mac

From the Lamaste panel, create an enrollment token with the `sync:connect` capability (in addition to the default `tunnels:read`). On the Mac, run `lamaste-agent setup` with that token.

```mermaid
sequenceDiagram
    participant Admin as Admin (Desktop)
    participant Panel as Lamaste Panel
    participant Mac as Mac (Agent CLI)

    Admin->>Panel: POST /api/certs/agent/enroll<br/>{label: "macbook-pro",<br/>capabilities: ["tunnels:read", "sync:connect"]}
    Note over Panel: Generate 32-byte token<br/>10-minute expiry<br/>Store in enrollment-tokens.json
    Panel-->>Admin: {ok, token, expiresAt}

    Admin-->>Mac: Out-of-band: token + panel URL

    Mac->>Panel: POST /api/enroll<br/>{token, csr: "<PEM CSR>"}
    Note over Panel: Validate token (HMAC-SHA256 timing-safe)<br/>Consume token (mark used)<br/>Sign CSR with panel CA<br/>Subject: CN=agent:macbook-pro/O=Lamaste<br/>Validity: 730 days<br/>Add to agent registry with capabilities:<br/>["tunnels:read", "sync:connect"]
    Panel-->>Mac: {ok, cert, caCert, label, serial, expiresAt}
    Note over Mac: Save cert + CA to ~/.lamalibre/lamaste/<br/>Agent is now enrolled
```

### 4. Install the Sync Server Standalone on the Mac

Run the Sync installer on the Mac:

```
npx @lamalibre/create-sync
```

The installer walks through an interactive setup wizard. On first run, the Sync server generates a one-time **setup token** (printed to console, never persisted). The admin enters this token to generate an **API key** that secures all subsequent API access.

```mermaid
sequenceDiagram
    participant Admin as Admin (Mac terminal)
    participant Installer as create-sync wizard
    participant Server as Sync Server (Mac)

    Admin->>Installer: npx @lamalibre/create-sync

    Note over Installer: Check Node.js version<br/>Check rclone installed<br/>Select: Standalone mode

    Installer->>Server: GET /api/sync/health
    Note over Server: First startup:<br/>No API key exists yet<br/>Generate one-time setup token<br/>Print to console (in-memory only)
    Server-->>Installer: {ok: true}

    Admin-->>Installer: Enter setup token (from console)

    Installer->>Server: POST /api/sync/setup/api-key<br/>X-Setup-Token: <token>
    Note over Server: Timing-safe token verification<br/>Generate API key: sync_<32-byte-hex><br/>Store SHA-256 hash in sync-config.json<br/>Discard setup token (one-time use)
    Server-->>Installer: {ok, apiKey: "sync_..."}

    Note over Admin: Admin must save this API key<br/>It cannot be retrieved again

    Installer->>Server: PATCH /api/sync/storage<br/>Authorization: Bearer <apiKey><br/>{provider, bucket, accessKey, secretKey, region}
    Note over Server: Test connection to storage<br/>Encrypt credentials with master key<br/>Save to sync-config.json
    Server-->>Installer: {ok}

    Note over Installer: Optionally: create first project<br/>Install launchd/systemd service<br/>Server is now running
```

The Sync server now runs as a local service on the Mac. It operates independently of Lamaste — it has its own API key, its own storage config, and its own agent registry at `~/.sync/agents.json`.

### 5. Register Sync Scopes and Instance on Lamaste

The Sync server detects that the Mac has a Lamaste agent certificate. Using that cert (mTLS), it registers a ticket scope and instance with the Lamaste panel. This is handled automatically by `TicketInstanceManager` from `@lamalibre/lamaste-tickets` — the admin does not need to do anything.

```mermaid
sequenceDiagram
    participant Sync as Sync Server (Mac)
    participant Panel as Lamaste Panel

    Note over Sync: Startup: detect Lamaste agent cert<br/>at ~/.lamalibre/lamaste/ → enter plugin mode<br/>mTLS auth: CN=agent:macbook-pro

    Sync->>Panel: POST /api/tickets/scopes<br/>{name: "sync", version: "1.0.0",<br/>scopes: [{name: "sync:connect",<br/>instanceScoped: true}],<br/>transport: {strategies: ["tunnel"],<br/>preferred: "tunnel"}}
    Note over Panel: Store scope in ticket-scopes.json<br/>Refresh capability set<br/>(sync:connect now assignable)
    Panel-->>Sync: {ok, registered: ["sync:connect"]}

    Sync->>Panel: POST /api/tickets/instances<br/>{scope: "sync:connect",<br/>transport: {strategies: ["tunnel"],<br/>preferred: "tunnel"}}
    Note over Panel: Generate instanceId (16 bytes hex)<br/>Bind to agent label: macbook-pro<br/>Status: active
    Panel-->>Sync: {ok, instanceId,<br/>instanceScope: "sync:connect:<id>"}

    loop Every 60 seconds
        Sync->>Panel: POST /api/tickets/instances/<instanceId>/heartbeat
        Note over Panel: Update lastHeartbeat<br/>Keep status: active
        Panel-->>Sync: {ok}
    end
```

### 6. Create a Tunnel for the Sync Server

The admin creates a tunnel through Lamaste so the Sync server is reachable from the internet at a subdomain (e.g., `sync.your-domain.com`). The tunnel forwards traffic from the Lamaste droplet through the Mac's Lamaste agent to the local Sync server port. All Lamaste tunnel subdomains are protected by Authelia — unauthenticated requests are redirected to the login portal.

### 7. Admin Prepares Agent Enrollment

Before the Raspberry Pi can connect, the admin must prepare its enrollment. This is a two-part process: the admin creates the enrollment on the Sync server, and the Sync server pre-announces it to the Lamaste panel.

The admin creates a new agent enrollment on the Sync server (e.g., via the Sync CLI or admin API). Because the Sync server detects it is running as a Lamaste agent, it automatically pre-announces to the Lamaste panel, requesting a delegated enrollment token for the new agent.

```mermaid
sequenceDiagram
    participant Admin as Admin (Mac)
    participant Sync as Sync Server (Mac)
    participant Panel as Lamaste Panel

    Admin->>Sync: Create enrollment for agent "rpi-sync"<br/>Authorization: Bearer <apiKey>

    Note over Sync: Detect: has Lamaste agent cert<br/>→ pre-announce to Lamaste

    rect rgb(40, 40, 60)
        Note over Sync,Panel: Pre-announcement (mTLS: CN=agent:macbook-pro)
        Sync->>Panel: POST /api/certs/agent/enroll-delegated<br/>{pluginAgentLabel: "rpi-sync",<br/>scope: "sync:connect"}
        Note over Panel: Verify caller is agent (not plugin-agent)<br/>Verify sync:connect is a registered ticket scope<br/>Verify sync:connect is NOT a base capability<br/>Verify agent owns active instance for scope<br/>Generate delegated token (32 bytes, 10-min expiry)<br/>Store with type: "delegated",<br/>delegatedBy: "macbook-pro",<br/>label: "plugin-agent:macbook-pro:rpi-sync",<br/>capabilities: ["sync:connect"]
        Panel-->>Sync: {ok, enrollmentToken,<br/>expiresAt, pluginAgentLabel}
    end

    Sync-->>Admin: Enrollment prepared:<br/>- Sync API key (already known)<br/>- Sync server URL: sync.your-domain.com<br/>- Lamaste delegated token<br/>- Lamaste panel URL

    Note over Admin: Admin now has everything needed<br/>to set up the Raspberry Pi
```

The admin now has four pieces of information to give to the Raspberry Pi:

| Credential              | Purpose                                  | Source                                              |
| ----------------------- | ---------------------------------------- | --------------------------------------------------- |
| Sync API key            | Authenticate with the Sync server        | From step 4 (already known)                         |
| Sync server URL         | Where to reach the Sync server           | `https://sync.your-domain.com` (the tunnel)         |
| Lamaste delegated token | Enroll with Lamaste to get a certificate | From the pre-announcement (one-time, 10-min expiry) |
| Lamaste panel URL       | Where to submit the enrollment           | `https://your-domain.com`                           |

### 8. Raspberry Pi Enrolls with Lamaste

The Raspberry Pi must enroll with Lamaste **before** it can access the tunnel. The Lamaste panel's `/api/enroll` endpoint is public — no mTLS or Authelia required. The delegated token is the sole authentication gate.

```mermaid
sequenceDiagram
    participant Admin as Admin
    participant RPi as Raspberry Pi
    participant Panel as Lamaste Panel

    Admin-->>RPi: Out-of-band: delegated token +<br/>panel URL + API key + tunnel URL

    Note over RPi: Step 1: Enroll with Lamaste FIRST<br/>(before accessing the tunnel)<br/>Generate RSA 4096-bit keypair<br/>Create CSR via openssl req

    rect rgb(40, 60, 40)
        Note over RPi,Panel: Lamaste enrollment (public endpoint — no mTLS, no Authelia)
        RPi->>Panel: POST /api/enroll<br/>{token: delegatedToken,<br/>csr: "<PEM CSR>"}
        Note over Panel: Validate token (HMAC-SHA256 timing-safe)<br/>Verify delegating agent (macbook-pro)<br/>still registered and not revoked<br/>Consume token (mark used)<br/>Sign CSR with panel CA<br/>Subject: CN=plugin-agent:macbook-pro:rpi-sync<br/>Validity: 730 days<br/>Add to agent registry:<br/>enrollmentMethod: "delegated"<br/>delegatedBy: "macbook-pro"<br/>capabilities: ["sync:connect"]
        Panel-->>RPi: {ok, cert, caCert,<br/>label: "plugin-agent:macbook-pro:rpi-sync",<br/>serial, expiresAt}
    end

    Note over RPi: Save Lamaste cert files to<br/>~/.sync-agent/lamaste-cert/<br/>client.key (mode 0600)<br/>client.crt (mode 0644)<br/>ca.crt (mode 0644)

    Note over RPi: RPi now has a Lamaste identity<br/>and can access Authelia-protected tunnels
```

### 9. Raspberry Pi Registers with the Sync Server

Now that the RPi has a Lamaste certificate, Authelia can identify it and grant access to the tunnel subdomain. The RPi connects to `sync.your-domain.com` through the Authelia-protected tunnel and registers with the Sync server using the API key.

```mermaid
sequenceDiagram
    participant RPi as Sync Agent (RPi)
    participant Authelia as Authelia
    participant Tunnel as Lamaste Tunnel<br/>sync.your-domain.com
    participant Sync as Sync Server (Mac)

    Note over RPi: Daemon starts<br/>Has Lamaste cert → can access tunnel<br/>No agentId persisted → must register

    RPi->>Authelia: Access sync.your-domain.com<br/>(authenticated via Lamaste identity)
    Authelia-->>RPi: Access granted

    RPi->>Tunnel: POST /api/sync/agents<br/>Authorization: Bearer <apiKey><br/>{name: "rpi-sync",<br/>hostname: "raspberrypi",<br/>os: "Linux",<br/>nodeVersion, agentVersion}
    Tunnel->>Sync: Forward request

    Note over Sync: Verify API key (SHA-256 + timingSafeEqual)<br/>Generate Sync agent token: agent_<32 hex bytes><br/>Store SHA-256 hash in ~/.sync/agents.json

    Sync-->>Tunnel: {ok,<br/>agent: {id, name, hostname, status},<br/>agentToken: "agent_..."}
    Tunnel-->>RPi: Forward response

    Note over RPi: Persist registration:<br/>Save agentId + agentToken<br/>to ~/.sync-agent/agent-settings.json<br/>(AES-256-GCM encrypted at rest)
```

After registration, the Sync agent starts its normal operation — fetching config, heartbeating, and syncing files:

```mermaid
sequenceDiagram
    participant RPi as Sync Agent (RPi)
    participant Tunnel as Lamaste Tunnel
    participant Sync as Sync Server (Mac)

    RPi->>Tunnel: GET /api/sync/agent-config<br/>Authorization: Bearer <apiKey>
    Tunnel->>Sync: Forward
    Note over Sync: Return projects, storage config,<br/>encryption passwords
    Sync-->>Tunnel: {ok, projects, storage, ...}
    Tunnel-->>RPi: Forward
    Note over RPi: Cache config encrypted at<br/>~/.sync-agent/cached-config.json

    loop Every 15 seconds
        RPi->>Tunnel: POST /api/sync/agents/<agentId>/heartbeat<br/>X-Agent-Token: agent_...<br/>{activeSyncs, diskUsage}
        Tunnel->>Sync: Forward
        Note over Sync: Verify token (SHA-256 + timingSafeEqual)<br/>Update agent status: online
        Sync-->>Tunnel: {ok}
        Tunnel-->>RPi: Forward
    end
```

The Sync agent now has three credentials:

| Credential                                                         | Purpose                                                                                   | Stored at                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Lamaste plugin-agent cert (`CN=plugin-agent:macbook-pro:rpi-sync`) | Authenticate with Authelia to access the tunnel; participate in the Lamaste ticket system | `~/.sync-agent/lamaste-cert/` (PEM files)                   |
| Sync API key (`Authorization: Bearer`)                             | Authenticate with the Sync server for config fetch and registration                       | `~/.sync-agent/agent-settings.json` (AES-256-GCM encrypted) |
| Sync agent token (`X-Agent-Token`)                                 | Authenticate with the Sync server for heartbeats and sync reports                         | `~/.sync-agent/agent-settings.json` (AES-256-GCM encrypted) |

### 10. Admin Grants Ticket Access

The delegated enrollment gives the Sync agent a Lamaste identity, but it still needs to be authorized in the ticket system. The admin assigns the `sync:connect` capability and creates a ticket assignment.

```mermaid
sequenceDiagram
    participant Admin as Admin (Panel UI)
    participant Panel as Lamaste Panel

    Admin->>Panel: PATCH /api/certs/agent/<br/>plugin-agent:macbook-pro:rpi-sync/capabilities<br/>{capabilities: ["sync:connect"]}
    Note over Panel: Update registry entry<br/>for plugin-agent
    Panel-->>Admin: {ok}

    Admin->>Panel: POST /api/tickets/assignments<br/>{agentLabel: "plugin-agent:macbook-pro:rpi-sync",<br/>instanceScope: "sync:connect:<instanceId>"}
    Note over Panel: Store assignment<br/>in ticket-scopes.json
    Panel-->>Admin: {ok}

    Note over Admin: Plugin-agent can now<br/>participate in sync:connect tickets
```

The plugin-agent cert starts with only the delegated scope capability (`sync:connect`). The admin can grant additional capabilities via the Certificates page if needed — this is a deliberate opt-in with minimal privilege as the default.

### 11. Ticket Authorization in Action

With both agents enrolled and the assignment in place, the ticket system authorizes file sync sessions. The Mac (source, instance owner) requests a ticket targeting the RPi's plugin-agent. The RPi polls its inbox, validates the ticket, and establishes a session with heartbeat-based re-validation.

```mermaid
sequenceDiagram
    participant Mac as Sync Server (Mac)<br/>SOURCE: owns instance
    participant Panel as Lamaste Panel
    participant RPi as Sync Agent (RPi)<br/>TARGET: assigned to instance

    Mac->>Panel: POST /api/tickets<br/>(mTLS: CN=agent:macbook-pro)<br/>{scope: "sync:connect",<br/>instanceId: "<id>",<br/>target: "plugin-agent:<br/>macbook-pro:rpi-sync"}
    Note over Panel: Rate limit (max 10/min per agent)<br/>Verify source exists, not revoked<br/>Verify source has sync:connect<br/>Verify target exists, not revoked<br/>Verify target has sync:connect<br/>Verify source owns instance (not stale)<br/>Verify source ≠ target<br/>Verify target assigned to instance<br/>Generate ticket (32 bytes, 30-sec TTL)
    Panel-->>Mac: {ok, ticket: {id, scope,<br/>instanceId, source, target, expiresAt}}

    RPi->>Panel: GET /api/tickets/inbox<br/>(mTLS: CN=plugin-agent:<br/>macbook-pro:rpi-sync)
    Panel-->>RPi: {tickets: [{id, scope,<br/>source, expiresAt}]}

    RPi->>Panel: POST /api/tickets/validate<br/>{ticketId: "<id>"}
    Note over Panel: HMAC-SHA256 timing-safe compare<br/>Verify not expired (30-sec TTL)<br/>Verify not already used<br/>Verify caller is target<br/>Mark ticket as used
    Panel-->>RPi: {valid: true, scope,<br/>instanceId, source, target, transport}

    RPi->>Panel: POST /api/tickets/sessions<br/>{ticketId: "<id>"}
    Note over Panel: Generate sessionId<br/>(16 bytes, server-side)<br/>Status: active
    Panel-->>RPi: {ok, session: {sessionId,<br/>scope, source, target,<br/>status: "active"}}

    loop Every 60 seconds
        RPi->>Panel: POST /api/tickets/sessions/<sessionId>/heartbeat
        Note over Panel: Re-validate:<br/>Source not revoked?<br/>Source has capability?<br/>Target not revoked?<br/>Target has capability?<br/>Assignment still valid?
        Panel-->>RPi: {authorized: true}
    end

    Mac<-->RPi: Sync session authorized — file sync proceeds
```

### Revocation Cascade

If the admin revokes the Mac's Lamaste agent cert (`CN=agent:macbook-pro`), the panel automatically cascade-revokes all plugin-agents delegated by that agent. The Sync agent's cert is revoked in the same atomic operation, and the next session heartbeat terminates the active sync session.

```mermaid
sequenceDiagram
    participant Admin
    participant Panel as Lamaste Panel
    participant RPi as Sync Agent (RPi)

    Admin->>Panel: DELETE /api/certs/agent/macbook-pro

    Note over Panel: Revoke agent:macbook-pro<br/>Add serial to revoked.json

    rect rgb(80, 40, 40)
        Note over Panel: Cascade revocation
        Note over Panel: Find all plugin-agents where<br/>delegatedBy = "macbook-pro"<br/>→ plugin-agent:macbook-pro:rpi-sync
        Note over Panel: Revoke each plugin-agent<br/>Add their serials to revoked.json<br/>Clean up cert files
    end

    Note over Panel: Save registry atomically
    Panel-->>Admin: {ok}

    Note over RPi: Next heartbeat...
    RPi->>Panel: POST /api/tickets/sessions/<sessionId>/heartbeat
    Note over Panel: Target cert is revoked
    Panel-->>RPi: {authorized: false,<br/>reason: "target_revoked"}
    Note over RPi: Session terminated<br/>Active syncs cancelled
```

### Standalone vs Tunneled Behavior

The delegated enrollment flow depends on whether the Sync server is reachable through a Lamaste tunnel or directly by IP:

| Access method                           | Lamaste cert?               | Ticket authorization                                                                                                                                       |
| --------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct IP (`192.168.1.x:port`)          | No — no Lamaste involvement | Sync server mediates tickets on behalf of its agents using its own cert. Two-party model collapses to single party. Sufficient for trusted local networks. |
| Lamaste tunnel (`sync.your-domain.com`) | Yes — delegated enrollment  | Each Sync agent has its own Lamaste identity (`CN=plugin-agent:...`). Full two-party ticket authorization with independent source and target identities.   |

When the Sync server detects it has a Lamaste agent cert, the admin can prepare agent enrollments that include delegated Lamaste tokens. When running standalone without a Lamaste agent, only the Sync API key is needed and ticket authorization is self-mediated.

```mermaid
flowchart TD
    A[Admin prepares<br/>new agent enrollment<br/>on Sync Server] --> B{Sync Server has<br/>Lamaste agent cert?}

    B -->|Yes| C[Tunneled Mode]
    B -->|No| D[Standalone Mode]

    C --> C1[1. Pre-announce to Lamaste panel<br/>POST /api/certs/agent/enroll-delegated]
    C1 --> C2[2. Admin gives RPi: API key +<br/>tunnel URL + delegated token + panel URL]
    C2 --> C3[3. RPi enrolls with Lamaste FIRST<br/>POST /api/enroll — public endpoint]
    C3 --> C4[4. RPi has Lamaste cert<br/>→ can access Authelia-protected tunnel]
    C4 --> C5[5. RPi registers with Sync server<br/>through the tunnel]
    C5 --> C6[Full two-party<br/>ticket authorization]

    D --> D1[1. Admin gives RPi:<br/>API key + server IP/URL]
    D1 --> D2[2. RPi registers with Sync server<br/>directly via IP]
    D2 --> D3[No Lamaste identity]
    D3 --> D4[Sync server self-mediates<br/>tickets using its own cert]

    style C fill:#1a3a2a,stroke:#4ade80
    style D fill:#3a2a1a,stroke:#fbbf24
    style C6 fill:#1a3a2a,stroke:#4ade80
    style D4 fill:#3a2a1a,stroke:#fbbf24
```

## Related Documentation

- [Tickets (Agent-to-Agent)](../01-concepts/tickets.md) — ticket system concepts and data model
- [mTLS & Client Certificates](../01-concepts/mtls.md) — certificate scoping and capabilities
- [Certificate Management](certificate-management.md) — managing agent certificates
