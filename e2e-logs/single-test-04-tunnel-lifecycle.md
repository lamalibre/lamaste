# Portlama E2E: 04 — Tunnel Lifecycle

> Started at `2026-03-20 14:33:29 UTC`


## Pre-flight: check onboarding is complete


## Create tunnel

✅ `14:33:32` Tunnel creation returned ok: true  
✅ `14:33:32` Tunnel subdomain matches  
✅ `14:33:32` Tunnel port matches  
✅ `14:33:32` Tunnel has an ID  
✅ `14:33:32` Tunnel has an FQDN  
✅ `14:33:32` Tunnel has a createdAt timestamp  
ℹ️ `14:33:32` Created tunnel ID: 8966cd1f-804f-47e6-93cc-ae162ef1cc44  

## Verify tunnel in list

✅ `14:33:32` Tunnel appears in GET /api/tunnels  

## Verify nginx configuration

✅ `14:33:32` Nginx vhost exists at /etc/nginx/sites-enabled/portlama-app-e2etest-1774017209  
✅ `14:33:32` nginx -t passes after tunnel creation  

## Validation: reserved subdomain

✅ `14:33:32` Reserved subdomain 'panel' rejected (HTTP 400)  

## Validation: duplicate subdomain

✅ `14:33:32` Duplicate subdomain rejected (HTTP 400)  

## Validation: duplicate port

✅ `14:33:32` Duplicate port rejected (HTTP 400)  

## Validation: invalid port

✅ `14:33:32` Port below 1024 rejected (HTTP 400)  

## Mac plist endpoint

✅ `14:33:32` Mac plist endpoint returns plist content  

## Disable tunnel

✅ `14:33:35` Tunnel disable returned ok: true  
✅ `14:33:35` Tunnel shows as disabled in list  
✅ `14:33:35` Nginx sites-enabled symlink removed for disabled tunnel  
✅ `14:33:35` nginx -t passes after tunnel disable  
✅ `14:33:35` Disabled tunnel excluded from plist  

## Re-enable tunnel

✅ `14:33:37` Tunnel re-enable returned ok: true  
✅ `14:33:37` Tunnel shows as enabled in list  
✅ `14:33:37` Nginx vhost restored for re-enabled tunnel  
✅ `14:33:37` nginx -t passes after tunnel re-enable  
✅ `14:33:37` Re-enabled tunnel included in plist  

## Toggle nonexistent tunnel

✅ `14:33:37` Toggle nonexistent tunnel returns 404  

## Delete tunnel

✅ `14:33:39` Tunnel deletion returned ok: true  
✅ `14:33:39` Tunnel no longer in list after deletion  
✅ `14:33:39` Nginx vhost removed after tunnel deletion  
✅ `14:33:39` nginx -t passes after tunnel deletion  

## Delete nonexistent tunnel

✅ `14:33:39` Delete nonexistent tunnel returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `30` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `30` |

