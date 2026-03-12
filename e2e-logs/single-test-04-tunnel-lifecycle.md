# Portlama E2E: 04 — Tunnel Lifecycle

> Started at `2026-03-16 17:21:18 UTC`


## Pre-flight: check onboarding is complete


## Create tunnel

✅ `17:21:20` Tunnel creation returned ok: true  
✅ `17:21:20` Tunnel subdomain matches  
✅ `17:21:20` Tunnel port matches  
✅ `17:21:20` Tunnel has an ID  
✅ `17:21:20` Tunnel has an FQDN  
✅ `17:21:20` Tunnel has a createdAt timestamp  
ℹ️ `17:21:20` Created tunnel ID: 2c7bb1a4-b1c9-4515-a894-30e28b43c8bd  

## Verify tunnel in list

✅ `17:21:20` Tunnel appears in GET /api/tunnels  

## Verify nginx configuration

✅ `17:21:20` Nginx vhost exists at /etc/nginx/sites-enabled/portlama-app-e2etest-1773681678  
✅ `17:21:20` nginx -t passes after tunnel creation  

## Validation: reserved subdomain

✅ `17:21:20` Reserved subdomain 'panel' rejected (HTTP 400)  

## Validation: duplicate subdomain

✅ `17:21:20` Duplicate subdomain rejected (HTTP 400)  

## Validation: duplicate port

✅ `17:21:20` Duplicate port rejected (HTTP 400)  

## Validation: invalid port

✅ `17:21:20` Port below 1024 rejected (HTTP 400)  

## Mac plist endpoint

✅ `17:21:20` Mac plist endpoint returns plist content  

## Disable tunnel

✅ `17:21:22` Tunnel disable returned ok: true  
✅ `17:21:23` Tunnel shows as disabled in list  
✅ `17:21:23` Nginx sites-enabled symlink removed for disabled tunnel  
✅ `17:21:23` nginx -t passes after tunnel disable  
✅ `17:21:23` Disabled tunnel excluded from plist  

## Re-enable tunnel

✅ `17:21:25` Tunnel re-enable returned ok: true  
✅ `17:21:25` Tunnel shows as enabled in list  
✅ `17:21:25` Nginx vhost restored for re-enabled tunnel  
✅ `17:21:25` nginx -t passes after tunnel re-enable  
✅ `17:21:25` Re-enabled tunnel included in plist  

## Toggle nonexistent tunnel

✅ `17:21:25` Toggle nonexistent tunnel returns 404  

## Delete tunnel

✅ `17:21:27` Tunnel deletion returned ok: true  
✅ `17:21:27` Tunnel no longer in list after deletion  
✅ `17:21:27` Nginx vhost removed after tunnel deletion  
✅ `17:21:27` nginx -t passes after tunnel deletion  

## Delete nonexistent tunnel

✅ `17:21:27` Delete nonexistent tunnel returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `30` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `30` |

