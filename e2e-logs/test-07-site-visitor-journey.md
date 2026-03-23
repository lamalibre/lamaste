# Portlama E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-03-23 12:11:49 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `12:11:50` Site creation returned ok: true  
✅ `12:11:50` Site has an ID  
ℹ️ `12:11:50` Created site ID: 2bb5784d-daf2-404c-8b3b-81945096555c (e2eblog.test.portlama.local)  
✅ `12:11:50` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `12:11:50` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `12:11:52` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `12:11:52` Redirect points to Authelia portal (auth.test.portlama.local)  

## Reset TOTP before authentication

✅ `12:11:53` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `12:11:56` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `12:11:56` Generated TOTP code with oathtool on visitor VM  
✅ `12:11:56` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `12:11:56` Authenticated request returns site content  
✅ `12:11:56` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `12:11:59` Disable Authelia protection returned ok: true  
✅ `12:11:59` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `12:12:01` Unprotected site returns HTTP 200 without auth  
✅ `12:12:01` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `12:12:04` Re-enable Authelia protection returned ok: true  
✅ `12:12:04` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `12:12:06` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `12:12:06` Site deletion returned ok: true  
✅ `12:12:06` Site no longer appears in site list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `12:12:06` Cleaning up test resources...  
🔵 `12:12:07` **Running: 08-invitation-journey.sh**  
