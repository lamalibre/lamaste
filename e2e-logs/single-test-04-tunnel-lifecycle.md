# Portlama E2E: 04 — Tunnel Lifecycle

> Started at `2026-03-28 22:38:23 UTC`


## Pre-flight: check onboarding is complete


## Create tunnel

✅ `22:38:26` Tunnel creation returned ok: true  
✅ `22:38:26` Tunnel subdomain matches  
✅ `22:38:26` Tunnel port matches  
✅ `22:38:26` Tunnel has an ID  
✅ `22:38:26` Tunnel has an FQDN  
✅ `22:38:26` Tunnel has a createdAt timestamp  
ℹ️ `22:38:26` Created tunnel ID: b43f4e22-d1c9-42b5-a893-9abeaae1770e  

## Verify tunnel in list

✅ `22:38:26` Tunnel appears in GET /api/tunnels  

## Verify nginx configuration

✅ `22:38:26` Nginx vhost exists at /etc/nginx/sites-enabled/portlama-app-e2etest-1774737503  
✅ `22:38:26` nginx -t passes after tunnel creation  

## Validation: reserved subdomain

✅ `22:38:26` Reserved subdomain 'panel' rejected (HTTP 400)  

## Validation: duplicate subdomain

✅ `22:38:26` Duplicate subdomain rejected (HTTP 400)  

## Validation: duplicate port

✅ `22:38:26` Duplicate port rejected (HTTP 400)  

## Validation: invalid port

✅ `22:38:26` Port below 1024 rejected (HTTP 400)  

## Mac plist endpoint

✅ `22:38:26` Mac plist endpoint returns plist content  

## Disable tunnel

✅ `22:38:28` Tunnel disable returned ok: true  
✅ `22:38:28` Tunnel shows as disabled in list  
✅ `22:38:28` Nginx sites-enabled symlink removed for disabled tunnel  
✅ `22:38:28` nginx -t passes after tunnel disable  
✅ `22:38:28` Disabled tunnel excluded from plist  

## Re-enable tunnel

✅ `22:38:30` Tunnel re-enable returned ok: true  
✅ `22:38:30` Tunnel shows as enabled in list  
✅ `22:38:30` Nginx vhost restored for re-enabled tunnel  
✅ `22:38:30` nginx -t passes after tunnel re-enable  
✅ `22:38:30` Re-enabled tunnel included in plist  

## Toggle nonexistent tunnel

✅ `22:38:30` Toggle nonexistent tunnel returns 404  

## Delete tunnel

✅ `22:38:33` Tunnel deletion returned ok: true  
✅ `22:38:33` Tunnel no longer in list after deletion  
✅ `22:38:33` Nginx vhost removed after tunnel deletion  
✅ `22:38:33` nginx -t passes after tunnel deletion  

## Delete nonexistent tunnel

✅ `22:38:33` Delete nonexistent tunnel returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `30` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `30` |

