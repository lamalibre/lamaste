# Portlama E2E: 04 — Tunnel Lifecycle

> Started at `2026-03-28 16:08:01 UTC`


## Pre-flight: check onboarding is complete


## Create tunnel

✅ `16:08:03` Tunnel creation returned ok: true  
✅ `16:08:03` Tunnel subdomain matches  
✅ `16:08:03` Tunnel port matches  
✅ `16:08:03` Tunnel has an ID  
✅ `16:08:03` Tunnel has an FQDN  
✅ `16:08:03` Tunnel has a createdAt timestamp  
ℹ️ `16:08:03` Created tunnel ID: 194a73a7-be4f-4095-a369-88be7907e2fa  

## Verify tunnel in list

✅ `16:08:03` Tunnel appears in GET /api/tunnels  

## Verify nginx configuration

✅ `16:08:03` Nginx vhost exists at /etc/nginx/sites-enabled/portlama-app-e2etest-1774714081  
✅ `16:08:03` nginx -t passes after tunnel creation  

## Validation: reserved subdomain

✅ `16:08:03` Reserved subdomain 'panel' rejected (HTTP 400)  

## Validation: duplicate subdomain

✅ `16:08:03` Duplicate subdomain rejected (HTTP 400)  

## Validation: duplicate port

✅ `16:08:03` Duplicate port rejected (HTTP 400)  

## Validation: invalid port

✅ `16:08:03` Port below 1024 rejected (HTTP 400)  

## Mac plist endpoint

✅ `16:08:04` Mac plist endpoint returns plist content  

## Disable tunnel

✅ `16:08:06` Tunnel disable returned ok: true  
✅ `16:08:06` Tunnel shows as disabled in list  
✅ `16:08:06` Nginx sites-enabled symlink removed for disabled tunnel  
✅ `16:08:06` nginx -t passes after tunnel disable  
✅ `16:08:06` Disabled tunnel excluded from plist  

## Re-enable tunnel

✅ `16:08:08` Tunnel re-enable returned ok: true  
✅ `16:08:08` Tunnel shows as enabled in list  
✅ `16:08:08` Nginx vhost restored for re-enabled tunnel  
✅ `16:08:08` nginx -t passes after tunnel re-enable  
✅ `16:08:08` Re-enabled tunnel included in plist  

## Toggle nonexistent tunnel

✅ `16:08:08` Toggle nonexistent tunnel returns 404  

## Delete tunnel

✅ `16:08:11` Tunnel deletion returned ok: true  
✅ `16:08:11` Tunnel no longer in list after deletion  
✅ `16:08:11` Nginx vhost removed after tunnel deletion  
✅ `16:08:11` nginx -t passes after tunnel deletion  

## Delete nonexistent tunnel

✅ `16:08:11` Delete nonexistent tunnel returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `30` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `30` |

