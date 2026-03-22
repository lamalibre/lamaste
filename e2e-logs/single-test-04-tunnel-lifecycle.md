# Portlama E2E: 04 — Tunnel Lifecycle

> Started at `2026-03-22 18:24:28 UTC`


## Pre-flight: check onboarding is complete


## Create tunnel

✅ `18:24:31` Tunnel creation returned ok: true  
✅ `18:24:31` Tunnel subdomain matches  
✅ `18:24:31` Tunnel port matches  
✅ `18:24:31` Tunnel has an ID  
✅ `18:24:31` Tunnel has an FQDN  
✅ `18:24:31` Tunnel has a createdAt timestamp  
ℹ️ `18:24:31` Created tunnel ID: 1b5d3efb-3e5b-4fe3-9b78-1c4687d8ce62  

## Verify tunnel in list

✅ `18:24:31` Tunnel appears in GET /api/tunnels  

## Verify nginx configuration

✅ `18:24:31` Nginx vhost exists at /etc/nginx/sites-enabled/portlama-app-e2etest-1774203868  
✅ `18:24:31` nginx -t passes after tunnel creation  

## Validation: reserved subdomain

✅ `18:24:31` Reserved subdomain 'panel' rejected (HTTP 400)  

## Validation: duplicate subdomain

✅ `18:24:31` Duplicate subdomain rejected (HTTP 400)  

## Validation: duplicate port

✅ `18:24:31` Duplicate port rejected (HTTP 400)  

## Validation: invalid port

✅ `18:24:31` Port below 1024 rejected (HTTP 400)  

## Mac plist endpoint

✅ `18:24:31` Mac plist endpoint returns plist content  

## Disable tunnel

✅ `18:24:33` Tunnel disable returned ok: true  
✅ `18:24:33` Tunnel shows as disabled in list  
✅ `18:24:33` Nginx sites-enabled symlink removed for disabled tunnel  
✅ `18:24:33` nginx -t passes after tunnel disable  
✅ `18:24:33` Disabled tunnel excluded from plist  

## Re-enable tunnel

✅ `18:24:36` Tunnel re-enable returned ok: true  
✅ `18:24:36` Tunnel shows as enabled in list  
✅ `18:24:36` Nginx vhost restored for re-enabled tunnel  
✅ `18:24:36` nginx -t passes after tunnel re-enable  
✅ `18:24:36` Re-enabled tunnel included in plist  

## Toggle nonexistent tunnel

✅ `18:24:36` Toggle nonexistent tunnel returns 404  

## Delete tunnel

✅ `18:24:38` Tunnel deletion returned ok: true  
✅ `18:24:38` Tunnel no longer in list after deletion  
✅ `18:24:38` Nginx vhost removed after tunnel deletion  
✅ `18:24:38` nginx -t passes after tunnel deletion  

## Delete nonexistent tunnel

✅ `18:24:38` Delete nonexistent tunnel returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `30` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `30` |

