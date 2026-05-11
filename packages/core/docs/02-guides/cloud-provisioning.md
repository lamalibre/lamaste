# Cloud Provisioning

> Create a Lamaste server on DigitalOcean directly from the desktop app — no SSH, no terminal commands, no manual configuration.

## In Plain English

The traditional way to set up Lamaste involves SSH-ing into a VPS and running an installer command. Cloud provisioning eliminates all of that. You open the desktop app, paste a DigitalOcean API token, pick a region, and click a button. Five minutes later, you have a fully configured Lamaste server with your certificate already installed.

Behind the scenes, the app creates a droplet, installs Lamaste over SSH using a temporary key (which is deleted afterward), downloads your admin certificate, and stores your credentials securely in your operating system's credential store (macOS Keychain or Linux libsecret). You never see an SSH session, and no secrets are stored in plaintext files.

## Prerequisites

Before you start, make sure you have:

| Requirement               | Details                                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Desktop app installed** | `npx @lamalibre/create-lamaste-desktop` ([setup guide](desktop-app-setup.md))                                                                                     |
| **DigitalOcean account**  | A free account at [cloud.digitalocean.com](https://cloud.digitalocean.com). **If you have other infrastructure on DO, create a dedicated team first** (see below) |
| **Payment method**        | A credit card or PayPal on file in DigitalOcean (required to create droplets)                                                                                     |
| **Domain name**           | Optional for initial setup — you can add a domain later through the panel                                                                                         |

**Cost:** $4/month for the droplet (512MB RAM, 1 vCPU, 10GB SSD). This is the smallest DigitalOcean droplet and is all Lamaste needs.

---

## Step 1: Create a DigitalOcean API Token

Lamaste needs an API token to create and manage droplets on your behalf. The token must have exactly the right permissions — too few and provisioning fails, too many and the app rejects it for safety.

### Use a dedicated DigitalOcean team (strongly recommended)

DigitalOcean API tokens are account-wide — a token with `droplet:delete` can delete _any_ droplet in the account, not just ones created by Lamaste. While the app enforces a `lamalibre:managed` + `product:lamaste` tag check before destroying a droplet, that is an application-level guard. The token itself still has API-level access to all droplets.

**If you have other infrastructure on DigitalOcean (databases, Kubernetes clusters, production droplets, etc.), create a separate DigitalOcean team for Lamaste.** This is the only way to get true resource-level isolation:

1. Go to **Settings → Team** in the DigitalOcean console
2. Click **Create a Team**
3. Name it something like "Lamaste" and add your account
4. Switch to the new team context (top-left dropdown in the DO console)
5. Create the API token _within this team_

Tokens created in the Lamaste team can only see and manage resources that belong to that team. Even if the token were compromised, it could not touch any resources in your main account or other teams. This is the strongest isolation DigitalOcean offers and costs nothing extra.

> **If you are the only one using your DigitalOcean account and have no other infrastructure there, a separate team is optional.** The custom-scoped token described below is sufficient. But if there is anything else in the account you care about, use a team.

### Creating the token

1. Log in to [cloud.digitalocean.com](https://cloud.digitalocean.com)
2. **Switch to your Lamaste team** if you created one (top-left dropdown)
3. Go to **API** in the left sidebar (or navigate directly to [cloud.digitalocean.com/account/api/tokens](https://cloud.digitalocean.com/account/api/tokens))
4. Click **Generate New Token**
5. Give it a name you will recognize (e.g., "Lamaste Desktop")
6. Set the expiration to your preference (90 days is a good balance)
7. Under **Custom Scopes**, select these 5 resource groups:

| Resource group          | Scopes granted                                | Why Lamaste needs it                                                                 |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| **account**             | `read`                                        | Validate the token and display your account email                                    |
| **droplet**             | `create`, `read`, `update`, `delete`, `admin` | Create, monitor, and destroy the server                                              |
| **regions**             | `read`                                        | List available regions and measure latency                                           |
| **ssh_key**             | `create`, `read`, `update`, `delete`          | Upload a temporary SSH key for installation                                          |
| **tag**                 | `create`, `read`, `delete`                    | Tag managed droplets with `lamalibre:managed` + `product:lamaste`                    |
| **domain** _(optional)_ | `read`, `create`, `update`, `delete`          | Automatic DNS record creation (see [DNS Management](#dns-management-optional) below) |

> **Note:** DigitalOcean's custom scopes UI works at the resource level — you cannot select individual sub-scopes (e.g., `droplet:create` alone). Selecting "droplet" grants all 5 droplet sub-scopes. DO also auto-adds read-only dependency scopes (`sizes:read`, `actions:read`, `image:read`, `snapshot:read`, `vpc:read`). This is normal. Your token will show about 20 total scopes. The app expects this and will not reject these extra scopes — only scopes like `database:delete`, `kubernetes:create`, or `account:write` are rejected.
>
> **DNS scopes are optional.** If your token includes the **domain** resource group, the wizard adds a Domain step where you can select a DigitalOcean-managed domain and have A records created automatically. If the token does not have domain scopes, the wizard skips this step and you configure DNS manually after provisioning (the existing behavior).

8. Click **Generate Token**
9. **Copy the token immediately** — DigitalOcean only shows it once

> **Do not use a full-access token.** The app intentionally rejects tokens with dangerous scopes like `account:write`, `database:create`, `firewall:delete`, `kubernetes:create`, `volume:create`, etc. This is a safety measure — Lamaste should never have permission to touch your databases, Kubernetes clusters, or account settings. If you see a "dangerous excess scopes" warning, create a new token with only the 5 resource groups listed above.

### Isolation summary

The combination of a dedicated team and custom-scoped token provides two layers of isolation:

| Layer                                           | What it protects against                                   |
| ----------------------------------------------- | ---------------------------------------------------------- |
| **Dedicated team**                              | Token cannot see or touch resources outside the team       |
| **Custom scopes (5 groups)**                    | Token cannot manage databases, firewalls, Kubernetes, etc. |
| **`lamalibre:managed` + `product:lamaste` tag** | App-level guard: refuses to destroy untagged droplets      |
| **Dangerous scope rejection**                   | App rejects tokens that are overly broad                   |

### Where the token is stored

The token is stored in your operating system's credential store:

- **macOS:** Keychain (service: `com.lamalibre.cloud`)
- **Linux:** libsecret / GNOME Keyring (via `secret-tool`)

The token is never written to a file on disk and never passed as a command-line argument (which would be visible in process listings). When the app needs to use the token, it reads it from the credential store and passes it to the provisioning process via an environment variable.

---

## Step 2: Open the Server Wizard

1. Open the Lamaste desktop app
2. Navigate to the **Servers** tab (cloud icon in the sidebar)
3. Click **Create New Server** (or, if this is your first time and no servers exist, click the "Create a new server" button in the center of the page)

The wizard opens with an overview screen (shown once, dismissable) followed by steps in a breadcrumb bar: **Token → Region → Size → [Domain] → Label → Create**. The Domain step appears only if your token has DNS management scopes (the `domain` resource group).

---

## Step 3: Validate Your Token

1. Paste your DigitalOcean API token into the token field
   - If you previously saved a token, the field shows "Token saved in keychain" — you can leave it blank to reuse the saved token
2. Click **Validate**

The app checks three things:

- **Is the token valid?** — It calls the DigitalOcean API to verify the token works and reads your account email
- **Does it have all required scopes?** — All 5 required resource groups listed above must be present
- **Does it have dangerous scopes?** — Scopes like `account:write` or `database:delete` cause rejection

### What you will see

**If the token is valid:**

A green checkmark appears with your DigitalOcean account email. The **Next** button becomes active.

**If scopes are missing:**

A red message lists the missing scopes. Go back to DigitalOcean and create a new token with all 5 required resource groups.

**If dangerous scopes are detected:**

An amber warning lists the excess scopes. This means you used a full-access or overly broad token. Create a new token with custom scopes — only the 5 required resource groups listed above.

---

## Step 4: Choose a Region

After validating your token, click **Next**. The app fetches all DigitalOcean regions and measures the network latency from your machine to each one.

You will see a grid of region cards, each showing:

- **Region name** (e.g., Frankfurt 1, New York 1, Singapore 1)
- **Region slug** (e.g., `fra1`, `nyc1`, `sgp1`)
- **Latency** in milliseconds

The regions are sorted by latency — the fastest one is at the top and is auto-selected. Pick the region closest to your users (or closest to you, if you are the only user).

> **Tip:** If you are in Europe, `fra1` or `ams3` are usually the fastest. In the US, `nyc1`, `nyc3`, or `sfo3`. In Asia-Pacific, `sgp1` or `blr1`.

Only regions that support the minimum droplet size (`s-1vcpu-512mb-10gb`) are shown. If a region does not support this size, it is filtered out automatically. All shown regions also support larger sizes available in the Size step.

---

## Step 5: Select a Droplet Size

After choosing a region, the wizard shows available droplet sizes sorted by price. The recommended size ($4/month, 512MB RAM, 1 vCPU, 10GB SSD) is pre-selected and sufficient for most Lamaste deployments. Larger sizes are available if you need more resources.

Only basic-tier sizes available in your selected region are shown. AMD/Intel-specific variants are filtered out for simplicity.

---

## Step 6: Select a Domain (Optional — DNS Management)

This step appears only if your token includes the `domain` resource group. If it does not, the wizard skips directly to "Name Your Server."

When the Domain step appears, the app fetches your DigitalOcean-managed domains and displays them as selectable cards:

1. **Select a domain** — Click on a domain you already manage in DigitalOcean DNS
2. **Or create a new domain** — Click "Add a domain," enter the domain name, and click **Create**

> **Important:** If you create a new domain, you must point your domain's nameservers to DigitalOcean (`ns1.digitalocean.com`, `ns2.digitalocean.com`, `ns3.digitalocean.com`) at your domain registrar for DNS records to resolve.

3. **Optional subdomain prefix** — After selecting a domain, you can enter a subdomain prefix (e.g., `panel`). The resulting FQDN will be `panel.example.com`

The wizard shows a preview of the DNS records that will be created:

- **A record** — `panel.example.com` → droplet IP
- **Wildcard A record** — `*.panel.example.com` → droplet IP (for tunnel subdomains)

> **DNS records are not auto-removed** when the server is destroyed. You must remove them manually in the DigitalOcean DNS console.

### Conflict handling

If an A record already exists for the selected domain/subdomain:

- **Same IP** — No action needed, the record is already correct
- **Different IP** — The wizard warns you but does not overwrite. You must update the record manually

---

## Step 7: Name Your Server

Enter a label for your server. This is a short name used to identify the server in the app and on DigitalOcean.

**Rules:**

- Lowercase letters, numbers, and hyphens only
- Must start with a letter or number
- Maximum 64 characters

If you leave it blank, it defaults to `lamaste-{region}` (e.g., `lamaste-fra1`).

A summary box shows what will be created:

- **Size:** Your selected droplet size (e.g., 512MB RAM / 1 vCPU / 10GB SSD)
- **Image:** Ubuntu 24.04 LTS
- **Region:** Your selected region

Click **Create Server** to begin provisioning.

---

## Step 8: Watch the Provisioning

The wizard shows up to 12 steps with live progress indicators. Each step shows a spinning cyan icon while in progress, a green checkmark when complete, or a red X if something fails.

| Step                            | What happens                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Validating token**            | Re-verifies the API token (defense in depth)                                                                |
| **Generating SSH key**          | Creates a temporary ed25519 keypair (used only for this installation, then deleted)                         |
| **Uploading SSH key**           | Uploads the public key to your DigitalOcean account                                                         |
| **Creating droplet**            | Creates a droplet with the selected size, Ubuntu 24.04, and the `lamalibre:managed` + `product:lamaste` tag |
| **Waiting for boot**            | Polls DigitalOcean until the droplet has a public IP and is ready (up to 5 minutes)                         |
| **Setting up DNS records**      | Creates A and wildcard A records in DigitalOcean DNS (only if a domain was selected in the Domain step)     |
| **Connecting via SSH**          | Establishes an SSH connection using the temporary key                                                       |
| **Installing Lamaste**          | Runs `npx @lamalibre/create-lamaste` on the droplet (up to 10 minutes)                                      |
| **Retrieving credentials**      | Downloads the admin certificate (`.p12` file) from the droplet                                              |
| **Enrolling admin certificate** | Imports the certificate into your OS credential store                                                       |
| **Saving configuration**        | Writes the server entry to `~/.lamalibre/lamaste/servers.json`                                              |
| **Cleaning up**                 | Deletes the temporary SSH key from DigitalOcean and your machine                                            |

The entire process typically takes 3–5 minutes, depending on the region and network conditions.

> **Do not close the wizard during provisioning.** The close button is disabled while provisioning is in progress. If something goes wrong, the app automatically cleans up — destroying the droplet, removing the SSH key, and deleting temporary files.

### Certificate enrollment by platform

- **macOS:** The app generates a hardware-bound certificate in your Keychain. The private key is marked as non-extractable — it cannot be exported or copied. This is the most secure option.
- **Linux:** The app saves the `.p12` certificate file to `~/.lamalibre/lamaste/servers/{id}/client.p12`. The P12 password is stored in libsecret, not in any file.

### When provisioning completes

A green success message appears. Click **Done** to close the wizard. Your new server appears in the Servers list as the active server, and the app automatically connects to it.

### If provisioning fails

A red error message appears below the step that failed. The app runs cleanup automatically:

1. Destroys the droplet (if it was created)
2. Removes the SSH key from DigitalOcean (if it was uploaded)
3. Deletes local temporary files

You can click **Retry** to start over from the beginning, or close the wizard and try again later.

Common failure causes:

| Error                                         | Likely cause                                                   |
| --------------------------------------------- | -------------------------------------------------------------- |
| Token validation failed                       | Token expired or scopes changed since step 1                   |
| Droplet creation failed                       | DigitalOcean account limit reached or payment issue            |
| Timed out waiting for boot                    | Rare DigitalOcean infrastructure delay — retry usually works   |
| SSH connection failed                         | Firewall or network issue between your machine and the droplet |
| Installation failed                           | Transient npm registry issue — retry usually works             |
| Another provisioning operation is in progress | A previous provisioning attempt is still running               |

---

## After Provisioning

### What you have now

- A DigitalOcean droplet running Lamaste, accessible at `https://<ip>:9292`
- Your admin certificate installed in your OS credential store
- The server registered in the desktop app as the active server

### Next steps

1. **Complete onboarding** — Click the **Panel** button on the server card to open the admin panel in your browser. The onboarding wizard will walk you through setting up your domain and provisioning the tunnel stack (Chisel, Authelia, Let's Encrypt).

2. **Create your first tunnel** — After onboarding, go to the **Tunnels** tab in the desktop app to expose a local service.

3. **Discover services** — The **Services** tab auto-detects running services (Ollama, PostgreSQL, Docker containers, etc.) and lets you expose them with one click.

---

## Managing Multiple Servers

The desktop app supports managing multiple Lamaste servers from a single interface.

### Switching servers

Each server card shows a **Set Active** button. Click it to switch the app's active connection to that server. The switch is instant — the app reloads its configuration to point at the new server.

Only one server can be active at a time. The active server is indicated by a cyan "Active" badge on its card.

### Server health monitoring

Each server card shows an online/offline status indicator (green or red dot). The app checks server health every 30 seconds by pinging the panel's `/api/health` endpoint. If a server is offline, the dot turns red — this does not affect other servers.

### Opening the panel

Click the **Panel** button on any server card to open that server's admin panel in your browser. This works regardless of which server is currently active in the app.

---

## Adding an Existing Server

If you already have a Lamaste server set up (via the manual SSH method), you can add it to the desktop app without cloud provisioning.

1. Go to the **Servers** tab
2. Click **Add Existing Server** (from the dropdown or the empty-state button)
3. Enter the **Panel URL** (e.g., `https://203.0.113.42:9292`)
   - Must use HTTPS
   - Private/reserved IP addresses are blocked (localhost, 10.x, 192.168.x, etc.)
4. Optionally enter a **Label** (defaults to the hostname)
5. Click **Add Server**

The app checks that the panel is reachable before adding it. The server is added with `active: false` — click **Set Active** on its card to start using it.

> **Note:** Adding an existing server registers it in the app but does not configure authentication. You will still need to set up your agent certificate separately using `npx @lamalibre/lamaste-agent setup` or by importing a certificate manually.

---

## DNS Management (Optional)

If your DigitalOcean API token includes the `domain` resource group, the wizard can automatically manage DNS records during provisioning. This eliminates the need to manually create A records and configure DNS after server creation.

### What the wizard creates

During provisioning, after the droplet boots and receives a public IP, the wizard creates two A records:

| Record type | Name                            | Value      | TTL  |
| ----------- | ------------------------------- | ---------- | ---- |
| A           | `subdomain` (or `@` for apex)   | Droplet IP | 300s |
| A           | `*.subdomain` (or `*` for apex) | Droplet IP | 300s |

The wildcard record enables tunnel subdomains (e.g., `myapp.panel.example.com`) to resolve automatically.

### What the wizard does NOT do

- **Does not delete DNS records** when you destroy the server. You must clean them up manually in the DigitalOcean DNS console.
- **Does not overwrite existing records** that point to a different IP. If a conflict is detected, the wizard shows a warning and continues without modifying the existing record.
- **Does not configure nameservers** at your domain registrar. If you create a new domain in the wizard, you must point your NS records to DigitalOcean yourself.

### Fallback behavior

If your token does not have the `domain` resource group, the wizard behaves exactly as before — you enter a domain manually in the Label step (or skip it and configure DNS through the admin panel after provisioning).

---

## Destroying a Server

### Cloud-provisioned servers

For servers created through the app (with a DigitalOcean provider ID):

1. Click **Destroy** on the server card
2. Confirm by clicking **Yes** in the inline confirmation

This destroys the DigitalOcean droplet, removes the server from the registry, and deletes the stored credentials. The action is irreversible — all data on the droplet is permanently deleted.

> **Safety:** The app only destroys droplets tagged with `lamalibre:managed` + `product:lamaste`. If you manually removed this tag from the droplet in the DigitalOcean console, the destroy command will refuse to proceed. In that case, delete the droplet manually in the DigitalOcean console and use **Remove** in the app to clean up the registry entry.

### Manually added servers

For servers added via "Add Existing Server" (no provider ID):

1. Click **Remove** on the server card
2. Confirm by clicking **Yes**

This only removes the server from the desktop app's registry. The actual server is not affected — it continues running. Stored credentials for the server are cleaned up from the OS credential store.

---

## Credential Storage Reference

All sensitive credentials are stored in your operating system's credential store, never in plaintext files:

| Credential                | Service name                   | Key            | Platform                         |
| ------------------------- | ------------------------------ | -------------- | -------------------------------- |
| DigitalOcean API token    | `com.lamalibre.cloud`          | `digitalocean` | macOS Keychain / Linux libsecret |
| P12 password (per server) | `com.lamalibre.lamaste.server` | Server UUID    | macOS Keychain / Linux libsecret |

On macOS, the `security-framework` Rust crate accesses the Keychain directly (no CLI, no process listing exposure). On Linux, `secret-tool` is used with secrets passed via stdin.

---

## Quick Reference

| Action                    | How                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Create new server**     | Servers tab → Create New Server → wizard                                                                      |
| **Add existing server**   | Servers tab → Add Existing Server → enter URL                                                                 |
| **Switch active server**  | Click "Set Active" on server card                                                                             |
| **Open admin panel**      | Click "Panel" on server card                                                                                  |
| **Destroy cloud server**  | Click "Destroy" on server card → confirm                                                                      |
| **Remove managed server** | Click "Remove" on server card → confirm                                                                       |
| **Server registry file**  | `~/.lamalibre/lamaste/servers.json`                                                                           |
| **Token storage**         | OS credential store (`com.lamalibre.cloud`)                                                                   |
| **Required DO scopes**    | `account:read`, `droplet:create/read/delete`, `ssh_key:create/read/delete`, `tag:create/read`, `regions:read` |
| **Optional DO scopes**    | `domain:read/create/update/delete` (enables automatic DNS record creation)                                    |

### Related Documentation

- [Desktop App Setup](desktop-app-setup.md) — installing and configuring the desktop app
- [Quick Start](../00-introduction/quickstart.md) — manual server setup via SSH
- [Certificate Management](certificate-management.md) — generating and managing certificates
- [First Tunnel](first-tunnel.md) — creating your first tunnel after server setup
