# Portlama E2E: 04 — Tunnel Lifecycle

> Started at `2026-03-24 08:10:23 UTC`


## Pre-flight: check onboarding is complete


## Create tunnel

✅ `08:10:25` Tunnel creation returned ok: true  
✅ `08:10:25` Tunnel subdomain matches  
✅ `08:10:25` Tunnel port matches  
✅ `08:10:25` Tunnel has an ID  
✅ `08:10:25` Tunnel has an FQDN  
✅ `08:10:25` Tunnel has a createdAt timestamp  
ℹ️ `08:10:25` Created tunnel ID: f3149b81-4d36-470c-92c0-a76e9821ac7a  

## Verify tunnel in list

✅ `08:10:25` Tunnel appears in GET /api/tunnels  

## Verify nginx configuration

✅ `08:10:25` Nginx vhost exists at /etc/nginx/sites-enabled/portlama-app-e2etest-1774339823  
✅ `08:10:25` nginx -t passes after tunnel creation  

## Validation: reserved subdomain

✅ `08:10:25` Reserved subdomain 'panel' rejected (HTTP 400)  

## Validation: duplicate subdomain

✅ `08:10:25` Duplicate subdomain rejected (HTTP 400)  

## Validation: duplicate port

✅ `08:10:25` Duplicate port rejected (HTTP 400)  

## Validation: invalid port

✅ `08:10:25` Port below 1024 rejected (HTTP 400)  

## Mac plist endpoint

✅ `08:10:25` Mac plist endpoint returns plist content  

## Disable tunnel

✅ `08:10:28` Tunnel disable returned ok: true  
✅ `08:10:28` Tunnel shows as disabled in list  
✅ `08:10:28` Nginx sites-enabled symlink removed for disabled tunnel  
✅ `08:10:28` nginx -t passes after tunnel disable  
✅ `08:10:28` Disabled tunnel excluded from plist  

## Re-enable tunnel

✅ `08:10:30` Tunnel re-enable returned ok: true  
✅ `08:10:30` Tunnel shows as enabled in list  
✅ `08:10:30` Nginx vhost restored for re-enabled tunnel  
✅ `08:10:30` nginx -t passes after tunnel re-enable  
✅ `08:10:30` Re-enabled tunnel included in plist  

## Toggle nonexistent tunnel

✅ `08:10:30` Toggle nonexistent tunnel returns 404  

## Delete tunnel

✅ `08:10:32` Tunnel deletion returned ok: true  
✅ `08:10:32` Tunnel no longer in list after deletion  
✅ `08:10:32` Nginx vhost removed after tunnel deletion  
✅ `08:10:32` nginx -t passes after tunnel deletion  

## Delete nonexistent tunnel

✅ `08:10:32` Delete nonexistent tunnel returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `30` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `30` |

