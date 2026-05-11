# Lamaste E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-04-30 08:58:40 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `08:58:40` Site creation returned ok: true  
✅ `08:58:40` Site has an ID  
ℹ️ `08:58:40` Created site ID: f8f8153c-8953-4287-8a90-cca23a5b029d (e2eblog.test.lamaste.local)  
✅ `08:58:40` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `08:58:41` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `08:58:43` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `08:58:43` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Reset TOTP before authentication

✅ `08:58:43` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `08:59:02` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `08:59:03` Generated TOTP code with oathtool on visitor VM  
✅ `08:59:03` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `08:59:03` Authenticated request returns site content  
✅ `08:59:03` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `08:59:05` Disable Authelia protection returned ok: true  
✅ `08:59:05` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `08:59:08` Unprotected site returns HTTP 200 without auth  
✅ `08:59:08` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `08:59:10` Re-enable Authelia protection returned ok: true  
✅ `08:59:10` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `08:59:13` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `08:59:13` Site deletion returned ok: true  
✅ `08:59:13` Site no longer appears in site list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `08:59:13` Cleaning up test resources...  
