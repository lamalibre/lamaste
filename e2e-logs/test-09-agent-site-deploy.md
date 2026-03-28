# Portlama E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-03-28 22:42:45 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `22:42:46` Site creation via admin cert returned ok: true  
✅ `22:42:46` Site has an ID  
✅ `22:42:46` Site has an FQDN  
ℹ️ `22:42:46` Created site: e2esite.test.portlama.local (ID: be689eee-d36f-4694-ac1b-5aed909aa908)  

## Generate agent cert with sites capabilities and allowedSites

✅ `22:42:47` Agent cert creation returned ok: true  
✅ `22:42:47` Agent cert has a p12 password  
✅ `22:42:47` Agent cert label matches  
ℹ️ `22:42:47` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `22:42:48` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `22:42:48` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `22:42:48` Agent can list sites and find assigned site  
✅ `22:42:48` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `22:42:50` Site returns HTTP 200 from visitor VM  
✅ `22:42:50` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `22:42:50` Upload of .php file rejected with 400  
✅ `22:42:51` Upload of .exe file rejected with 400  
✅ `22:42:51` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `22:42:51` Site deletion via admin cert returned ok: true  
✅ `22:42:51` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `22:42:53` No-perm agent cert creation returned ok: true  
✅ `22:42:54` Agent without site in allowedSites rejected with 403 on file upload  
✅ `22:42:54` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `22:42:54` Cleaning up test resources...  
🔵 `22:42:54` **Running: 11-plugin-lifecycle.sh**  
