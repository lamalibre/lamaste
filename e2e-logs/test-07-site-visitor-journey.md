# Portlama E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-03-26 10:50:06 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `10:50:07` Site creation returned ok: true  
✅ `10:50:07` Site has an ID  
ℹ️ `10:50:07` Created site ID: d7c96644-3de0-4b7b-9ab8-ab299e8196d9 (e2eblog.test.portlama.local)  
✅ `10:50:07` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `10:50:07` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `10:50:09` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `10:50:09` Redirect points to Authelia portal (auth.test.portlama.local)  

## Reset TOTP before authentication

✅ `10:50:10` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `10:50:13` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `10:50:13` Generated TOTP code with oathtool on visitor VM  
✅ `10:50:13` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `10:50:13` Authenticated request returns site content  
✅ `10:50:13` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `10:50:16` Disable Authelia protection returned ok: true  
✅ `10:50:16` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `10:50:18` Unprotected site returns HTTP 200 without auth  
✅ `10:50:18` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `10:50:20` Re-enable Authelia protection returned ok: true  
✅ `10:50:20` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `10:50:22` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `10:50:23` Site deletion returned ok: true  
✅ `10:50:23` Site no longer appears in site list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `10:50:23` Cleaning up test resources...  
🔵 `10:50:23` **Running: 08-invitation-journey.sh**  
