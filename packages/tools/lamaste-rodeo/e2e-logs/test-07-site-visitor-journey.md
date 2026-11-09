# Lamaste E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-11-09 12:38:35 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `12:38:36` Site creation returned ok: true  
✅ `12:38:36` Site has an ID  
ℹ️ `12:38:36` Created site ID: 06e323b8-f612-4e75-af2a-a7d4fc2a909a (e2eblog.test.lamaste.local)  
✅ `12:38:36` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `12:38:36` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `12:38:38` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `12:38:39` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Reset TOTP before authentication

✅ `12:38:39` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `12:39:02` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `12:39:02` Generated TOTP code with oathtool on visitor VM  
✅ `12:39:02` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `12:39:02` Authenticated request returns site content  
✅ `12:39:02` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `12:39:03` Disable Authelia protection returned ok: true  
✅ `12:39:03` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `12:39:05` Unprotected site returns HTTP 200 without auth  
✅ `12:39:05` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `12:39:06` Re-enable Authelia protection returned ok: true  
✅ `12:39:06` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `12:39:08` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `12:39:08` Site deletion returned ok: true  
✅ `12:39:08` Site no longer appears in site list after deletion  

## Custom-domain site with an alias: create and verify DNS

✅ `12:39:09` Custom site with alias www.e2e-alias-1794227915.test created  
✅ `12:39:10` verify-dns succeeds for the domain and its alias  
✅ `12:39:10` One certificate lineage covers the domain and www.e2e-alias-1794227915.test  

## Visitor follows the alias to the site's domain

✅ `12:39:11` Alias answers 301 to the same path on the site's domain (TLS verified)  
✅ `12:39:11` Following the alias serves the site's content  

## Add an alias to the live site

✅ `12:39:11` Alias blog.e2e-alias-1794227915.test added to the live site  
✅ `12:39:14` New alias answers 301 with a certificate that names it  

## Cleanup: delete the custom-domain site

✅ `12:39:14` Custom-domain site deleted  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `29` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `29` |

ℹ️ `12:39:14` Cleaning up test resources...  
