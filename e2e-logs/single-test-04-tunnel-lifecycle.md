# Portlama E2E: 04 — Tunnel Lifecycle

> Started at `2026-03-23 12:08:55 UTC`


## Pre-flight: check onboarding is complete


## Create tunnel

✅ `12:08:57` Tunnel creation returned ok: true  
✅ `12:08:57` Tunnel subdomain matches  
✅ `12:08:57` Tunnel port matches  
✅ `12:08:57` Tunnel has an ID  
✅ `12:08:57` Tunnel has an FQDN  
✅ `12:08:57` Tunnel has a createdAt timestamp  
ℹ️ `12:08:57` Created tunnel ID: 264df70d-5cdf-4796-8fb8-c5dba90c5029  

## Verify tunnel in list

✅ `12:08:57` Tunnel appears in GET /api/tunnels  

## Verify nginx configuration

✅ `12:08:57` Nginx vhost exists at /etc/nginx/sites-enabled/portlama-app-e2etest-1774267735  
✅ `12:08:57` nginx -t passes after tunnel creation  

## Validation: reserved subdomain

✅ `12:08:57` Reserved subdomain 'panel' rejected (HTTP 400)  

## Validation: duplicate subdomain

✅ `12:08:57` Duplicate subdomain rejected (HTTP 400)  

## Validation: duplicate port

✅ `12:08:58` Duplicate port rejected (HTTP 400)  

## Validation: invalid port

✅ `12:08:58` Port below 1024 rejected (HTTP 400)  

## Mac plist endpoint

✅ `12:08:58` Mac plist endpoint returns plist content  

## Disable tunnel

✅ `12:09:00` Tunnel disable returned ok: true  
✅ `12:09:00` Tunnel shows as disabled in list  
✅ `12:09:00` Nginx sites-enabled symlink removed for disabled tunnel  
✅ `12:09:00` nginx -t passes after tunnel disable  
✅ `12:09:00` Disabled tunnel excluded from plist  

## Re-enable tunnel

✅ `12:09:02` Tunnel re-enable returned ok: true  
✅ `12:09:02` Tunnel shows as enabled in list  
✅ `12:09:02` Nginx vhost restored for re-enabled tunnel  
✅ `12:09:02` nginx -t passes after tunnel re-enable  
✅ `12:09:02` Re-enabled tunnel included in plist  

## Toggle nonexistent tunnel

✅ `12:09:02` Toggle nonexistent tunnel returns 404  

## Delete tunnel

✅ `12:09:05` Tunnel deletion returned ok: true  
✅ `12:09:05` Tunnel no longer in list after deletion  
✅ `12:09:05` Nginx vhost removed after tunnel deletion  
✅ `12:09:05` nginx -t passes after tunnel deletion  

## Delete nonexistent tunnel

✅ `12:09:05` Delete nonexistent tunnel returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `30` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `30` |

