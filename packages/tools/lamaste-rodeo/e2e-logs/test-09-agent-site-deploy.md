# Lamaste E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-11-02 15:47:20 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `15:47:20` Site creation via admin cert returned ok: true  
✅ `15:47:20` Site has an ID  
✅ `15:47:20` Site has an FQDN  
ℹ️ `15:47:20` Created site: e2esite.test.lamaste.local (ID: ceb27b3c-ea42-453c-b4ea-0a43a5d35f50)  

## Generate agent cert with sites capabilities and allowedSites

✅ `15:47:21` Agent cert creation returned ok: true  
✅ `15:47:21` Agent cert has a p12 password  
✅ `15:47:21` Agent cert label matches  
ℹ️ `15:47:21` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `15:47:22` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `15:47:22` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `15:47:22` Agent can list sites and find assigned site  
✅ `15:47:22` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `15:47:24` Site returns HTTP 200 from visitor VM  
✅ `15:47:24` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `15:47:25` Upload of .php file rejected with 400  
✅ `15:47:25` Upload of .exe file rejected with 400  
✅ `15:47:25` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `15:47:25` Site deletion via admin cert returned ok: true  
✅ `15:47:25` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `15:47:27` No-perm agent cert creation returned ok: true  
✅ `15:47:28` Agent without site in allowedSites rejected with 403 on file upload  
✅ `15:47:28` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `15:47:28` Cleaning up test resources...  
