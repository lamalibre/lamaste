# Lamaste E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-11-03 09:26:34 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `09:26:35` Site creation returned ok: true  
✅ `09:26:35` Site has an ID  
ℹ️ `09:26:35` Created site ID: 4ca697ff-3d9e-444e-b6ee-8563554af3f6 (e2eblog.test.lamaste.local)  
✅ `09:26:35` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `09:26:35` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `09:26:38` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `09:26:38` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Reset TOTP before authentication

✅ `09:26:38` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `09:27:02` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `09:27:02` Generated TOTP code with oathtool on visitor VM  
✅ `09:27:02` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `09:27:03` Authenticated request returns site content  
✅ `09:27:03` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `09:27:03` Disable Authelia protection returned ok: true  
✅ `09:27:03` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `09:27:06` Unprotected site returns HTTP 200 without auth  
✅ `09:27:06` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `09:27:06` Re-enable Authelia protection returned ok: true  
✅ `09:27:06` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `09:27:09` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `09:27:09` Site deletion returned ok: true  
✅ `09:27:09` Site no longer appears in site list after deletion  

## Custom-domain site with an alias: create and verify DNS

✅ `09:27:09` Custom site with alias www.e2e-alias-1793697994.test created  
✅ `09:27:11` verify-dns succeeds for the domain and its alias  
✅ `09:27:11` One certificate lineage covers the domain and www.e2e-alias-1793697994.test  

## Visitor follows the alias to the site's domain

✅ `09:27:11` Alias answers 301 to the same path on the site's domain (TLS verified)  
✅ `09:27:11` Following the alias serves the site's content  

## Add an alias to the live site

✅ `09:27:12` Alias blog.e2e-alias-1793697994.test added to the live site  
✅ `09:27:14` New alias answers 301 with a certificate that names it  

## Cleanup: delete the custom-domain site

✅ `09:27:14` Custom-domain site deleted  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `29` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `29` |

ℹ️ `09:27:14` Cleaning up test resources...  
