# Mac Client Setup

> Install and configure the Chisel tunnel client on your Mac so local apps are accessible through Portlama.

## In Plain English

Your Portlama server is a relay — but it needs something on your Mac to connect to it and forward traffic. That something is the Chisel client, a small program that establishes a secure WebSocket connection from your Mac to your server. Once connected, any web app running on your Mac becomes accessible through your Portlama domain.

The Chisel client runs as a background service using macOS launchd. It starts automatically when you log in, reconnects if the connection drops, and requires no interaction after the initial setup.

## Prerequisites

- A completed [Portlama onboarding](onboarding.md) with at least one [tunnel created](first-tunnel.md)
- A **Mac** running macOS 12 (Monterey) or later
- **Homebrew** installed ([brew.sh](https://brew.sh))
- An **agent certificate** (`.p12` file and password) — ask your Portlama admin to generate one from the panel (Certificates page, Agent Certificates section). See [Certificate Management](certificate-management.md#agent-certificates) for details.

> **Do not use the admin certificate on Mac clients.** The admin certificate has unrestricted access to all panel endpoints. If the Mac is compromised, an attacker would have full admin control. Agent certificates limit access to only the capabilities the agent needs (e.g., listing tunnels and downloading the plist).

## Step-by-Step

### 1. Install Chisel

Open Terminal and install Chisel via Homebrew:

```bash
brew install chisel
```

Verify the installation:

```bash
chisel --version
```

**Expected output:**

```
chisel 1.x.x (go1.x.x)
```

If Homebrew is not available, download the binary directly from [github.com/jpillora/chisel/releases](https://github.com/jpillora/chisel/releases). Download the `chisel_x.x.x_darwin_arm64.gz` file (for Apple Silicon) or `chisel_x.x.x_darwin_amd64.gz` (for Intel Macs), decompress it, and move it to `/usr/local/bin/`:

```bash
# Example for Apple Silicon
gunzip chisel_x.x.x_darwin_arm64.gz
chmod +x chisel_x.x.x_darwin_arm64
sudo mv chisel_x.x.x_darwin_arm64 /usr/local/bin/chisel
```

### 2. Download the Launchd Plist

The Portlama panel generates a launchd plist file configured with all your current tunnel port mappings.

**Option A — Download from the panel UI:**

1. Log in to the Portlama panel.
2. Go to the **Tunnels** page.
3. Click the **Download Mac Plist** button.
4. Save the file `com.portlama.chisel.plist`.

**Option B — Download via curl using your agent certificate:**

```bash
curl -k --cert-type P12 --cert macbook-pro.p12:<password> \
  https://203.0.113.42:9292/api/tunnels/mac-plist \
  -o com.portlama.chisel.plist
```

### 3. Review the Plist

Before installing, inspect the plist to verify it matches your tunnel configuration:

```bash
cat com.portlama.chisel.plist
```

**Expected content:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.portlama.chisel</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/chisel</string>
        <string>client</string>
        <string>--tls-skip-verify</string>
        <string>https://tunnel.example.com:443</string>
        <string>R:127.0.0.1:3000:127.0.0.1:3000</string>
    </array>

    <key>KeepAlive</key>
    <true/>

    <key>RunAtLoad</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/usr/local/var/log/chisel.log</string>

    <key>StandardErrorPath</key>
    <string>/usr/local/var/log/chisel.error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
```

Key elements:
- **Label:** `com.portlama.chisel` — the launchd service identifier
- **ProgramArguments:** The Chisel binary, `client` mode, `--tls-skip-verify` flag, the server URL (`https://tunnel.example.com:443`), and one `R:` (reverse tunnel) line per configured tunnel
- **KeepAlive:** The client restarts automatically if it crashes
- **RunAtLoad:** The client starts when you log in
- **Log paths:** Standard output and error go to `/usr/local/var/log/`

Each `R:127.0.0.1:<port>:127.0.0.1:<port>` line means: "Accept connections on the server at `127.0.0.1:<port>` and forward them to `localhost:<port>` on this Mac."

### 4. Create the Log Directory

Ensure the log directory exists:

```bash
mkdir -p /usr/local/var/log
```

### 5. Install the Plist

Copy the plist to the LaunchAgents directory:

```bash
cp com.portlama.chisel.plist ~/Library/LaunchAgents/
```

Load the service:

```bash
launchctl load ~/Library/LaunchAgents/com.portlama.chisel.plist
```

The Chisel client starts immediately and connects to your Portlama server.

### 6. Verify the Connection

Check that the service is running:

```bash
launchctl list | grep chisel
```

**Expected output:**

```
-	0	com.portlama.chisel
```

The three columns are: PID (or `-` if recently started), last exit status (0 means success), and label.

Check the log for a successful connection:

```bash
tail -20 /usr/local/var/log/chisel.log
```

**Expected output (success):**

```
2024/01/15 10:30:00 client: Connecting to wss://tunnel.example.com:443
2024/01/15 10:30:01 client: Connected (Latency 45ms)
```

If the log shows the client connected, your tunnels are active. Test by visiting `https://app.example.com` (replacing with your actual tunnel subdomain).

### 7. Test a Tunnel

1. Start your local web app if it is not already running:

```bash
# Example: a simple HTTP server on port 3000
npx serve -l 3000
```

2. Open `https://app.example.com` in your browser.
3. Log in through Authelia with your username, password, and TOTP code.
4. You see your local app served through the tunnel.

## Static Site Management

If your agent certificate includes `sites:read` and `sites:write` capabilities, you can also manage static sites and deploy files directly from the command line. See the [Static Sites guide](static-sites.md) for details.

## Troubleshooting

### Connection refused or timeout

**Symptom:** The Chisel log shows connection errors or the browser times out.

**Check the tunnel server URL:** Open the plist and verify the server URL matches your domain: `https://tunnel.example.com:443`. If your domain changed, download a fresh plist from the panel.

**Check DNS resolution:**
```bash
dig tunnel.example.com
```
The result should show your server's IP address.

**Check if port 443 is reachable:**
```bash
curl -I https://tunnel.example.com
```

### Service fails to start

**Symptom:** `launchctl list | grep chisel` shows no output or a non-zero exit status.

**Check if Chisel is installed:**
```bash
which chisel
```
If not found, install it per step 1.

**Check the error log:**
```bash
cat /usr/local/var/log/chisel.error.log
```

**Common errors:**
- `exec: "/usr/local/bin/chisel": no such file or directory` — Chisel is not installed or is at a different path. Verify with `which chisel` and update the plist if needed.
- `bind: address already in use` — Another process is using the tunnel port locally. This is unusual since Chisel uses outbound connections, but check with `lsof -i :<port>`.

### Tunnel works but app shows "502 Bad Gateway"

**Symptom:** The browser shows a 502 error after authenticating through Authelia.

**Your local app is not running.** Start your app on the configured port. Chisel forwards traffic to `localhost:<port>` — if nothing is listening, nginx gets a connection error and returns 502.

### After adding a new tunnel, it does not work

**Symptom:** New tunnel shows in the panel but the browser cannot reach it.

**You need to update the Chisel client plist.** The client only knows about the tunnels that were in the plist when it started. Download a new plist and reload:

```bash
launchctl unload ~/Library/LaunchAgents/com.portlama.chisel.plist
# Download or copy the new plist to ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.portlama.chisel.plist
```

### Reconnection after network change

**Symptom:** Tunnel stops working after switching Wi-Fi networks or waking from sleep.

Chisel has built-in reconnection. The `KeepAlive` setting in the plist ensures launchd restarts the process if it exits. However, reconnection can take a few seconds. Check the log:

```bash
tail -5 /usr/local/var/log/chisel.log
```

If you see `client: Disconnected` followed by `client: Connected`, the reconnection worked. If the client is stuck, force a restart:

```bash
launchctl unload ~/Library/LaunchAgents/com.portlama.chisel.plist
launchctl load ~/Library/LaunchAgents/com.portlama.chisel.plist
```

## For Developers

### Plist Generation

The plist is generated server-side by `packages/panel-server/src/lib/plist.js`. The `generatePlist()` function takes the current tunnel list and domain, and produces a complete XML plist.

The `GET /api/tunnels/mac-plist` endpoint serves the plist in two formats:
- Default: `application/x-plist` with `Content-Disposition: attachment` (direct download)
- With `?format=json`: Returns the plist content as a JSON string along with installation instructions

### Chisel Reverse Tunnel Protocol

Each `R:127.0.0.1:<port>:127.0.0.1:<port>` argument tells the Chisel client to:

1. Connect to the server via HTTPS (`https://tunnel.example.com:443`)
2. Request the server to listen on `127.0.0.1:<port>`
3. When the server receives a connection on that port, forward it through the WebSocket tunnel
4. The client delivers the traffic to `127.0.0.1:<port>` on the Mac

The `127.0.0.1` on the server side restricts the listening address to localhost only, which is correct because nginx proxies to `127.0.0.1:<port>` on the VPS. The `--tls-skip-verify` flag is included because the tunnel endpoint uses a certificate that may not match the Chisel client's expectations.

### Launchd vs. System Service

The plist installs as a **user agent** (in `~/Library/LaunchAgents/`), not a system daemon. This means:
- It runs under your user account
- It starts when you log in (not at boot)
- It has access to your user's network and filesystem
- No `sudo` is required to install or manage it

For a system-level service that runs at boot, the plist would go to `/Library/LaunchDaemons/` and require `sudo`. This is not recommended for most users.

## Quick Reference

| Action | Command |
|--------|---------|
| **Install Chisel** | `brew install chisel` |
| **Install plist** | `cp com.portlama.chisel.plist ~/Library/LaunchAgents/` |
| **Start client** | `launchctl load ~/Library/LaunchAgents/com.portlama.chisel.plist` |
| **Stop client** | `launchctl unload ~/Library/LaunchAgents/com.portlama.chisel.plist` |
| **Restart client** | Unload then load |
| **Check status** | `launchctl list \| grep chisel` |
| **View logs** | `tail -f /usr/local/var/log/chisel.log` |
| **View errors** | `cat /usr/local/var/log/chisel.error.log` |

| File | Path |
|------|------|
| **Plist** | `~/Library/LaunchAgents/com.portlama.chisel.plist` |
| **Chisel binary** | `/usr/local/bin/chisel` |
| **Standard log** | `/usr/local/var/log/chisel.log` |
| **Error log** | `/usr/local/var/log/chisel.error.log` |

| Plist Key | Value | Meaning |
|-----------|-------|---------|
| `Label` | `com.portlama.chisel` | Service identifier |
| `KeepAlive` | `true` | Restart on crash |
| `RunAtLoad` | `true` | Start on login |
