# Lamaste E2E: 09 — Agent Site Deploy (Three-VM)

> Started at `2026-11-10 17:44:24 UTC`


## Pre-flight: verify onboarding is complete


## Create managed site using admin cert

✅ `17:44:25` Site creation via admin cert returned ok: true  
✅ `17:44:25` Site has an ID  
✅ `17:44:25` Site has an FQDN  
ℹ️ `17:44:25` Created site: e2esite.test.lamaste.local (ID: ab3e88d6-7922-45f0-a892-ea350e5e1753)  

## Generate agent cert with sites capabilities and allowedSites

✅ `17:44:26` Agent cert creation returned ok: true  
✅ `17:44:26` Agent cert has a p12 password  
✅ `17:44:26` Agent cert label matches  
ℹ️ `17:44:26` Created agent cert: site-agent (allowedSites: [e2esite])  
✅ `17:44:26` Extracted PEM cert and key from .p12  

## Upload test HTML file using agent cert

✅ `17:44:26` File upload via agent cert returned ok: true  

## Verify site listing using agent cert (sites:read + allowedSites)

✅ `17:44:27` Agent can list sites and find assigned site  
✅ `17:44:27` Agent sees only its assigned site (count: 1)  

## Verify site accessible from visitor VM

✅ `17:44:29` Site returns HTTP 200 from visitor VM  
✅ `17:44:29` Site content matches uploaded HTML from visitor VM  

## File extension validation — disallowed extensions rejected

✅ `17:44:29` Upload of .php file rejected with 400  
✅ `17:44:30` Upload of .exe file rejected with 400  
✅ `17:44:30` Upload of .css file succeeds via agent cert  

## Delete site using admin cert (site CRUD is admin-only)

✅ `17:44:30` Site deletion via admin cert returned ok: true  
✅ `17:44:30` Deleted site no longer in listing  

## Negative test: agent WITHOUT site in allowedSites gets 403 on file upload

✅ `17:44:33` No-perm agent cert creation returned ok: true  
✅ `17:44:33` Agent without site in allowedSites rejected with 403 on file upload  
✅ `17:44:33` Agent sees only assigned sites (none match real sites)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `17:44:34` Cleaning up test resources...  
