# Portlama E2E: 11 — Input Validation & Security Hardening

> Started at `2026-03-24 08:11:05 UTC`


## Pre-flight: check onboarding is complete


## Invalid UUID for tunnel operations

✅ `08:11:05` PATCH /api/tunnels/not-a-uuid returns 400  
✅ `08:11:05` DELETE /api/tunnels/not-a-uuid returns 400  
✅ `08:11:05` PATCH /api/tunnels/../etc/passwd rejected (HTTP 404)  

## Invalid UUID for site operations

✅ `08:11:06` DELETE /api/sites/not-a-uuid returns 400  

## Invalid invite token format

✅ `08:11:06` GET /api/invite/not-a-valid-token returns 400  
✅ `08:11:06` POST /api/invite/not-a-valid-token/accept returns 400  
✅ `08:11:06` Path traversal does not expose /etc/passwd  

## Invalid domain format in certs endpoint

✅ `08:11:06` POST /api/certs/a..b/renew returns 400  
✅ `08:11:06` POST /api/certs/.../renew returns 400  
✅ `08:11:06` POST /api/certs/evil.com;inject/renew returns 400  

## Subdomain injection attempts

✅ `08:11:06` Subdomain with semicolon rejected (HTTP 400)  
✅ `08:11:06` Subdomain with newline rejected (HTTP 400)  
✅ `08:11:06` Subdomain with path traversal rejected (HTTP 400)  
✅ `08:11:06` Subdomain with uppercase rejected (HTTP 400)  
✅ `08:11:06` Subdomain with 64 chars rejected (HTTP 400)  

## Port boundary validation

✅ `08:11:06` Port 0 rejected (HTTP 400)  
✅ `08:11:06` Port 1023 rejected (HTTP 400)  
✅ `08:11:06` Port 65536 rejected (HTTP 400)  
✅ `08:11:06` Port -1 rejected (HTTP 400)  
✅ `08:11:06` Port 'abc' (string) rejected (HTTP 400)  

## Malformed JSON bodies

✅ `08:11:06` Invalid JSON body to /api/tunnels returns 400  
✅ `08:11:06` Empty body to /api/users rejected (HTTP 400)  

## File permissions

✅ `08:11:06` /etc/portlama/tunnels.json has correct permissions (600)  
⏭️ `08:11:06` /etc/portlama/sites.json not found  
✅ `08:11:06` panel.json has correct permissions (640)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `24` |
| **Failed** | `0` |
| **Skipped** | `1` |
| **Total** | `25` |

