# Lamaste E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-10-13 11:45:35 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `11:45:36` Site creation returned ok: true  
✅ `11:45:36` Site has an ID  
ℹ️ `11:45:36` Created site ID: 8c5b63d2-5952-4548-bede-dbebfdee8839 (e2eblog.test.lamaste.local)  
✅ `11:45:36` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `11:45:36` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `11:45:38` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `11:45:38` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Reset TOTP before authentication

✅ `11:45:39` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `11:46:02` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `11:46:02` Generated TOTP code with oathtool on visitor VM  
✅ `11:46:02` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `11:46:02` Authenticated request returns site content  
✅ `11:46:02` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `11:46:05` Disable Authelia protection returned ok: true  
✅ `11:46:05` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `11:46:07` Unprotected site returns HTTP 200 without auth  
✅ `11:46:07` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `11:46:10` Re-enable Authelia protection returned ok: true  
✅ `11:46:10` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `11:46:12` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `11:46:13` Site deletion returned ok: true  
✅ `11:46:13` Site no longer appears in site list after deletion  

## Custom-domain site with an alias: create and verify DNS

✅ `11:46:13` Custom site with alias www.e2e-alias-1791891935.test created  
✅ `11:46:15` verify-dns succeeds for the domain and its alias  
✅ `11:46:15` One certificate lineage covers the domain and www.e2e-alias-1791891935.test  

## Visitor follows the alias to the site's domain

✅ `11:46:15` Alias answers 301 to the same path on the site's domain (TLS verified)  
✅ `11:46:15` Following the alias serves the site's content  

## Add an alias to the live site

✅ `11:46:16` Alias blog.e2e-alias-1791891935.test added to the live site  
✅ `11:46:18` New alias answers 301 with a certificate that names it  

## Cleanup: delete the custom-domain site

✅ `11:46:18` Custom-domain site deleted  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `29` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `29` |

ℹ️ `11:46:18` Cleaning up test resources...  
