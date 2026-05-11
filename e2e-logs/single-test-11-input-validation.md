# Lamaste E2E: 11 — Input Validation & Security Hardening

> Started at `2026-03-30 13:06:59 UTC`


## Pre-flight: check onboarding is complete


## Invalid UUID for tunnel operations

✅ `13:06:59` PATCH /api/tunnels/not-a-uuid returns 400  
✅ `13:06:59` DELETE /api/tunnels/not-a-uuid returns 400  
✅ `13:06:59` PATCH /api/tunnels/../etc/passwd rejected (HTTP 404)  

## Invalid UUID for site operations

✅ `13:06:59` DELETE /api/sites/not-a-uuid returns 400  

## Invalid invite token format

✅ `13:06:59` GET /api/invite/not-a-valid-token returns 400  
✅ `13:06:59` POST /api/invite/not-a-valid-token/accept returns 400  
✅ `13:06:59` Path traversal does not expose /etc/passwd  

## Invalid domain format in certs endpoint

✅ `13:06:59` POST /api/certs/a..b/renew returns 400  
✅ `13:06:59` POST /api/certs/.../renew returns 400  
✅ `13:06:59` POST /api/certs/evil.com;inject/renew returns 400  

## Subdomain injection attempts

✅ `13:06:59` Subdomain with semicolon rejected (HTTP 400)  
✅ `13:06:59` Subdomain with newline rejected (HTTP 400)  
✅ `13:06:59` Subdomain with path traversal rejected (HTTP 400)  
✅ `13:06:59` Subdomain with uppercase rejected (HTTP 400)  
✅ `13:06:59` Subdomain with 64 chars rejected (HTTP 400)  

## Port boundary validation

✅ `13:06:59` Port 0 rejected (HTTP 400)  
✅ `13:07:00` Port 1023 rejected (HTTP 400)  
✅ `13:07:00` Port 65536 rejected (HTTP 400)  
✅ `13:07:00` Port -1 rejected (HTTP 400)  
✅ `13:07:00` Port 'abc' (string) rejected (HTTP 400)  

## Malformed JSON bodies

✅ `13:07:00` Invalid JSON body to /api/tunnels returns 400  
✅ `13:07:00` Empty body to /api/users rejected (HTTP 400)  

## File permissions

✅ `13:07:00` /etc/lamaste/tunnels.json has correct permissions (600)  
⏭️ `13:07:00` /etc/lamaste/sites.json not found  
✅ `13:07:00` panel.json has correct permissions (640)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `24` |
| **Failed** | `0` |
| **Skipped** | `1` |
| **Total** | `25` |

