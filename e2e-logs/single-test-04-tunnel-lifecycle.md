# Portlama E2E: 04 — Tunnel Lifecycle

> Started at `2026-03-29 09:07:47 UTC`


## Pre-flight: check onboarding is complete


## Create tunnel

✅ `09:07:49` Tunnel creation returned ok: true  
✅ `09:07:49` Tunnel subdomain matches  
✅ `09:07:49` Tunnel port matches  
✅ `09:07:49` Tunnel has an ID  
✅ `09:07:49` Tunnel has an FQDN  
✅ `09:07:49` Tunnel has a createdAt timestamp  
ℹ️ `09:07:49` Created tunnel ID: bbfe0dbd-f971-4f17-a37c-c67c344dfa4c  

## Verify tunnel in list

✅ `09:07:49` Tunnel appears in GET /api/tunnels  

## Verify nginx configuration

✅ `09:07:49` Nginx vhost exists at /etc/nginx/sites-enabled/portlama-app-e2etest-1774775267  
✅ `09:07:49` nginx -t passes after tunnel creation  

## Validation: reserved subdomain

✅ `09:07:49` Reserved subdomain 'panel' rejected (HTTP 400)  

## Validation: duplicate subdomain

✅ `09:07:49` Duplicate subdomain rejected (HTTP 400)  

## Validation: duplicate port

✅ `09:07:49` Duplicate port rejected (HTTP 400)  

## Validation: invalid port

✅ `09:07:49` Port below 1024 rejected (HTTP 400)  

## Mac plist endpoint

✅ `09:07:49` Mac plist endpoint returns plist content  

## Disable tunnel

✅ `09:07:52` Tunnel disable returned ok: true  
✅ `09:07:52` Tunnel shows as disabled in list  
✅ `09:07:52` Nginx sites-enabled symlink removed for disabled tunnel  
✅ `09:07:52` nginx -t passes after tunnel disable  
✅ `09:07:52` Disabled tunnel excluded from plist  

## Re-enable tunnel

✅ `09:07:54` Tunnel re-enable returned ok: true  
✅ `09:07:54` Tunnel shows as enabled in list  
✅ `09:07:54` Nginx vhost restored for re-enabled tunnel  
✅ `09:07:54` nginx -t passes after tunnel re-enable  
✅ `09:07:54` Re-enabled tunnel included in plist  

## Toggle nonexistent tunnel

✅ `09:07:54` Toggle nonexistent tunnel returns 404  

## Delete tunnel

✅ `09:07:57` Tunnel deletion returned ok: true  
✅ `09:07:57` Tunnel no longer in list after deletion  
✅ `09:07:57` Nginx vhost removed after tunnel deletion  
✅ `09:07:57` nginx -t passes after tunnel deletion  

## Delete nonexistent tunnel

✅ `09:07:57` Delete nonexistent tunnel returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `30` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `30` |

