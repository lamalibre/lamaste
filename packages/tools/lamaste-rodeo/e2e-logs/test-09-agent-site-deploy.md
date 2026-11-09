# Lamaste E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-11-09 12:39:20 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `12:39:21` Site creation via admin cert returned ok: true  
✅ `12:39:21` Site has an ID  
✅ `12:39:21` Site has an FQDN  
ℹ️ `12:39:21` Created site: e2esite.test.lamaste.local (ID: d32dcb06-7770-40c7-92af-4ca07de46dc7)  

## Generate agent cert with sites capabilities and allowedSites

✅ `12:39:22` Agent cert creation returned ok: true  
✅ `12:39:22` Agent cert has a p12 password  
✅ `12:39:22` Agent cert label matches  
ℹ️ `12:39:22` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `12:39:22` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `12:39:22` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `12:39:22` Agent can list sites and find assigned site  
✅ `12:39:22` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `12:39:25` Site returns HTTP 200 from visitor VM  
✅ `12:39:25` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `12:39:25` Upload of .php file rejected with 400  
✅ `12:39:25` Upload of .exe file rejected with 400  
✅ `12:39:25` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `12:39:26` Site deletion via admin cert returned ok: true  
✅ `12:39:26` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `12:39:28` No-perm agent cert creation returned ok: true  
✅ `12:39:29` Agent without site in allowedSites rejected with 403 on file upload  
✅ `12:39:29` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `12:39:29` Cleaning up test resources...  
