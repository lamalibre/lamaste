# Lamaste E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-04-30 08:59:23 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `08:59:23` Site creation via admin cert returned ok: true  
✅ `08:59:23` Site has an ID  
✅ `08:59:23` Site has an FQDN  
ℹ️ `08:59:23` Created site: e2esite.test.lamaste.local (ID: 8086db1c-2199-4402-ab83-4ee29a441ee8)  

## Generate agent cert with sites capabilities and allowedSites

✅ `08:59:24` Agent cert creation returned ok: true  
✅ `08:59:24` Agent cert has a p12 password  
✅ `08:59:24` Agent cert label matches  
ℹ️ `08:59:24` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `08:59:25` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `08:59:25` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `08:59:25` Agent can list sites and find assigned site  
✅ `08:59:25` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `08:59:28` Site returns HTTP 200 from visitor VM  
✅ `08:59:28` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `08:59:28` Upload of .php file rejected with 400  
✅ `08:59:28` Upload of .exe file rejected with 400  
✅ `08:59:28` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `08:59:28` Site deletion via admin cert returned ok: true  
✅ `08:59:29` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `08:59:30` No-perm agent cert creation returned ok: true  
✅ `08:59:31` Agent without site in allowedSites rejected with 403 on file upload  
✅ `08:59:31` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `08:59:31` Cleaning up test resources...  
