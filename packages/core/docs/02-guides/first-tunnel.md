# Creating Your First Tunnel

> Expose a local web app to the internet through Lamaste in under 5 minutes.

## In Plain English

A tunnel connects a web app running on your local machine (behind your home router or office firewall) to a public URL on your Lamaste server. Visitors go to `app.example.com`, and Lamaste forwards the request through a secure WebSocket tunnel to your machine, which serves the response. Your app never leaves your machine — only the traffic flows through the relay.

## Prerequisites

- A completed [Lamaste onboarding](onboarding.md) with your domain configured
- A **web app running locally** on your machine (macOS or Linux) on a port between 1024 and 65535
- That machine **enrolled as an agent** — with the [Desktop App](desktop-app-setup.md) or `lamaste-agent setup` (see [Agent Setup](agent-setup.md)). Every tunnel is carried by exactly one agent, so the agent must exist before its tunnel

For this guide, assume you have a web app running on `http://localhost:3000`.

## Step-by-Step

### 1. Open the Tunnels Page

Log in to the Lamaste admin panel at `https://panel.example.com` (or `https://<ip>:9292`).

Click **Tunnels** in the sidebar navigation.

You see an empty state: "No tunnels configured. Create your first tunnel to get started."

### 2. Click Add Tunnel

Click the **Add Tunnel** button in the top right corner.

A form appears with these fields:

| Field                          | Description                                                        | Example               |
| ------------------------------ | ------------------------------------------------------------------ | --------------------- |
| **Subdomain**                  | The subdomain for your tunnel's public URL                         | `app`                 |
| **Port**                       | The port your app listens on, on the agent                         | `3000`                |
| **Agent**                      | The enrolled agent that carries the tunnel (required)              | `laptop`              |
| **Largest request body (MiB)** | Biggest upload nginx accepts for this tunnel (1–10240, default 10) | `10`                  |
| **Description**                | Optional note for your reference                                   | `My React dev server` |
| **Access**                     | Restricted (default), All Authelia Users, or Public                | Restricted            |

### 3. Fill in the Form

Enter a subdomain name. This becomes the public URL: if your domain is `example.com` and you enter `app`, the tunnel URL is `app.example.com`.

Subdomain rules:

- Lowercase letters, numbers, and hyphens only
- Cannot start or end with a hyphen
- Maximum 63 characters
- Cannot use reserved names: `panel`, `auth`, `tunnel`, `www`, `mail`, `ftp`, `api`
- Cannot start with `agent-` (this prefix is reserved for agent panel tunnels)

Enter the port number. This is the port your web app listens on, on `127.0.0.1` of the agent machine. Must be between 1024 and 65535, and unique across all tunnels (Chisel binds the same port on the server). Ports 3100, 9090, 9091, 9292 and 9294 are refused: they belong to Lamaste's own services on the server, and a tunnel on one of them would publish that service.

Pick the **Agent** that runs the app. Only that agent is told about the tunnel, and only that agent's Chisel credential may open its port on the server — another agent cannot take over the hostname.

Leave **Largest request body** at 10 MiB unless the app takes larger uploads; requests above the limit get HTTP 413. Optionally add a description to help you remember what this tunnel is for.

### 4. Create the Tunnel

Click **Add Tunnel**.

The panel performs four operations in sequence:

1. **Issues a TLS certificate** — Runs certbot to get a Let's Encrypt certificate for `app.example.com`. This takes a few seconds.
2. **Writes an nginx vhost** — Creates a reverse proxy configuration that forwards `app.example.com` traffic through Gatekeeper/Authelia (unless the tunnel is public) to `127.0.0.1:3000`, with the tunnel's `client_max_body_size`.
3. **Saves the tunnel** — Writes the tunnel record, including its `agentLabel`, to `/etc/lamalibre/lamaste/tunnels.json`.
4. **Syncs Chisel** — Re-renders the Chisel authfile from the saved state so the carrying agent — and only that agent — may bind the port. Chisel picks up the added grant without a restart, so other tunnels are not interrupted.

When all four steps succeed, the new tunnel appears in the list with its subdomain, FQDN, port, agent, access mode, and body limit.

**If something goes wrong:** The panel rolls back completed steps. If nginx configuration fails, the certificate is left in place (harmless). If saving the state or the Chisel sync fails, the tunnel is removed from the state and the nginx vhost is removed. You see an error message describing what went wrong.

### 5. Wait for the Agent (about 30 seconds)

The server now accepts the port from the carrying agent. The agent picks the tunnel up by itself: its sync timer asks the panel for its tunnel configuration (`GET /api/tunnels/agent-config`) every 30 seconds, rewrites its Chisel service (launchd on macOS, a systemd user unit on Linux) when the set changed, and restarts it — or starts it, if this is the agent's first tunnel. To apply the change at once, run on the agent machine:

```bash
lamaste-agent update
```

The same happens for every later change — a deleted or disabled tunnel, or one moved to or from this agent. `lamaste-agent status` shows the last sync on its **Sync** line.

### 6. Verify the Tunnel

Once the agent has picked up the tunnel, test your tunnel:

1. Make sure your local app is running on the configured port (e.g., `http://localhost:3000`).
2. Open `https://app.example.com` in a new browser window (or incognito).
3. Authelia redirects you to the login page at `auth.example.com`.
4. Enter your Authelia username and password.
5. Enter your TOTP code from your authenticator app.
6. After authentication, you see your local app.

**Expected behavior:** The first visit takes a moment because Authelia intercepts the request for authentication. After logging in, subsequent requests flow through quickly. Authelia sets a session cookie, so you do not need to re-authenticate for each page load.

### 7. Share Access with Users

By default a tunnel is **Restricted**: a visitor needs an Authelia account and a grant for this tunnel. To let someone else access the tunnel:

1. Go to the **Users** page in the panel.
2. Create a new user with a username, display name, email, and password.
3. Grant the user (or a group they belong to) access to the tunnel — see [Authorization](../01-concepts/authorization.md). Tunnels set to **All Authelia Users** skip this step.
4. Share the credentials and the tunnel URL with the person.
5. On their first login, they set up TOTP with their own authenticator app.

See [Managing Users](managing-users.md) for the full guide.

## For Developers

### Tunnel Data Model

Each tunnel is stored as a JSON object in `/etc/lamalibre/lamaste/tunnels.json`:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "subdomain": "app",
  "fqdn": "app.example.com",
  "port": 3000,
  "description": "My React dev server",
  "type": "app",
  "accessMode": "restricted",
  "agentLabel": "laptop",
  "maxBodySizeMb": 10,
  "enabled": true,
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

`agentLabel` is the carrying agent. `maxBodySizeMb` becomes the vhost's `client_max_body_size`; tunnels created before the setting existed have no value and keep nginx's built-in 1 MiB until a body limit is set on them.

### API Endpoints

| Method   | Path                        | Purpose                                                                |
| -------- | --------------------------- | ---------------------------------------------------------------------- |
| `GET`    | `/api/tunnels`              | List tunnels, newest first (an agent sees only its own)                |
| `POST`   | `/api/tunnels`              | Create a tunnel (certbot + nginx + state + chisel)                     |
| `PATCH`  | `/api/tunnels/:id`          | Enable/disable, move to another agent, change access mode or body size |
| `DELETE` | `/api/tunnels/:id`          | Remove a tunnel (nginx + state + chisel)                               |
| `GET`    | `/api/tunnels/agent-config` | One agent's Chisel client configuration (used by `lamaste-agent`)      |

See the [Tunnels API](../04-api-reference/tunnels.md) for the full reference.

### Create Tunnel Request

```json
POST /api/tunnels
{
  "subdomain": "app",
  "port": 3000,
  "agentLabel": "laptop",
  "description": "My React dev server"
}
```

Validation rules (Zod schema):

- `subdomain`: lowercase alphanumeric with hyphens, max 63 chars, not reserved, not already served by a static site or site alias
- `port`: integer between 1024 and 65535, unique across tunnels
- `agentLabel`: an enrolled, non-revoked agent — required for admin certificates; an agent certificate defaults to itself and may not name another agent
- `accessMode`: `restricted` (default), `authenticated`, or `public` — the last two admin-only
- `maxBodySizeMb`: optional integer 1–10240, default 10
- `description`: optional, max 200 characters

### nginx Vhost Structure

Each tunnel gets a vhost that:

1. Terminates TLS with a Let's Encrypt certificate
2. Sends an auth subrequest to Authelia (`auth_request /authelia`)
3. Proxies authenticated traffic to `127.0.0.1:<tunnel-port>`

The Chisel server on the VPS accepts a reverse tunnel for the port only from the carrying agent — its authfile grants each `agent-<label>` user exactly `^R:127\.0\.0\.1:<port>$` for the enabled tunnels it owns — and forwards traffic to that agent.

### Traffic Flow

```
Browser → app.example.com:443
  → nginx (TLS termination)
    → Authelia auth_request (checks session cookie / prompts login)
    → proxy_pass 127.0.0.1:3000
      → Chisel server (reverse tunnel)
        → Chisel client (on your machine)
          → localhost:3000 (your app)
```

### Agent Service

`lamaste-agent setup`, `update` and the 30-second sync timer render the Chisel client service from the `chiselArgs` returned by `GET /api/tunnels/agent-config` (implementation: `packages/core/lib/src/agent/converge.ts` and `chisel-service.ts`, shared by the CLI and `lamaste-agentd`). The service:

- Runs `chisel client --max-retry-interval 30s https://tunnel.example.com:443` and verifies the server's Let's Encrypt certificate — no `--tls-skip-verify`. The server URL must be `tunnel.<the domain the agent enrolled with>`
- Is stopped while the agent carries no tunnels (Chisel cannot run without a remote), and while the operator has stopped it
- Adds a `R:127.0.0.1:<port>:127.0.0.1:<port>` argument for each tunnel the agent carries
- Reads its credential from the environment (`AUTH=`), never from argv: the 0600 `chisel.env` on Linux, the 0600 plist's `EnvironmentVariables` on macOS
- Restarts automatically (`KeepAlive` on macOS, `Restart=always` on Linux)

### Deletion Rollback

When deleting a tunnel, the panel removes components in order:

1. Remove the nginx vhost and reload
2. Remove the tunnel from `tunnels.json`
3. Sync Chisel — the authfile is re-rendered without the owner's grant for the port, and Chisel restarts so live sessions drop it. The owner's sync timer stops asking for the port within about 30 seconds (until then Chisel refuses the owner's session, so its other tunnels are briefly down too)

The TLS certificate is left in place (certbot manages its lifecycle).

## Quick Reference

| Action                 | How                                                         |
| ---------------------- | ----------------------------------------------------------- |
| **Create tunnel**      | Tunnels page, "Add Tunnel" button                           |
| **Delete tunnel**      | Click delete icon on the tunnel row                         |
| **Move / reconfigure** | "Edit" on the tunnel row (agent, access mode, body limit)   |
| **Enable / disable**   | Toggle on the tunnel row                                    |
| **View tunnel URL**    | Click the domain link on the tunnel row                     |
| **Update client**      | Automatic within ~30 s; `lamaste-agent update` to apply now |

| Constraint           | Value                                           |
| -------------------- | ----------------------------------------------- |
| Subdomain format     | `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`               |
| Port range           | 1024-65535, except 3100, 9090, 9091, 9292, 9294 |
| Max subdomain length | 63 characters                                   |
| Reserved subdomains  | panel, auth, tunnel, www, mail, ftp, api        |
| Reserved prefix      | `agent-` (used by agent panel tunnels)          |
| Unique port          | Yes (one tunnel per port)                       |
| Unique subdomain     | Yes (one tunnel per subdomain)                  |
| Carrying agent       | Exactly one (`agentLabel`)                      |
| Request body limit   | 1-10240 MiB (agents: up to 100), default 10     |
