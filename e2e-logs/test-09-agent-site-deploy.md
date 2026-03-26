# Portlama E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-03-26 10:50:39 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `10:50:39` Site creation via admin cert returned ok: true  
✅ `10:50:39` Site has an ID  
✅ `10:50:39` Site has an FQDN  
ℹ️ `10:50:39` Created site: e2esite.test.portlama.local (ID: a216524c-ca50-4f12-baf3-fbc37b311e34)  

## Generate agent cert with sites capabilities and allowedSites

✅ `10:50:41` Agent cert creation returned ok: true  
✅ `10:50:41` Agent cert has a p12 password  
✅ `10:50:41` Agent cert label matches  
ℹ️ `10:50:41` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `10:50:41` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `10:50:41` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `10:50:41` Agent can list sites and find assigned site  
✅ `10:50:41` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `10:50:43` Site returns HTTP 200 from visitor VM  
✅ `10:50:44` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `10:50:44` Upload of .php file rejected with 400  
✅ `10:50:44` Upload of .exe file rejected with 400  
✅ `10:50:44` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `10:50:44` Site deletion via admin cert returned ok: true  
✅ `10:50:44` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `10:50:46` No-perm agent cert creation returned ok: true  
✅ `10:50:46` Agent without site in allowedSites rejected with 403 on file upload  
✅ `10:50:46` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `10:50:46` Cleaning up test resources...  
🔵 `10:50:47` **Running: 11-plugin-lifecycle.sh**  
