# Portlama E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-03-22 18:27:27 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `18:27:28` Site creation returned ok: true  
✅ `18:27:28` Site has an ID  
ℹ️ `18:27:28` Created site ID: aa27d02c-739d-456b-853d-a30a1463d125 (e2eblog.test.portlama.local)  
✅ `18:27:28` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `18:27:28` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `18:27:32` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `18:27:32` Redirect points to Authelia portal (auth.test.portlama.local)  

## Reset TOTP before authentication

✅ `18:27:32` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `18:27:35` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `18:27:35` Generated TOTP code with oathtool on visitor VM  
✅ `18:27:35` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `18:27:35` Authenticated request returns site content  
✅ `18:27:36` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `18:27:38` Disable Authelia protection returned ok: true  
✅ `18:27:38` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `18:27:41` Unprotected site returns HTTP 200 without auth  
✅ `18:27:42` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `18:27:45` Re-enable Authelia protection returned ok: true  
✅ `18:27:45` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `18:27:48` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `18:27:48` Site deletion returned ok: true  
✅ `18:27:49` Site no longer appears in site list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `18:27:49` Cleaning up test resources...  
🔵 `18:27:49` **Running: 08-invitation-journey.sh**  
