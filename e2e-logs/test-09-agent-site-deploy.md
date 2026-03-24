# Portlama E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-03-24 09:40:32 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `09:40:33` Site creation via admin cert returned ok: true  
✅ `09:40:33` Site has an ID  
✅ `09:40:33` Site has an FQDN  
ℹ️ `09:40:33` Created site: e2esite.test.portlama.local (ID: 4030f997-220a-4867-8d78-0a7119a2987d)  

## Generate agent cert with sites capabilities and allowedSites

✅ `09:40:34` Agent cert creation returned ok: true  
✅ `09:40:34` Agent cert has a p12 password  
✅ `09:40:34` Agent cert label matches  
ℹ️ `09:40:34` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `09:40:34` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `09:40:34` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `09:40:34` Agent can list sites and find assigned site  
✅ `09:40:34` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `09:40:37` Site returns HTTP 200 from visitor VM  
✅ `09:40:37` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `09:40:37` Upload of .php file rejected with 400  
✅ `09:40:37` Upload of .exe file rejected with 400  
✅ `09:40:37` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `09:40:38` Site deletion via admin cert returned ok: true  
✅ `09:40:38` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `09:40:39` No-perm agent cert creation returned ok: true  
✅ `09:40:39` Agent without site in allowedSites rejected with 403 on file upload  
✅ `09:40:39` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `09:40:39` Cleaning up test resources...  
🔵 `09:40:40` **Running: 11-plugin-lifecycle.sh**  
