# Lamaste E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-11-10 17:43:37 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `17:43:38` Site creation returned ok: true  
✅ `17:43:38` Site has an ID  
ℹ️ `17:43:38` Created site ID: 6d90ebf4-27ea-4916-8861-35b961bb187b (e2eblog.test.lamaste.local)  
✅ `17:43:38` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `17:43:39` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `17:43:41` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `17:43:41` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Reset TOTP before authentication

✅ `17:43:41` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `17:44:02` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `17:44:03` Generated TOTP code with oathtool on visitor VM  
✅ `17:44:03` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `17:44:03` Authenticated request returns site content  
✅ `17:44:03` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `17:44:04` Disable Authelia protection returned ok: true  
✅ `17:44:04` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `17:44:07` Unprotected site returns HTTP 200 without auth  
✅ `17:44:07` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `17:44:08` Re-enable Authelia protection returned ok: true  
✅ `17:44:08` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `17:44:10` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `17:44:10` Site deletion returned ok: true  
✅ `17:44:10` Site no longer appears in site list after deletion  

## Custom-domain site with an alias: create and verify DNS

✅ `17:44:11` Custom site with alias www.e2e-alias-1794332617.test created  
✅ `17:44:12` verify-dns succeeds for the domain and its alias  
✅ `17:44:13` One certificate lineage covers the domain and www.e2e-alias-1794332617.test  

## Visitor follows the alias to the site's domain

✅ `17:44:13` Alias answers 301 to the same path on the site's domain (TLS verified)  
✅ `17:44:13` Following the alias serves the site's content  

## Add an alias to the live site

✅ `17:44:14` Alias blog.e2e-alias-1794332617.test added to the live site  
✅ `17:44:16` New alias answers 301 with a certificate that names it  

## Cleanup: delete the custom-domain site

✅ `17:44:16` Custom-domain site deleted  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `29` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `29` |

ℹ️ `17:44:16` Cleaning up test resources...  
