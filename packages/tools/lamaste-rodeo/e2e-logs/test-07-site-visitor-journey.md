# Lamaste E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-11-02 15:46:35 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `15:46:36` Site creation returned ok: true  
✅ `15:46:36` Site has an ID  
ℹ️ `15:46:36` Created site ID: 78926216-16f1-463e-8db7-5998f8d00a09 (e2eblog.test.lamaste.local)  
✅ `15:46:36` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `15:46:36` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `15:46:38` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `15:46:38` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Reset TOTP before authentication

✅ `15:46:39` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `15:47:02` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `15:47:02` Generated TOTP code with oathtool on visitor VM  
✅ `15:47:02` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `15:47:02` Authenticated request returns site content  
✅ `15:47:02` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `15:47:03` Disable Authelia protection returned ok: true  
✅ `15:47:03` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `15:47:05` Unprotected site returns HTTP 200 without auth  
✅ `15:47:05` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `15:47:06` Re-enable Authelia protection returned ok: true  
✅ `15:47:06` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `15:47:08` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `15:47:08` Site deletion returned ok: true  
✅ `15:47:08` Site no longer appears in site list after deletion  

## Custom-domain site with an alias: create and verify DNS

✅ `15:47:08` Custom site with alias www.e2e-alias-1793634395.test created  
✅ `15:47:10` verify-dns succeeds for the domain and its alias  
✅ `15:47:10` One certificate lineage covers the domain and www.e2e-alias-1793634395.test  

## Visitor follows the alias to the site's domain

✅ `15:47:10` Alias answers 301 to the same path on the site's domain (TLS verified)  
✅ `15:47:10` Following the alias serves the site's content  

## Add an alias to the live site

✅ `15:47:11` Alias blog.e2e-alias-1793634395.test added to the live site  
✅ `15:47:13` New alias answers 301 with a certificate that names it  

## Cleanup: delete the custom-domain site

✅ `15:47:14` Custom-domain site deleted  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `29` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `29` |

ℹ️ `15:47:14` Cleaning up test resources...  
