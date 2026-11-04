# Lamaste E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-11-04 13:31:05 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `13:31:06` Site creation returned ok: true  
✅ `13:31:06` Site has an ID  
ℹ️ `13:31:06` Created site ID: fe01b521-a00a-4028-b7d0-85ed928f06cb (e2eblog.test.lamaste.local)  
✅ `13:31:06` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `13:31:06` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `13:31:09` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `13:31:09` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Reset TOTP before authentication

✅ `13:31:09` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `13:31:33` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `13:31:33` Generated TOTP code with oathtool on visitor VM  
✅ `13:31:33` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `13:31:33` Authenticated request returns site content  
✅ `13:31:33` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `13:31:34` Disable Authelia protection returned ok: true  
✅ `13:31:34` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `13:31:37` Unprotected site returns HTTP 200 without auth  
✅ `13:31:37` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `13:31:38` Re-enable Authelia protection returned ok: true  
✅ `13:31:38` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `13:31:40` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `13:31:40` Site deletion returned ok: true  
✅ `13:31:40` Site no longer appears in site list after deletion  

## Custom-domain site with an alias: create and verify DNS

✅ `13:31:41` Custom site with alias www.e2e-alias-1793799065.test created  
✅ `13:31:42` verify-dns succeeds for the domain and its alias  
✅ `13:31:43` One certificate lineage covers the domain and www.e2e-alias-1793799065.test  

## Visitor follows the alias to the site's domain

✅ `13:31:43` Alias answers 301 to the same path on the site's domain (TLS verified)  
✅ `13:31:43` Following the alias serves the site's content  

## Add an alias to the live site

✅ `13:31:44` Alias blog.e2e-alias-1793799065.test added to the live site  
✅ `13:31:46` New alias answers 301 with a certificate that names it  

## Cleanup: delete the custom-domain site

✅ `13:31:46` Custom-domain site deleted  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `29` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `29` |

ℹ️ `13:31:46` Cleaning up test resources...  
