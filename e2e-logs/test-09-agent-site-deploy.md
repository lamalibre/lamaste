# Portlama E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-03-23 12:12:24 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `12:12:25` Site creation via admin cert returned ok: true  
✅ `12:12:25` Site has an ID  
✅ `12:12:25` Site has an FQDN  
ℹ️ `12:12:25` Created site: e2esite.test.portlama.local (ID: bae5f4d1-263d-4ec5-b9b0-2291dcc3caf4)  

## Generate agent cert with sites capabilities and allowedSites

✅ `12:12:26` Agent cert creation returned ok: true  
✅ `12:12:26` Agent cert has a p12 password  
✅ `12:12:26` Agent cert label matches  
ℹ️ `12:12:26` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `12:12:26` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `12:12:27` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `12:12:27` Agent can list sites and find assigned site  
✅ `12:12:27` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `12:12:29` Site returns HTTP 200 from visitor VM  
✅ `12:12:29` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `12:12:29` Upload of .php file rejected with 400  
✅ `12:12:30` Upload of .exe file rejected with 400  
✅ `12:12:30` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `12:12:30` Site deletion via admin cert returned ok: true  
✅ `12:12:30` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `12:12:32` No-perm agent cert creation returned ok: true  
✅ `12:12:33` Agent without site in allowedSites rejected with 403 on file upload  
✅ `12:12:33` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `12:12:33` Cleaning up test resources...  
🔵 `12:12:34` **Running: 10-shell-lifecycle.sh**  
