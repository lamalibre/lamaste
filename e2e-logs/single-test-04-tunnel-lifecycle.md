# Portlama E2E: 04 — Tunnel Lifecycle

> Started at `2026-03-19 12:17:00 UTC`


## Pre-flight: check onboarding is complete


## Create tunnel

✅ `12:17:03` Tunnel creation returned ok: true  
✅ `12:17:03` Tunnel subdomain matches  
✅ `12:17:03` Tunnel port matches  
✅ `12:17:03` Tunnel has an ID  
✅ `12:17:03` Tunnel has an FQDN  
✅ `12:17:03` Tunnel has a createdAt timestamp  
ℹ️ `12:17:03` Created tunnel ID: 500a2ebf-3ce1-4aa5-baf1-770d68cdab87  

## Verify tunnel in list

✅ `12:17:03` Tunnel appears in GET /api/tunnels  

## Verify nginx configuration

✅ `12:17:03` Nginx vhost exists at /etc/nginx/sites-enabled/portlama-app-e2etest-1773922620  
✅ `12:17:03` nginx -t passes after tunnel creation  

## Validation: reserved subdomain

✅ `12:17:03` Reserved subdomain 'panel' rejected (HTTP 400)  

## Validation: duplicate subdomain

✅ `12:17:03` Duplicate subdomain rejected (HTTP 400)  

## Validation: duplicate port

✅ `12:17:03` Duplicate port rejected (HTTP 400)  

## Validation: invalid port

✅ `12:17:03` Port below 1024 rejected (HTTP 400)  

## Mac plist endpoint

✅ `12:17:03` Mac plist endpoint returns plist content  

## Disable tunnel

✅ `12:17:05` Tunnel disable returned ok: true  
✅ `12:17:05` Tunnel shows as disabled in list  
✅ `12:17:05` Nginx sites-enabled symlink removed for disabled tunnel  
✅ `12:17:05` nginx -t passes after tunnel disable  
✅ `12:17:05` Disabled tunnel excluded from plist  

## Re-enable tunnel

✅ `12:17:08` Tunnel re-enable returned ok: true  
✅ `12:17:08` Tunnel shows as enabled in list  
✅ `12:17:08` Nginx vhost restored for re-enabled tunnel  
✅ `12:17:08` nginx -t passes after tunnel re-enable  
✅ `12:17:08` Re-enabled tunnel included in plist  

## Toggle nonexistent tunnel

✅ `12:17:08` Toggle nonexistent tunnel returns 404  

## Delete tunnel

✅ `12:17:10` Tunnel deletion returned ok: true  
✅ `12:17:10` Tunnel no longer in list after deletion  
✅ `12:17:10` Nginx vhost removed after tunnel deletion  
✅ `12:17:10` nginx -t passes after tunnel deletion  

## Delete nonexistent tunnel

✅ `12:17:10` Delete nonexistent tunnel returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `30` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `30` |

