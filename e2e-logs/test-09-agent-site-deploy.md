# Portlama E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-03-24 08:13:43 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `08:13:43` Site creation via admin cert returned ok: true  
✅ `08:13:43` Site has an ID  
✅ `08:13:43` Site has an FQDN  
ℹ️ `08:13:43` Created site: e2esite.test.portlama.local (ID: 863cbbdb-4cca-434c-8ada-f3c07cc2d908)  

## Generate agent cert with sites capabilities and allowedSites

✅ `08:13:44` Agent cert creation returned ok: true  
✅ `08:13:44` Agent cert has a p12 password  
✅ `08:13:44` Agent cert label matches  
ℹ️ `08:13:44` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `08:13:45` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `08:13:45` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `08:13:45` Agent can list sites and find assigned site  
✅ `08:13:45` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `08:13:47` Site returns HTTP 200 from visitor VM  
✅ `08:13:47` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `08:13:47` Upload of .php file rejected with 400  
✅ `08:13:48` Upload of .exe file rejected with 400  
✅ `08:13:48` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `08:13:48` Site deletion via admin cert returned ok: true  
✅ `08:13:48` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `08:13:50` No-perm agent cert creation returned ok: true  
✅ `08:13:51` Agent without site in allowedSites rejected with 403 on file upload  
✅ `08:13:51` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `08:13:51` Cleaning up test resources...  
🔵 `08:13:51` **Running: 10-shell-lifecycle.sh**  
