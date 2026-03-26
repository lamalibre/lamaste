# Portlama E2E: 04 — Tunnel Lifecycle

> Started at `2026-03-26 10:46:07 UTC`


## Pre-flight: check onboarding is complete


## Create tunnel

✅ `10:46:09` Tunnel creation returned ok: true  
✅ `10:46:09` Tunnel subdomain matches  
✅ `10:46:09` Tunnel port matches  
✅ `10:46:09` Tunnel has an ID  
✅ `10:46:09` Tunnel has an FQDN  
✅ `10:46:09` Tunnel has a createdAt timestamp  
ℹ️ `10:46:09` Created tunnel ID: dab670ce-9661-464f-b2f8-781923a39d22  

## Verify tunnel in list

✅ `10:46:09` Tunnel appears in GET /api/tunnels  

## Verify nginx configuration

✅ `10:46:09` Nginx vhost exists at /etc/nginx/sites-enabled/portlama-app-e2etest-1774521967  
✅ `10:46:09` nginx -t passes after tunnel creation  

## Validation: reserved subdomain

✅ `10:46:09` Reserved subdomain 'panel' rejected (HTTP 400)  

## Validation: duplicate subdomain

✅ `10:46:09` Duplicate subdomain rejected (HTTP 400)  

## Validation: duplicate port

✅ `10:46:09` Duplicate port rejected (HTTP 400)  

## Validation: invalid port

✅ `10:46:09` Port below 1024 rejected (HTTP 400)  

## Mac plist endpoint

✅ `10:46:09` Mac plist endpoint returns plist content  

## Disable tunnel

✅ `10:46:11` Tunnel disable returned ok: true  
✅ `10:46:11` Tunnel shows as disabled in list  
✅ `10:46:11` Nginx sites-enabled symlink removed for disabled tunnel  
✅ `10:46:12` nginx -t passes after tunnel disable  
✅ `10:46:12` Disabled tunnel excluded from plist  

## Re-enable tunnel

✅ `10:46:14` Tunnel re-enable returned ok: true  
✅ `10:46:14` Tunnel shows as enabled in list  
✅ `10:46:14` Nginx vhost restored for re-enabled tunnel  
✅ `10:46:14` nginx -t passes after tunnel re-enable  
✅ `10:46:14` Re-enabled tunnel included in plist  

## Toggle nonexistent tunnel

✅ `10:46:14` Toggle nonexistent tunnel returns 404  

## Delete tunnel

✅ `10:46:16` Tunnel deletion returned ok: true  
✅ `10:46:16` Tunnel no longer in list after deletion  
✅ `10:46:16` Nginx vhost removed after tunnel deletion  
✅ `10:46:16` nginx -t passes after tunnel deletion  

## Delete nonexistent tunnel

✅ `10:46:16` Delete nonexistent tunnel returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `30` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `30` |

