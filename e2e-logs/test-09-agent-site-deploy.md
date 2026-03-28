# Portlama E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-03-28 16:12:08 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `16:12:09` Site creation via admin cert returned ok: true  
✅ `16:12:09` Site has an ID  
✅ `16:12:09` Site has an FQDN  
ℹ️ `16:12:09` Created site: e2esite.test.portlama.local (ID: 4e0a7d86-f7aa-4bb5-b5c0-3b06f705d157)  

## Generate agent cert with sites capabilities and allowedSites

✅ `16:12:10` Agent cert creation returned ok: true  
✅ `16:12:10` Agent cert has a p12 password  
✅ `16:12:10` Agent cert label matches  
ℹ️ `16:12:10` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `16:12:10` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `16:12:10` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `16:12:10` Agent can list sites and find assigned site  
✅ `16:12:10` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `16:12:12` Site returns HTTP 200 from visitor VM  
✅ `16:12:12` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `16:12:13` Upload of .php file rejected with 400  
✅ `16:12:13` Upload of .exe file rejected with 400  
✅ `16:12:13` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `16:12:13` Site deletion via admin cert returned ok: true  
✅ `16:12:13` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `16:12:14` No-perm agent cert creation returned ok: true  
✅ `16:12:15` Agent without site in allowedSites rejected with 403 on file upload  
✅ `16:12:15` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `16:12:15` Cleaning up test resources...  
🔵 `16:12:15` **Running: 11-plugin-lifecycle.sh**  
