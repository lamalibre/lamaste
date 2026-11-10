# Lamaste E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-11-10 13:00:36 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `13:00:37` Site creation returned ok: true  
✅ `13:00:37` Site has an ID  
ℹ️ `13:00:37` Created site ID: 0631d6f0-c07b-49a2-b2cf-13d3a78f01e0 (e2eblog.test.lamaste.local)  
✅ `13:00:37` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `13:00:37` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `13:00:40` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `13:00:40` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Reset TOTP before authentication

✅ `13:00:40` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `13:01:02` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `13:01:02` Generated TOTP code with oathtool on visitor VM  
✅ `13:01:02` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `13:01:03` Authenticated request returns site content  
✅ `13:01:03` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `13:01:03` Disable Authelia protection returned ok: true  
✅ `13:01:03` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `13:01:06` Unprotected site returns HTTP 200 without auth  
✅ `13:01:06` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `13:01:07` Re-enable Authelia protection returned ok: true  
✅ `13:01:07` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `13:01:09` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `13:01:10` Site deletion returned ok: true  
✅ `13:01:10` Site no longer appears in site list after deletion  

## Custom-domain site with an alias: create and verify DNS

✅ `13:01:10` Custom site with alias www.e2e-alias-1794315636.test created  
✅ `13:01:12` verify-dns succeeds for the domain and its alias  
✅ `13:01:12` One certificate lineage covers the domain and www.e2e-alias-1794315636.test  

## Visitor follows the alias to the site's domain

✅ `13:01:13` Alias answers 301 to the same path on the site's domain (TLS verified)  
✅ `13:01:13` Following the alias serves the site's content  

## Add an alias to the live site

✅ `13:01:13` Alias blog.e2e-alias-1794315636.test added to the live site  
✅ `13:01:16` New alias answers 301 with a certificate that names it  

## Cleanup: delete the custom-domain site

✅ `13:01:16` Custom-domain site deleted  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `29` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `29` |

ℹ️ `13:01:16` Cleaning up test resources...  
