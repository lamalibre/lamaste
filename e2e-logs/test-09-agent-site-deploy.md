# Portlama E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-03-19 12:20:12 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `12:20:13` Site creation via admin cert returned ok: true  
✅ `12:20:13` Site has an ID  
✅ `12:20:13` Site has an FQDN  
ℹ️ `12:20:13` Created site: e2esite.test.portlama.local (ID: a7a36bd3-c40a-44c4-bfc4-2316e6b60e15)  

## Generate agent cert with sites capabilities and allowedSites

✅ `12:20:14` Agent cert creation returned ok: true  
✅ `12:20:14` Agent cert has a p12 password  
✅ `12:20:14` Agent cert label matches  
ℹ️ `12:20:14` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `12:20:14` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `12:20:14` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `12:20:15` Agent can list sites and find assigned site  
✅ `12:20:15` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `12:20:17` Site returns HTTP 200 from visitor VM  
✅ `12:20:17` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `12:20:17` Upload of .php file rejected with 400  
✅ `12:20:17` Upload of .exe file rejected with 400  
✅ `12:20:17` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `12:20:18` Site deletion via admin cert returned ok: true  
✅ `12:20:18` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `12:20:19` No-perm agent cert creation returned ok: true  
✅ `12:20:19` Agent without site in allowedSites rejected with 403 on file upload  
✅ `12:20:19` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `12:20:19` Cleaning up test resources...  
