# Lamaste E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-11-11 09:00:22 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `09:00:23` Site creation via admin cert returned ok: true  
✅ `09:00:23` Site has an ID  
✅ `09:00:23` Site has an FQDN  
ℹ️ `09:00:23` Created site: e2esite.test.lamaste.local (ID: 03c5484e-7437-436d-9976-086241f8b6db)  

## Generate agent cert with sites capabilities and allowedSites

✅ `09:00:24` Agent cert creation returned ok: true  
✅ `09:00:24` Agent cert has a p12 password  
✅ `09:00:24` Agent cert label matches  
ℹ️ `09:00:24` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `09:00:24` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `09:00:24` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `09:00:24` Agent can list sites and find assigned site  
✅ `09:00:24` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `09:00:27` Site returns HTTP 200 from visitor VM  
✅ `09:00:27` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `09:00:27` Upload of .php file rejected with 400  
✅ `09:00:27` Upload of .exe file rejected with 400  
✅ `09:00:28` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `09:00:28` Site deletion via admin cert returned ok: true  
✅ `09:00:28` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `09:00:30` No-perm agent cert creation returned ok: true  
✅ `09:00:31` Agent without site in allowedSites rejected with 403 on file upload  
✅ `09:00:31` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `09:00:31` Cleaning up test resources...  
