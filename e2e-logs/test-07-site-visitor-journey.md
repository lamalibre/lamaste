# Lamaste E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-03-30 13:10:55 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `13:10:56` Site creation returned ok: true  
✅ `13:10:56` Site has an ID  
ℹ️ `13:10:56` Created site ID: 1e1d2152-36e6-4d28-b384-ae400129e3ab (e2eblog.test.lamaste.local)  
✅ `13:10:56` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `13:10:56` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `13:10:58` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `13:10:59` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Reset TOTP before authentication

✅ `13:10:59` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `13:11:02` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `13:11:02` Generated TOTP code with oathtool on visitor VM  
✅ `13:11:02` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `13:11:02` Authenticated request returns site content  
✅ `13:11:02` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `13:11:05` Disable Authelia protection returned ok: true  
✅ `13:11:05` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `13:11:07` Unprotected site returns HTTP 200 without auth  
✅ `13:11:07` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `13:11:09` Re-enable Authelia protection returned ok: true  
✅ `13:11:09` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `13:11:12` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `13:11:12` Site deletion returned ok: true  
✅ `13:11:12` Site no longer appears in site list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `13:11:12` Cleaning up test resources...  
🔵 `13:11:12` **Running: 08-invitation-journey.sh**  
