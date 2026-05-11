# Static Sites

> Host static websites, landing pages, and single-page applications through Lamaste without a tunnel.

## In Plain English

Not everything needs a tunnel. If you have a static website — a marketing page, a blog built with a static site generator, or a single-page application — you can host it directly on your Lamaste server. Upload your files through the panel, and they are served via nginx with a Let's Encrypt certificate. No local machine needed, no Chisel client required.

Static sites come in two flavors: **managed subdomains** (like `blog.example.com`) where Lamaste handles everything, and **custom domains** (like `myblog.com`) where you bring your own domain and point it at the server.

## Prerequisites

- A completed [Lamaste onboarding](onboarding.md)
- Access to the Lamaste admin panel
- Static files to upload (HTML, CSS, JS, images, etc.)
- For custom domains: access to DNS management for the custom domain

## Step-by-Step

### 1. Open the Sites Page

Log in to the Lamaste admin panel at `https://panel.example.com` (or `https://<ip>:9292`).

Click **Sites** in the sidebar navigation (if available) or navigate to the Sites section.

### 2. Create a Managed Subdomain Site

A managed subdomain site uses your Lamaste domain (e.g., `blog.example.com`). Certificate issuance, DNS, and nginx configuration are handled automatically.

1. Click **Add Site**.
2. Select **Managed Subdomain** as the domain type.
3. Enter a name (this becomes the subdomain):

| Field    | Rules                                              | Example |
| -------- | -------------------------------------------------- | ------- |
| **Name** | Lowercase alphanumeric with hyphens, max 100 chars | `blog`  |

The name must not conflict with existing tunnels or reserved subdomains (`panel`, `auth`, `tunnel`, `www`, `mail`, `ftp`, `api`).

4. Configure options:

| Option                 | Default | Description                                                                          |
| ---------------------- | ------- | ------------------------------------------------------------------------------------ |
| **SPA Mode**           | Off     | If enabled, all non-file requests return `index.html` (for React, Vue, Angular apps) |
| **Authelia Protected** | Off     | If enabled, visitors must log in through Authelia before accessing the site          |

5. Click **Create Site**.

**What happens:**

1. A Let's Encrypt certificate is issued for `blog.example.com`.
2. An nginx vhost is written to serve static files from `/var/www/lamaste/<site-id>/`.
3. The site directory is created.
4. The site record is saved to `/etc/lamalibre/lamaste/sites.json`.

The site appears in the list with a "Live" status badge. It is ready for file uploads.

### 3. Create a Custom Domain Site

A custom domain site uses a domain you own (e.g., `myblog.com`). You must configure DNS before the site goes live.

1. Click **Add Site**.
2. Select **Custom Domain** as the domain type.
3. Enter a name and the custom domain:

| Field             | Example      |
| ----------------- | ------------ |
| **Name**          | `myblog`     |
| **Custom Domain** | `myblog.com` |

4. Configure SPA Mode and Authelia Protection as needed.
5. Click **Create Site**.

The site is created with a "DNS Pending" status. No certificate is issued yet because Let's Encrypt needs the domain to resolve to your server first.

### 4. Verify DNS for a Custom Domain

1. Add an A record at your domain registrar:

| Type  | Name                  | Value                                 |
| ----- | --------------------- | ------------------------------------- |
| **A** | `myblog.com` (or `@`) | Your server IP (e.g., `203.0.113.42`) |

2. Wait for DNS propagation (usually a few minutes).
3. In the Lamaste panel, click **Verify DNS** next to the site.
4. The panel checks if the domain resolves to your server.

**If DNS is verified:**

- A Let's Encrypt certificate is issued automatically.
- An nginx vhost is configured.
- The site status changes to "Live".

**If DNS is not verified:**

- The panel shows the current resolution and expected IP.
- Wait longer and try again.

### 5. Upload Files

After creating a site (whether managed or custom with verified DNS), upload your static files:

1. Click the **Files** button next to the site.
2. The file browser opens, showing the site's root directory.
3. Click **Upload** to select and upload files.
4. Files are uploaded to the site directory and served immediately.

**File upload details:**

- Files are uploaded via multipart form data to `POST /api/sites/:id/files`.
- The upload target directory can be specified with the `?path=` query parameter.
- Files are served directly by nginx — no Node.js involvement in serving static content.
- The site's total size is tracked and displayed.

**Directory structure example:**

For a typical static site, upload:

```
index.html
styles.css
scripts.js
images/
  logo.png
  hero.jpg
```

### 6. Enable SPA Mode

If your site is a single-page application (React, Vue, Angular, Svelte, etc.), enable SPA mode:

1. When creating the site, check the **SPA Mode** checkbox.
2. Or edit the site configuration after creation.

With SPA mode enabled, nginx is configured with a `try_files` directive: any request that does not match a physical file is served `index.html`. This allows client-side routing to work correctly.

**Without SPA mode:** A request to `blog.example.com/about` looks for a file at `/about` or `/about/index.html`. If neither exists, nginx returns 404.

**With SPA mode:** A request to `blog.example.com/about` first checks for a file at `/about`. If no file exists, it serves `index.html`, and your JavaScript router handles the route.

### 7. Enable Authelia Protection

If you want visitors to log in before accessing your static site:

1. When creating the site, check the **Authelia Protected** checkbox.
2. Or edit the site configuration after creation.

With Authelia protection enabled, nginx adds an `auth_request` directive. Every request is checked against Authelia before serving the file. Visitors are redirected to `auth.example.com` to log in with username, password, and TOTP code.

This is useful for internal documentation, staging sites, or any content you want to restrict to authenticated users.

### 8. Manage Files

The file browser lets you:

- **Browse directories** — Navigate the file tree
- **Upload files** — Add new files to any directory
- **Delete files** — Remove individual files
- **View file sizes** — See the total site size

### 9. Delete a Site

1. Go to the **Sites** page.
2. Click the **Delete** button next to the site.
3. Confirm the deletion.

**What is removed:**

- The nginx vhost configuration
- All uploaded files in the site directory
- The site record from `sites.json`

The Let's Encrypt certificate is left in place (certbot manages its lifecycle).

## For Developers

### Site Data Model

Each site is stored in `/etc/lamalibre/lamaste/sites.json` as a JSON array:

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "blog",
    "fqdn": "blog.example.com",
    "type": "managed",
    "spaMode": false,
    "autheliaProtected": false,
    "allowedUsers": [],
    "dnsVerified": true,
    "certIssued": true,
    "rootPath": "/var/www/lamaste/550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "totalSize": 245760
  }
]
```

### API Endpoints

| Method   | Path                        | Purpose                                                         |
| -------- | --------------------------- | --------------------------------------------------------------- |
| `GET`    | `/api/sites`                | List all sites                                                  |
| `POST`   | `/api/sites`                | Create a new site                                               |
| `PATCH`  | `/api/sites/:id`            | Update site settings (spaMode, autheliaProtected, allowedUsers) |
| `DELETE` | `/api/sites/:id`            | Delete a site                                                   |
| `POST`   | `/api/sites/:id/verify-dns` | Verify DNS for custom domain sites                              |
| `GET`    | `/api/sites/:id/files`      | List files in a directory                                       |
| `POST`   | `/api/sites/:id/files`      | Upload files (multipart)                                        |
| `DELETE` | `/api/sites/:id/files`      | Delete a file                                                   |

### Create Site Request

**Managed subdomain:**

```json
POST /api/sites
{
  "name": "blog",
  "type": "managed",
  "spaMode": false,
  "autheliaProtected": false
}
```

**Custom domain:**

```json
POST /api/sites
{
  "name": "myblog",
  "type": "custom",
  "customDomain": "myblog.com",
  "spaMode": true,
  "autheliaProtected": false
}
```

### Validation Rules

| Field               | Rules                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `name`              | 1-100 chars, regex `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, unique across sites, not reserved, not colliding with tunnels |
| `type`              | `managed` or `custom`                                                                                               |
| `customDomain`      | Required for `custom` type, max 253 chars, valid domain format                                                      |
| `spaMode`           | Boolean, defaults to `false`                                                                                        |
| `autheliaProtected` | Boolean, defaults to `false`                                                                                        |
| `allowedUsers`      | Array of strings (Authelia usernames), defaults to `[]`                                                             |

### File Storage

Static files are stored under `/var/www/lamaste/<site-id>/`. The directory is owned by `www-data:www-data` and served directly by nginx.

File operations use sudo commands with restricted paths:

- `mkdir -p /var/www/lamaste/<id>/`
- `chown -R www-data:www-data /var/www/lamaste/<id>/`
- `rm -rf /var/www/lamaste/<id>/`

Path validation prevents directory traversal attacks. The `validatePath()` function rejects paths containing `..`, absolute paths, and paths outside the site root.

### Managed vs. Custom Domain Flow

**Managed subdomain:**

```
Create → Issue cert → Write vhost → Create dir → Save state → Live
```

Everything happens in one request. The site is immediately live after creation (assuming wildcard DNS is configured, or the subdomain has its own A record).

**Custom domain:**

```
Create → Create dir → Save state → DNS Pending
  ↓
Verify DNS → Issue cert → Write vhost → Save state → Live
```

The site is created in a pending state. DNS verification is a separate step that triggers certificate issuance and vhost creation.

### nginx Vhost Features

Each static site vhost includes:

- TLS termination with Let's Encrypt certificate
- Optional `try_files $uri $uri/ /index.html` for SPA mode
- Optional Authelia `auth_request` for protected sites
- Standard security headers
- Gzip compression for text-based assets

## CLI Deployment

As an alternative to the browser-based file management described above, you can manage static sites and deploy files directly from the command line using the Lamaste agent CLI.

### Prerequisites

- The Lamaste agent CLI installed on your machine (see [Mac Client Setup](mac-client-setup.md))
- An agent certificate with `sites:read` and `sites:write` capabilities. Generate one from the panel: **Certificates** > **Agent Certificates** > **Generate**, and check the `sites:read` and `sites:write` capability boxes.
- The agent certificate must have the target site listed in its **Site Access** configuration. The admin assigns sites to agents from **Panel** > **Certificates** > edit agent > **Site Access**.

### Workflow

Site creation and deletion are admin-only operations. The admin creates the site through the panel or admin certificate, then assigns it to the agent. The agent can then deploy files to the site.

```bash
# Admin creates the site through the panel UI first, then:

# Build your app and deploy (agent cert must have the site in its allowedSites)
npm run build
lamaste-agent deploy blog ./dist
```

The `deploy` command clears all existing files on the site and uploads all non-hidden files from the specified local directory. It is a full replacement, not a merge. Every deploy is a clean slate.

You can also list sites assigned to your agent from the CLI:

```bash
# List sites assigned to this agent
lamaste-agent sites
```

For the full list of flags and options, see the [agent CLI README](https://github.com/lamalibre/lamaste/tree/main/packages/lamaste-agent).

## Quick Reference

| Feature        | Managed Subdomain    | Custom Domain          |
| -------------- | -------------------- | ---------------------- |
| DNS setup      | Automatic (wildcard) | Manual (A record)      |
| Certificate    | Automatic            | After DNS verification |
| Goes live      | Immediately          | After DNS + cert       |
| Example domain | `blog.example.com`   | `myblog.com`           |

| Action                  | Steps                                                |
| ----------------------- | ---------------------------------------------------- |
| **Create managed site** | Add Site, Managed Subdomain, enter name, Create      |
| **Create custom site**  | Add Site, Custom Domain, enter name + domain, Create |
| **Verify DNS**          | Click "Verify DNS" next to pending site              |
| **Upload files**        | Click "Files", then "Upload"                         |
| **Enable SPA mode**     | Check "SPA Mode" when creating                       |
| **Enable auth**         | Check "Authelia Protected" when creating             |
| **Delete site**         | Click "Delete", confirm                              |

| Reserved Names | Cannot Use As Site Name |
| -------------- | ----------------------- |
| `panel`        | Admin panel subdomain   |
| `auth`         | Authelia subdomain      |
| `tunnel`       | Chisel tunnel subdomain |
| `www`          | Common web prefix       |
| `mail`         | Email subdomain         |
| `ftp`          | File transfer subdomain |
| `api`          | API subdomain           |
