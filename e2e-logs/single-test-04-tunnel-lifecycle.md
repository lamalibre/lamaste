# Lamaste E2E: 04 — Tunnel Lifecycle

> Started at `2026-03-30 13:06:17 UTC`


## Pre-flight: check onboarding is complete


## Create tunnel

✅ `13:06:19` Tunnel creation returned ok: true  
✅ `13:06:19` Tunnel subdomain matches  
✅ `13:06:19` Tunnel port matches  
✅ `13:06:19` Tunnel has an ID  
✅ `13:06:19` Tunnel has an FQDN  
✅ `13:06:19` Tunnel has a createdAt timestamp  
ℹ️ `13:06:19` Created tunnel ID: 27bd6d45-1509-4eaa-9c5a-291050c779c1  

## Verify tunnel in list

✅ `13:06:19` Tunnel appears in GET /api/tunnels  

## Verify nginx configuration

✅ `13:06:19` Nginx vhost exists at /etc/nginx/sites-enabled/lamaste-app-e2etest-1774875977  
✅ `13:06:19` nginx -t passes after tunnel creation  

## Validation: reserved subdomain

✅ `13:06:20` Reserved subdomain 'panel' rejected (HTTP 400)  

## Validation: duplicate subdomain

✅ `13:06:20` Duplicate subdomain rejected (HTTP 400)  

## Validation: duplicate port

✅ `13:06:20` Duplicate port rejected (HTTP 400)  

## Validation: invalid port

✅ `13:06:20` Port below 1024 rejected (HTTP 400)  

## Mac plist endpoint

✅ `13:06:20` Mac plist endpoint returns plist content  

## Disable tunnel

✅ `13:06:22` Tunnel disable returned ok: true  
✅ `13:06:22` Tunnel shows as disabled in list  
✅ `13:06:22` Nginx sites-enabled symlink removed for disabled tunnel  
✅ `13:06:22` nginx -t passes after tunnel disable  
✅ `13:06:22` Disabled tunnel excluded from plist  

## Re-enable tunnel

✅ `13:06:24` Tunnel re-enable returned ok: true  
✅ `13:06:24` Tunnel shows as enabled in list  
✅ `13:06:24` Nginx vhost restored for re-enabled tunnel  
✅ `13:06:24` nginx -t passes after tunnel re-enable  
✅ `13:06:24` Re-enabled tunnel included in plist  

## Toggle nonexistent tunnel

✅ `13:06:24` Toggle nonexistent tunnel returns 404  

## Delete tunnel

✅ `13:06:26` Tunnel deletion returned ok: true  
✅ `13:06:27` Tunnel no longer in list after deletion  
✅ `13:06:27` Nginx vhost removed after tunnel deletion  
✅ `13:06:27` nginx -t passes after tunnel deletion  

## Delete nonexistent tunnel

✅ `13:06:27` Delete nonexistent tunnel returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `30` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `30` |

