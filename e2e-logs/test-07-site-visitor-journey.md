# Portlama E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-03-29 09:11:49 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `09:11:49` Site creation returned ok: true  
✅ `09:11:49` Site has an ID  
ℹ️ `09:11:49` Created site ID: ab3299e6-ded3-42de-b997-2bf250a2e2c5 (e2eblog.test.portlama.local)  
✅ `09:11:50` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `09:11:50` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `09:11:52` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `09:11:52` Redirect points to Authelia portal (auth.test.portlama.local)  

## Reset TOTP before authentication

✅ `09:11:52` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `09:11:55` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `09:11:55` Generated TOTP code with oathtool on visitor VM  
✅ `09:11:55` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `09:11:56` Authenticated request returns site content  
✅ `09:11:56` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `09:11:58` Disable Authelia protection returned ok: true  
✅ `09:11:58` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `09:12:00` Unprotected site returns HTTP 200 without auth  
✅ `09:12:00` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `09:12:03` Re-enable Authelia protection returned ok: true  
✅ `09:12:03` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `09:12:05` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `09:12:05` Site deletion returned ok: true  
✅ `09:12:05` Site no longer appears in site list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `09:12:05` Cleaning up test resources...  
🔵 `09:12:05` **Running: 08-invitation-journey.sh**  
