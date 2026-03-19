# Portlama E2E: 11 — Input Validation & Security Hardening

> Started at `2026-03-19 12:17:43 UTC`


## Pre-flight: check onboarding is complete


## Invalid UUID for tunnel operations

✅ `12:17:43` PATCH /api/tunnels/not-a-uuid returns 400  
✅ `12:17:43` DELETE /api/tunnels/not-a-uuid returns 400  
✅ `12:17:43` PATCH /api/tunnels/../etc/passwd rejected (HTTP 404)  

## Invalid UUID for site operations

✅ `12:17:43` DELETE /api/sites/not-a-uuid returns 400  

## Invalid invite token format

✅ `12:17:43` GET /api/invite/not-a-valid-token returns 400  
✅ `12:17:43` POST /api/invite/not-a-valid-token/accept returns 400  
✅ `12:17:43` Path traversal does not expose /etc/passwd  

## Invalid domain format in certs endpoint

✅ `12:17:43` POST /api/certs/a..b/renew returns 400  
✅ `12:17:43` POST /api/certs/.../renew returns 400  
✅ `12:17:43` POST /api/certs/evil.com;inject/renew returns 400  

## Subdomain injection attempts

✅ `12:17:43` Subdomain with semicolon rejected (HTTP 400)  
✅ `12:17:43` Subdomain with newline rejected (HTTP 400)  
✅ `12:17:43` Subdomain with path traversal rejected (HTTP 400)  
✅ `12:17:43` Subdomain with uppercase rejected (HTTP 400)  
✅ `12:17:43` Subdomain with 64 chars rejected (HTTP 400)  

## Port boundary validation

✅ `12:17:43` Port 0 rejected (HTTP 400)  
✅ `12:17:43` Port 1023 rejected (HTTP 400)  
✅ `12:17:43` Port 65536 rejected (HTTP 400)  
✅ `12:17:43` Port -1 rejected (HTTP 400)  
✅ `12:17:43` Port 'abc' (string) rejected (HTTP 400)  

## Malformed JSON bodies

✅ `12:17:43` Invalid JSON body to /api/tunnels returns 400  
✅ `12:17:43` Empty body to /api/users rejected (HTTP 400)  

## File permissions

✅ `12:17:43` /etc/portlama/tunnels.json has correct permissions (600)  
⏭️ `12:17:43` /etc/portlama/sites.json not found  
✅ `12:17:43` panel.json has correct permissions (640)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `24` |
| **Failed** | `0` |
| **Skipped** | `1` |
| **Total** | `25` |

