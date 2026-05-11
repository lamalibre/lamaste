# Lamaste E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-03-30 13:11:28 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `13:11:29` Site creation via admin cert returned ok: true  
✅ `13:11:29` Site has an ID  
✅ `13:11:29` Site has an FQDN  
ℹ️ `13:11:29` Created site: e2esite.test.lamaste.local (ID: 5551ec71-3269-420f-8ea5-e51dcbf78d50)  

## Generate agent cert with sites capabilities and allowedSites

✅ `13:11:29` Agent cert creation returned ok: true  
✅ `13:11:29` Agent cert has a p12 password  
✅ `13:11:29` Agent cert label matches  
ℹ️ `13:11:30` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `13:11:30` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `13:11:30` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `13:11:30` Agent can list sites and find assigned site  
✅ `13:11:30` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `13:11:32` Site returns HTTP 200 from visitor VM  
✅ `13:11:32` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `13:11:33` Upload of .php file rejected with 400  
✅ `13:11:33` Upload of .exe file rejected with 400  
✅ `13:11:33` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `13:11:33` Site deletion via admin cert returned ok: true  
✅ `13:11:33` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `13:11:35` No-perm agent cert creation returned ok: true  
✅ `13:11:36` Agent without site in allowedSites rejected with 403 on file upload  
✅ `13:11:36` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `13:11:36` Cleaning up test resources...  
🔵 `13:11:36` **Running: 11-plugin-lifecycle.sh**  
