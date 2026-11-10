# Lamaste E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-11-10 13:01:23 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `13:01:25` Site creation via admin cert returned ok: true  
✅ `13:01:25` Site has an ID  
✅ `13:01:25` Site has an FQDN  
ℹ️ `13:01:25` Created site: e2esite.test.lamaste.local (ID: e971e621-b4d8-42fd-855a-124e8d54c186)  

## Generate agent cert with sites capabilities and allowedSites

✅ `13:01:27` Agent cert creation returned ok: true  
✅ `13:01:27` Agent cert has a p12 password  
✅ `13:01:27` Agent cert label matches  
ℹ️ `13:01:27` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `13:01:27` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `13:01:28` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `13:01:28` Agent can list sites and find assigned site  
✅ `13:01:28` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `13:01:30` Site returns HTTP 200 from visitor VM  
✅ `13:01:31` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `13:01:31` Upload of .php file rejected with 400  
✅ `13:01:31` Upload of .exe file rejected with 400  
✅ `13:01:32` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `13:01:32` Site deletion via admin cert returned ok: true  
✅ `13:01:32` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `13:01:36` No-perm agent cert creation returned ok: true  
✅ `13:01:36` Agent without site in allowedSites rejected with 403 on file upload  
✅ `13:01:36` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `13:01:37` Cleaning up test resources...  
