# Creating Your First Tunnel

> Expose a local web app to the internet through Portlama in under 5 minutes.

## In Plain English

A tunnel connects a web app running on your local machine (behind your home router or office firewall) to a public URL on your Portlama server. Visitors go to `app.example.com`, and Portlama forwards the request through a secure WebSocket tunnel to your Mac, which serves the response. Your app never leaves your machine — only the traffic flows through the relay.

## Prerequisites

- A completed [Portlama onboarding](onboarding.md) with your domain configured
- A **web app running locally** on your Mac (or any machine) on a port between 1024 and 65535
- The **Chisel client** installed on your Mac (see [Mac Client Setup](mac-client-setup.md) for installation)

For this guide, assume you have a web app running on `http://localhost:3000`.

## Step-by-Step

### 1. Open the Tunnels Page

Log in to the Portlama admin panel at `https://panel.example.com` (or `https://<ip>:9292`).

Click **Tunnels** in the sidebar navigation.

You see an empty state: "No tunnels configured. Create your first tunnel to get started."

### 2. Click Add Tunnel

Click the **Add Tunnel** button in the top right corner.

A form appears with three fields:

| Field | Description | Example |
|-------|-------------|---------|
| **Subdomain** | The subdomain for your tunnel's public URL | `app` |
| **Port** | The local port your app runs on | `3000` |
| **Description** | Optional note for your reference | `My React dev server` |

### 3. Fill in the Form

Enter a subdomain name. This becomes the public URL: if your domain is `example.com` and you enter `app`, the tunnel URL is `app.example.com`.

Subdomain rules:
- Lowercase letters, numbers, and hyphens only
- Cannot start or end with a hyphen
- Maximum 63 characters
- Cannot use reserved names: `panel`, `auth`, `tunnel`, `www`, `mail`, `ftp`, `api`

Enter the port number. This is the local port your web app listens on. Must be between 1024 and 65535.

Optionally add a description to help you remember what this tunnel is for.

### 4. Create the Tunnel

Click **Create Tunnel**.

The panel performs four operations in sequence:

1. **Issues a TLS certificate** — Runs certbot to get a Let's Encrypt certificate for `app.example.com`. This takes a few seconds.
2. **Writes an nginx vhost** — Creates a reverse proxy configuration that forwards `app.example.com` traffic through Authelia (for 2FA) and then to the Chisel tunnel port.
3. **Updates Chisel configuration** — Adds the port mapping to the Chisel server so it knows to accept reverse tunnels on this port.
4. **Saves the tunnel** — Writes the tunnel record to `/etc/portlama/tunnels.json`.

When all four steps succeed, the new tunnel appears in the list with its subdomain, port, FQDN, and creation date.

**If something goes wrong:** The panel rolls back completed steps. If nginx configuration fails, the certificate is left in place (harmless). If Chisel reconfiguration fails, the nginx vhost is removed. You see an error message describing what went wrong.

### 5. Update the Chisel Client on Your Mac

After creating a tunnel, you need to update the Chisel client configuration on your Mac to include the new port mapping.

Click the **Download Mac Plist** button at the top of the tunnels page. This downloads a `com.portlama.chisel.plist` file containing all current tunnel port mappings.

If you already have the Chisel client running, update it:

```bash
# Unload the current configuration
launchctl unload ~/Library/LaunchAgents/com.portlama.chisel.plist

# Replace with the new plist
mv ~/Downloads/com.portlama.chisel.plist ~/Library/LaunchAgents/

# Load the updated configuration
launchctl load ~/Library/LaunchAgents/com.portlama.chisel.plist
```

If this is your first tunnel, see [Mac Client Setup](mac-client-setup.md) for the complete Chisel installation guide.

### 6. Verify the Tunnel

Once the Chisel client is running with the updated plist, test your tunnel:

1. Make sure your local app is running on the configured port (e.g., `http://localhost:3000`).
2. Open `https://app.example.com` in a new browser window (or incognito).
3. Authelia redirects you to the login page at `auth.example.com`.
4. Enter your Authelia username and password.
5. Enter your TOTP code from your authenticator app.
6. After authentication, you see your local app.

**Expected behavior:** The first visit takes a moment because Authelia intercepts the request for authentication. After logging in, subsequent requests flow through quickly. Authelia sets a session cookie, so you do not need to re-authenticate for each page load.

### 7. Share Access with Users

By default, only users with Authelia accounts can access your tunneled apps. To let someone else access the tunnel:

1. Go to the **Users** page in the panel.
2. Create a new user with a username, display name, email, and password.
3. Share the credentials and the tunnel URL with the person.
4. On their first login, they set up TOTP with their own authenticator app.

See [Managing Users](managing-users.md) for the full guide.

## For Developers

### Tunnel Data Model

Each tunnel is stored as a JSON object in `/etc/portlama/tunnels.json`:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "subdomain": "app",
  "fqdn": "app.example.com",
  "port": 3000,
  "description": "My React dev server",
  "enabled": true,
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/tunnels` | List all tunnels (sorted by createdAt descending) |
| `POST` | `/api/tunnels` | Create a tunnel (certbot + nginx + chisel + state) |
| `DELETE` | `/api/tunnels/:id` | Remove a tunnel (nginx + chisel + state) |
| `GET` | `/api/tunnels/mac-plist` | Download launchd plist for Chisel client |

### Create Tunnel Request

```json
POST /api/tunnels
{
  "subdomain": "app",
  "port": 3000,
  "description": "My React dev server"
}
```

Validation rules (Zod schema):
- `subdomain`: lowercase alphanumeric with hyphens, max 63 chars, not reserved
- `port`: integer between 1024 and 65535, unique across tunnels
- `description`: optional, max 200 characters

### nginx Vhost Structure

Each tunnel gets a vhost that:
1. Terminates TLS with a Let's Encrypt certificate
2. Sends an auth subrequest to Authelia (`auth_request /authelia`)
3. Proxies authenticated traffic to `127.0.0.1:<tunnel-port>`

The Chisel server on the VPS accepts reverse tunnels from the Mac client and forwards traffic to the corresponding port on `127.0.0.1`.

### Traffic Flow

```
Browser → app.example.com:443
  → nginx (TLS termination)
    → Authelia auth_request (checks session cookie / prompts login)
    → proxy_pass 127.0.0.1:3000
      → Chisel server (reverse tunnel)
        → Chisel client (on your Mac)
          → localhost:3000 (your app)
```

### Plist Generation

The Mac plist is generated by `packages/panel-server/src/lib/plist.js`. It creates a launchd configuration that:

- Runs `/usr/local/bin/chisel client --tls-skip-verify https://tunnel.example.com:443`
- Adds a `R:127.0.0.1:<port>:127.0.0.1:<port>` argument for each tunnel
- Sets `KeepAlive` and `RunAtLoad` to `true` for auto-reconnect
- Logs to `/usr/local/var/log/chisel.log` and `/usr/local/var/log/chisel.error.log`

### Deletion Rollback

When deleting a tunnel, the panel removes components in order:
1. Remove the nginx vhost and reload
2. Update the Chisel server configuration (remove port mapping)
3. Remove the tunnel from `tunnels.json`

The TLS certificate is left in place (certbot manages its lifecycle).

## Quick Reference

| Action | How |
|--------|-----|
| **Create tunnel** | Tunnels page, "Add Tunnel" button |
| **Delete tunnel** | Click delete icon on the tunnel row |
| **Download plist** | "Download Mac Plist" button on Tunnels page |
| **View tunnel URL** | Click the domain link on the tunnel row |
| **Update client** | Re-download plist, reload launchd |

| Constraint | Value |
|------------|-------|
| Subdomain format | `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` |
| Port range | 1024-65535 |
| Max subdomain length | 63 characters |
| Reserved subdomains | panel, auth, tunnel, www, mail, ftp, api |
| Unique port | Yes (one tunnel per port) |
| Unique subdomain | Yes (one tunnel per subdomain) |
