# Portlama E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-03-29 09:12:21 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `09:12:21` Site creation via admin cert returned ok: true  
✅ `09:12:21` Site has an ID  
✅ `09:12:21` Site has an FQDN  
ℹ️ `09:12:22` Created site: e2esite.test.portlama.local (ID: 3359d23d-8b1d-44f2-98bd-5703c3a525a4)  

## Generate agent cert with sites capabilities and allowedSites

✅ `09:12:22` Agent cert creation returned ok: true  
✅ `09:12:22` Agent cert has a p12 password  
✅ `09:12:22` Agent cert label matches  
ℹ️ `09:12:22` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `09:12:23` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `09:12:23` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `09:12:23` Agent can list sites and find assigned site  
✅ `09:12:23` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `09:12:25` Site returns HTTP 200 from visitor VM  
✅ `09:12:25` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `09:12:25` Upload of .php file rejected with 400  
✅ `09:12:25` Upload of .exe file rejected with 400  
✅ `09:12:26` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `09:12:26` Site deletion via admin cert returned ok: true  
✅ `09:12:26` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `09:12:28` No-perm agent cert creation returned ok: true  
✅ `09:12:28` Agent without site in allowedSites rejected with 403 on file upload  
✅ `09:12:28` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `09:12:28` Cleaning up test resources...  
🔵 `09:12:29` **Running: 11-plugin-lifecycle.sh**  
