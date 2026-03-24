# Portlama E2E: 04 — Tunnel Lifecycle

> Started at `2026-03-24 09:37:17 UTC`


## Pre-flight: check onboarding is complete


## Create tunnel

✅ `09:37:19` Tunnel creation returned ok: true  
✅ `09:37:19` Tunnel subdomain matches  
✅ `09:37:19` Tunnel port matches  
✅ `09:37:19` Tunnel has an ID  
✅ `09:37:19` Tunnel has an FQDN  
✅ `09:37:19` Tunnel has a createdAt timestamp  
ℹ️ `09:37:19` Created tunnel ID: 01934675-a03f-4662-9b62-a102c2172f1b  

## Verify tunnel in list

✅ `09:37:19` Tunnel appears in GET /api/tunnels  

## Verify nginx configuration

✅ `09:37:19` Nginx vhost exists at /etc/nginx/sites-enabled/portlama-app-e2etest-1774345037  
✅ `09:37:19` nginx -t passes after tunnel creation  

## Validation: reserved subdomain

✅ `09:37:19` Reserved subdomain 'panel' rejected (HTTP 400)  

## Validation: duplicate subdomain

✅ `09:37:19` Duplicate subdomain rejected (HTTP 400)  

## Validation: duplicate port

✅ `09:37:19` Duplicate port rejected (HTTP 400)  

## Validation: invalid port

✅ `09:37:19` Port below 1024 rejected (HTTP 400)  

## Mac plist endpoint

✅ `09:37:19` Mac plist endpoint returns plist content  

## Disable tunnel

✅ `09:37:22` Tunnel disable returned ok: true  
✅ `09:37:22` Tunnel shows as disabled in list  
✅ `09:37:22` Nginx sites-enabled symlink removed for disabled tunnel  
✅ `09:37:22` nginx -t passes after tunnel disable  
✅ `09:37:22` Disabled tunnel excluded from plist  

## Re-enable tunnel

✅ `09:37:24` Tunnel re-enable returned ok: true  
✅ `09:37:24` Tunnel shows as enabled in list  
✅ `09:37:24` Nginx vhost restored for re-enabled tunnel  
✅ `09:37:24` nginx -t passes after tunnel re-enable  
✅ `09:37:24` Re-enabled tunnel included in plist  

## Toggle nonexistent tunnel

✅ `09:37:24` Toggle nonexistent tunnel returns 404  

## Delete tunnel

✅ `09:37:26` Tunnel deletion returned ok: true  
✅ `09:37:26` Tunnel no longer in list after deletion  
✅ `09:37:26` Nginx vhost removed after tunnel deletion  
✅ `09:37:26` nginx -t passes after tunnel deletion  

## Delete nonexistent tunnel

✅ `09:37:26` Delete nonexistent tunnel returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `30` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `30` |

