# Lamaste E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-11-04 13:31:53 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `13:31:55` Site creation via admin cert returned ok: true  
✅ `13:31:55` Site has an ID  
✅ `13:31:55` Site has an FQDN  
ℹ️ `13:31:55` Created site: e2esite.test.lamaste.local (ID: fa7e2acc-3a28-4fcc-85b8-22394fb463bf)  

## Generate agent cert with sites capabilities and allowedSites

✅ `13:31:57` Agent cert creation returned ok: true  
✅ `13:31:57` Agent cert has a p12 password  
✅ `13:31:57` Agent cert label matches  
ℹ️ `13:31:57` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `13:31:57` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `13:31:58` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `13:31:58` Agent can list sites and find assigned site  
✅ `13:31:58` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `13:32:01` Site returns HTTP 200 from visitor VM  
✅ `13:32:01` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `13:32:01` Upload of .php file rejected with 400  
✅ `13:32:01` Upload of .exe file rejected with 400  
✅ `13:32:02` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `13:32:02` Site deletion via admin cert returned ok: true  
✅ `13:32:02` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `13:32:05` No-perm agent cert creation returned ok: true  
✅ `13:32:06` Agent without site in allowedSites rejected with 403 on file upload  
✅ `13:32:06` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `13:32:06` Cleaning up test resources...  
