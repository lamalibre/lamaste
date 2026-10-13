# Lamaste E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-10-13 11:46:29 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `11:46:30` Site creation via admin cert returned ok: true  
✅ `11:46:30` Site has an ID  
✅ `11:46:30` Site has an FQDN  
ℹ️ `11:46:30` Created site: e2esite.test.lamaste.local (ID: 584e2faf-9749-4912-830e-fe25d0e3030b)  

## Generate agent cert with sites capabilities and allowedSites

✅ `11:46:30` Agent cert creation returned ok: true  
✅ `11:46:30` Agent cert has a p12 password  
✅ `11:46:30` Agent cert label matches  
ℹ️ `11:46:30` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `11:46:31` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `11:46:31` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `11:46:31` Agent can list sites and find assigned site  
✅ `11:46:31` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `11:46:33` Site returns HTTP 200 from visitor VM  
✅ `11:46:33` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `11:46:33` Upload of .php file rejected with 400  
✅ `11:46:34` Upload of .exe file rejected with 400  
✅ `11:46:34` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `11:46:34` Site deletion via admin cert returned ok: true  
✅ `11:46:34` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `11:46:37` No-perm agent cert creation returned ok: true  
✅ `11:46:37` Agent without site in allowedSites rejected with 403 on file upload  
✅ `11:46:38` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `11:46:38` Cleaning up test resources...  
