# Portlama E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-03-20 14:36:11 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `14:36:12` Site creation returned ok: true  
✅ `14:36:12` Site has an ID  
ℹ️ `14:36:12` Created site ID: e314e7bd-4752-4610-92bb-4312e543a705 (e2eblog.test.portlama.local)  
✅ `14:36:12` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `14:36:12` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `14:36:14` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `14:36:14` Redirect points to Authelia portal (auth.test.portlama.local)  

## Reset TOTP before authentication

✅ `14:36:15` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `14:36:18` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `14:36:18` Generated TOTP code with oathtool on visitor VM  
✅ `14:36:18` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `14:36:18` Authenticated request returns site content  
✅ `14:36:18` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `14:36:21` Disable Authelia protection returned ok: true  
✅ `14:36:21` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `14:36:23` Unprotected site returns HTTP 200 without auth  
✅ `14:36:23` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `14:36:26` Re-enable Authelia protection returned ok: true  
✅ `14:36:26` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `14:36:28` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `14:36:28` Site deletion returned ok: true  
✅ `14:36:28` Site no longer appears in site list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `14:36:28` Cleaning up test resources...  
🔵 `14:36:28` **Running: 08-invitation-journey.sh**  
