# Portlama E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-03-20 14:36:45 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `14:36:45` Site creation via admin cert returned ok: true  
✅ `14:36:45` Site has an ID  
✅ `14:36:45` Site has an FQDN  
ℹ️ `14:36:45` Created site: e2esite.test.portlama.local (ID: 1af77a04-976c-4eee-8b92-66276c6d19c0)  

## Generate agent cert with sites capabilities and allowedSites

✅ `14:36:47` Agent cert creation returned ok: true  
✅ `14:36:47` Agent cert has a p12 password  
✅ `14:36:47` Agent cert label matches  
ℹ️ `14:36:47` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `14:36:47` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `14:36:48` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `14:36:48` Agent can list sites and find assigned site  
✅ `14:36:48` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `14:36:50` Site returns HTTP 200 from visitor VM  
✅ `14:36:50` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `14:36:50` Upload of .php file rejected with 400  
✅ `14:36:50` Upload of .exe file rejected with 400  
✅ `14:36:51` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `14:36:51` Site deletion via admin cert returned ok: true  
✅ `14:36:51` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `14:36:52` No-perm agent cert creation returned ok: true  
✅ `14:36:53` Agent without site in allowedSites rejected with 403 on file upload  
✅ `14:36:53` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `14:36:53` Cleaning up test resources...  
🔵 `14:36:53` **Running: 10-shell-lifecycle.sh**  
