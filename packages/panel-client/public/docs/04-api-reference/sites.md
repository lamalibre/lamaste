# Static Sites API

> Host static websites through Portlama — upload files, manage domains, and serve content directly from nginx without a tunnel.

## In Plain English

While tunnels forward requests to an app running on your local machine, static sites are served directly from the droplet. You upload HTML, CSS, JavaScript, and image files through the management panel, and nginx serves them at a subdomain of your domain (or a custom domain you own).

This is useful for landing pages, documentation sites, or any content that does not need a backend server.

There are two types of sites:
- **Managed** — uses a subdomain of your Portlama domain (like `docs.example.com`). The certificate and DNS are handled automatically.
- **Custom** — uses a domain you own (like `myblog.net`). You need to point its DNS to your droplet, then verify DNS through the API before the site goes live.

## Authentication

All site endpoints require a valid mTLS client certificate and a completed onboarding. See the [API Overview](./overview.md) for details.

If onboarding is not complete, all endpoints return `503 Service Unavailable`.

## Endpoints

### `GET /api/sites`

Returns all configured static sites, sorted by creation date (newest first).

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/sites | jq
```

**Response (200):**

```json
{
  "sites": [
    {
      "id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
      "name": "docs",
      "fqdn": "docs.example.com",
      "type": "managed",
      "spaMode": false,
      "autheliaProtected": false,
      "allowedUsers": [],
      "dnsVerified": true,
      "certIssued": true,
      "rootPath": "/var/lib/portlama/sites/c3d4e5f6-a7b8-9012-cdef-123456789012",
      "createdAt": "2026-03-13T14:30:00.000Z",
      "totalSize": 524288
    },
    {
      "id": "d4e5f6a7-b8c9-0123-defa-234567890123",
      "name": "blog",
      "fqdn": "myblog.net",
      "type": "custom",
      "spaMode": true,
      "autheliaProtected": false,
      "allowedUsers": [],
      "dnsVerified": false,
      "certIssued": false,
      "rootPath": "/var/lib/portlama/sites/d4e5f6a7-b8c9-0123-defa-234567890123",
      "createdAt": "2026-03-12T10:15:00.000Z",
      "totalSize": 0
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID v4 identifier |
| `name` | `string` | Site name (used as subdomain for managed sites) |
| `fqdn` | `string` | Fully qualified domain name |
| `type` | `string` | `"managed"` (subdomain) or `"custom"` (your own domain) |
| `spaMode` | `boolean` | If `true`, all routes serve `index.html` (for single-page apps) |
| `autheliaProtected` | `boolean` | If `true`, Authelia authentication is required to access the site |
| `allowedUsers` | `string[]` | List of Authelia usernames allowed to access the site (empty array means all authenticated users) |
| `dnsVerified` | `boolean` | Whether DNS has been verified (always `true` for managed sites) |
| `certIssued` | `boolean` | Whether a TLS certificate has been issued |
| `rootPath` | `string` | Filesystem path where uploaded files are stored |
| `createdAt` | `string` | ISO 8601 timestamp |
| `totalSize` | `number` | Total size of uploaded files in bytes |

---

### `POST /api/sites`

Creates a new static site.

For **managed** sites, the full provisioning happens immediately: TLS certificate issuance, nginx vhost creation, and directory setup. The site is live as soon as the endpoint returns.

For **custom** domain sites, only the directory and state are created. You must then add a DNS A record pointing your domain to the droplet and call `POST /api/sites/:id/verify-dns` to issue the certificate and configure nginx.

**Request:**

```json
{
  "name": "docs",
  "type": "managed",
  "spaMode": false,
  "autheliaProtected": false
}
```

For a custom domain:

```json
{
  "name": "blog",
  "type": "custom",
  "customDomain": "myblog.net",
  "spaMode": true,
  "autheliaProtected": false
}
```

| Field | Type | Validation | Description |
|-------|------|------------|-------------|
| `name` | `string` | 1-100 chars, lowercase alphanumeric + hyphens, cannot start/end with hyphen | Site name (used as subdomain for managed type) |
| `type` | `string` | `"managed"` or `"custom"` | Site type |
| `customDomain` | `string` | Max 253 chars, lowercase alphanumeric + dots + hyphens; required for `custom` type | Your own domain |
| `spaMode` | `boolean` | Optional, defaults to `false` | Serve `index.html` for all routes |
| `autheliaProtected` | `boolean` | Optional, defaults to `false` | Require Authelia login |

**Name regex:**

```
^[a-z0-9]([a-z0-9-]*[a-z0-9])?$
```

**Custom domain regex:**

```
^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$
```

```bash
# Create managed site
curl -s --cert client.p12:password \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"docs","type":"managed"}' \
  https://203.0.113.42:9292/api/sites | jq

# Create custom domain site
curl -s --cert client.p12:password \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"blog","type":"custom","customDomain":"myblog.net","spaMode":true}' \
  https://203.0.113.42:9292/api/sites | jq
```

**Response (201) — managed site:**

```json
{
  "ok": true,
  "site": {
    "id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
    "name": "docs",
    "fqdn": "docs.example.com",
    "type": "managed",
    "spaMode": false,
    "autheliaProtected": false,
    "dnsVerified": true,
    "certIssued": true,
    "rootPath": "/var/lib/portlama/sites/c3d4e5f6-a7b8-9012-cdef-123456789012",
    "createdAt": "2026-03-13T14:30:00.000Z",
    "totalSize": 0
  }
}
```

**Response (201) — custom domain site:**

```json
{
  "ok": true,
  "site": {
    "id": "d4e5f6a7-b8c9-0123-defa-234567890123",
    "name": "blog",
    "fqdn": "myblog.net",
    "type": "custom",
    "spaMode": true,
    "autheliaProtected": false,
    "dnsVerified": false,
    "certIssued": false,
    "rootPath": "/var/lib/portlama/sites/d4e5f6a7-b8c9-0123-defa-234567890123",
    "createdAt": "2026-03-13T14:30:00.000Z",
    "totalSize": 0
  },
  "message": "Site created. Add an A record for your domain, then verify DNS."
}
```

**Errors:**

| Status | Body | When |
|--------|------|------|
| 400 | `{"error":"Validation failed","details":{"issues":[...]}}` | Invalid name format, type, or custom domain |
| 400 | `{"error":"Custom domain is required for custom type sites"}` | `type` is `custom` but `customDomain` is missing |
| 400 | `{"error":"Site name 'docs' is already in use"}` | Another site uses this name |
| 400 | `{"error":"Name 'panel' is reserved"}` | Name collides with a reserved subdomain |
| 400 | `{"error":"Name 'app' is already in use by a tunnel"}` | Name collides with an existing tunnel subdomain |
| 400 | `{"error":"Domain 'docs.example.com' is already in use by another site"}` | FQDN collision with another site |
| 400 | `{"error":"Domain 'app.example.com' is already in use by a tunnel"}` | FQDN collision with an existing tunnel |
| 400 | `{"error":"Domain and email must be configured before creating sites"}` | Domain not set in config |
| 500 | `{"error":"Failed to create site","details":"Certificate issuance failed: ..."}` | certbot failed (managed sites) |
| 500 | `{"error":"Failed to create site","details":"Nginx configuration failed: ..."}` | nginx vhost failed (managed sites) |
| 500 | `{"error":"Failed to create site","details":"Directory creation failed: ..."}` | Could not create site directory |
| 500 | `{"error":"Failed to create site","details":"State persistence failed: ..."}` | Could not write sites.json |

**Reserved names** (for managed type):

`panel`, `auth`, `tunnel`, `www`, `mail`, `ftp`, `api`

---

### `DELETE /api/sites/:id`

Deletes a static site by its UUID. Removes the nginx vhost (if a certificate was issued), the site directory and all uploaded files, and the site from the state file.

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  -X DELETE \
  https://203.0.113.42:9292/api/sites/c3d4e5f6-a7b8-9012-cdef-123456789012 | jq
```

**Response (200):**

```json
{
  "ok": true
}
```

**Errors:**

| Status | Body | When |
|--------|------|------|
| 404 | `{"error":"Site not found"}` | No site with the given UUID |
| 500 | `{"error":"Failed to delete site","details":"..."}` | nginx, directory, or state operation failed |

---

### `PATCH /api/sites/:id`

Updates a site's settings. Any combination of fields can be sent; only provided fields are changed. If nginx-affecting settings (`spaMode`, `autheliaProtected`) change and the site has a live certificate, the nginx vhost is regenerated. If `autheliaProtected` or `allowedUsers` change, the Authelia access control configuration is updated and reloaded.

**Request:**

```json
{
  "spaMode": true,
  "autheliaProtected": true,
  "allowedUsers": ["alice", "bob"]
}
```

| Field | Type | Validation | Description |
|-------|------|------------|-------------|
| `spaMode` | `boolean` | Optional | Serve `index.html` for all routes |
| `autheliaProtected` | `boolean` | Optional | Require Authelia login |
| `allowedUsers` | `string[]` | Optional, each element min 1 char | Authelia usernames allowed to access this site |

```bash
curl -s --cert client.p12:password \
  -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"autheliaProtected":true,"allowedUsers":["alice"]}' \
  https://203.0.113.42:9292/api/sites/c3d4e5f6-a7b8-9012-cdef-123456789012 | jq
```

**Response (200):**

```json
{
  "ok": true,
  "site": {
    "id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
    "name": "docs",
    "fqdn": "docs.example.com",
    "type": "managed",
    "spaMode": false,
    "autheliaProtected": true,
    "allowedUsers": ["alice"],
    "dnsVerified": true,
    "certIssued": true,
    "rootPath": "/var/lib/portlama/sites/c3d4e5f6-a7b8-9012-cdef-123456789012",
    "createdAt": "2026-03-13T14:30:00.000Z",
    "totalSize": 524288
  }
}
```

**Response (200) — no changes:**

```json
{
  "ok": true,
  "site": { ... },
  "message": "No changes"
}
```

**Errors:**

| Status | Body | When |
|--------|------|------|
| 404 | `{"error":"Site not found"}` | No site with the given UUID |
| 500 | `{"error":"Failed to update site configuration","details":"Nginx configuration failed: ..."}` | nginx vhost regeneration failed |
| 500 | `{"error":"Site saved but Authelia configuration failed","details":"..."}` | Authelia access control update failed |

---

### `POST /api/sites/:id/verify-dns`

Verifies that a custom domain's DNS A record points to the droplet's IP address. On success, issues a Let's Encrypt certificate and configures the nginx vhost. The site becomes live immediately.

This endpoint is only applicable to `custom` type sites. Managed sites have DNS verified automatically at creation.

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  -X POST \
  https://203.0.113.42:9292/api/sites/d4e5f6a7-b8c9-0123-defa-234567890123/verify-dns | jq
```

**Response (200) — DNS correct:**

```json
{
  "ok": true,
  "message": "DNS verified, certificate issued, and site is now live."
}
```

**Response (200) — DNS not yet propagated:**

```json
{
  "ok": false,
  "fqdn": "myblog.net",
  "expectedIp": "203.0.113.42",
  "resolvedIps": [],
  "message": "Domain does not resolve yet. Please add an A record pointing myblog.net to 203.0.113.42."
}
```

**Response (200) — DNS points to wrong IP:**

```json
{
  "ok": false,
  "fqdn": "myblog.net",
  "expectedIp": "203.0.113.42",
  "resolvedIps": ["198.51.100.1"],
  "message": "Domain resolves to 198.51.100.1 but your server IP is 203.0.113.42. Please update your A record."
}
```

**Response (200) — already verified:**

```json
{
  "ok": true,
  "message": "DNS already verified and certificate issued"
}
```

**Errors:**

| Status | Body | When |
|--------|------|------|
| 400 | `{"error":"DNS verification is only needed for custom domains"}` | Site type is `managed` |
| 404 | `{"error":"Site not found"}` | No site with the given UUID |
| 500 | `{"error":"DNS verified but certificate issuance failed","details":"..."}` | DNS passed but certbot failed |
| 500 | `{"error":"Certificate issued but nginx configuration failed","details":"..."}` | Cert issued but vhost write failed |

---

### `GET /api/sites/:id/files`

Lists files in a site's upload directory. Supports browsing subdirectories via the `path` query parameter.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `string` | `"."` | Relative path within the site directory to list |

```bash
curl -s --cert client.p12:password \
  "https://203.0.113.42:9292/api/sites/<uuid>/files" | jq

# List a subdirectory
curl -s --cert client.p12:password \
  "https://203.0.113.42:9292/api/sites/<uuid>/files?path=css" | jq
```

**Response (200):**

```json
{
  "files": [
    { "name": "index.html", "type": "file", "size": 2048 },
    { "name": "css", "type": "directory", "size": 0 },
    { "name": "logo.png", "type": "file", "size": 15360 }
  ],
  "path": "."
}
```

**Errors:**

| Status | Body | When |
|--------|------|------|
| 400 | `{"error":"..."}` | Invalid or disallowed path (path traversal attempt) |
| 404 | `{"error":"Site not found"}` | No site with the given UUID |

---

### `POST /api/sites/:id/files`

Uploads one or more files to a site's directory via multipart form data. Files are saved relative to the directory specified by the `path` query parameter.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `string` | `"."` | Target directory within the site for uploaded files |

**Request:**

```bash
# Upload a single file
curl -s --cert client.p12:password \
  -X POST \
  -F "file=@index.html" \
  "https://203.0.113.42:9292/api/sites/<uuid>/files" | jq

# Upload to a subdirectory
curl -s --cert client.p12:password \
  -X POST \
  -F "file=@style.css" \
  "https://203.0.113.42:9292/api/sites/<uuid>/files?path=css" | jq

# Upload multiple files
curl -s --cert client.p12:password \
  -X POST \
  -F "file=@index.html" \
  -F "file=@style.css" \
  "https://203.0.113.42:9292/api/sites/<uuid>/files" | jq
```

**Content-Type:** `multipart/form-data`

**File size limit:** 50 MB per file.

**Response (200):**

```json
{
  "ok": true,
  "files": ["index.html", "style.css"]
}
```

**Response (200) — with size warning:**

```json
{
  "ok": true,
  "files": ["large-bundle.js"],
  "warning": "Site size (52.3 MB) exceeds the 50.0 MB limit.",
  "totalSize": 54857728
}
```

**Errors:**

| Status | Body | When |
|--------|------|------|
| 400 | `{"error":"Upload failed: ..."}` | Path traversal attempt, invalid path, or stream error |
| 404 | `{"error":"Site not found"}` | No site with the given UUID |

File paths are validated to prevent directory traversal. Paths containing `..` or absolute paths are rejected.

---

### `DELETE /api/sites/:id/files`

Deletes a single file from a site's directory.

**Request:**

```json
{
  "path": "old-page.html"
}
```

| Field | Type | Validation | Description |
|-------|------|------------|-------------|
| `path` | `string` | Min 1 char, required | Relative path to the file within the site directory |

```bash
curl -s --cert client.p12:password \
  -X DELETE \
  -H "Content-Type: application/json" \
  -d '{"path":"old-page.html"}' \
  "https://203.0.113.42:9292/api/sites/<uuid>/files" | jq
```

**Response (200):**

```json
{
  "ok": true
}
```

**Errors:**

| Status | Body | When |
|--------|------|------|
| 400 | `{"error":"Validation failed","details":{"issues":[...]}}` | Missing or empty path |
| 400 | `{"error":"..."}` | Path traversal attempt or file not found |
| 404 | `{"error":"Site not found"}` | No site with the given UUID |

## Quick Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sites` | List all static sites (newest first) |
| POST | `/api/sites` | Create a static site |
| PATCH | `/api/sites/:id` | Update site settings (spaMode, autheliaProtected, allowedUsers) |
| DELETE | `/api/sites/:id` | Delete a site and all its files |
| POST | `/api/sites/:id/verify-dns` | Verify DNS for custom domain sites |
| GET | `/api/sites/:id/files` | List files in a site directory |
| POST | `/api/sites/:id/files` | Upload files (multipart) |
| DELETE | `/api/sites/:id/files` | Delete a file |

### Site Object Shape

```json
{
  "id": "uuid-v4",
  "name": "docs",
  "fqdn": "docs.example.com",
  "type": "managed",
  "spaMode": false,
  "autheliaProtected": false,
  "allowedUsers": [],
  "dnsVerified": true,
  "certIssued": true,
  "rootPath": "/var/lib/portlama/sites/<uuid>",
  "createdAt": "2026-03-13T14:30:00.000Z",
  "totalSize": 524288
}
```

### Managed vs Custom Site Flow

```
Managed site:
  POST /sites (name, type: "managed")
    → cert issued → vhost written → directory created → LIVE

Custom domain site:
  POST /sites (name, type: "custom", customDomain: "myblog.net")
    → directory created → state saved → DNS PENDING

  (user adds A record in their DNS provider)

  POST /sites/:id/verify-dns
    → DNS checked → cert issued → vhost written → LIVE
```

### curl Cheat Sheet

```bash
# List sites
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/sites | jq

# Create managed site
curl -s --cert client.p12:password \
  -X POST -H "Content-Type: application/json" \
  -d '{"name":"docs","type":"managed"}' \
  https://203.0.113.42:9292/api/sites | jq

# Create custom domain site
curl -s --cert client.p12:password \
  -X POST -H "Content-Type: application/json" \
  -d '{"name":"blog","type":"custom","customDomain":"myblog.net","spaMode":true}' \
  https://203.0.113.42:9292/api/sites | jq

# Verify DNS for custom site
curl -s --cert client.p12:password \
  -X POST \
  https://203.0.113.42:9292/api/sites/<uuid>/verify-dns | jq

# Upload files
curl -s --cert client.p12:password \
  -X POST -F "file=@index.html" -F "file=@style.css" \
  https://203.0.113.42:9292/api/sites/<uuid>/files | jq

# List files
curl -s --cert client.p12:password \
  "https://203.0.113.42:9292/api/sites/<uuid>/files" | jq

# Delete a file
curl -s --cert client.p12:password \
  -X DELETE -H "Content-Type: application/json" \
  -d '{"path":"old-page.html"}' \
  "https://203.0.113.42:9292/api/sites/<uuid>/files" | jq

# Delete site
curl -s --cert client.p12:password \
  -X DELETE \
  https://203.0.113.42:9292/api/sites/<uuid> | jq
```
