# Portlama E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-03-28 16:11:36 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `16:11:36` Site creation returned ok: true  
✅ `16:11:36` Site has an ID  
ℹ️ `16:11:37` Created site ID: 9a19d164-12d0-4ce4-b051-0dc3515124e8 (e2eblog.test.portlama.local)  
✅ `16:11:37` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `16:11:37` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `16:11:39` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `16:11:39` Redirect points to Authelia portal (auth.test.portlama.local)  

## Reset TOTP before authentication

✅ `16:11:39` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `16:11:42` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `16:11:42` Generated TOTP code with oathtool on visitor VM  
✅ `16:11:42` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `16:11:43` Authenticated request returns site content  
✅ `16:11:43` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `16:11:45` Disable Authelia protection returned ok: true  
✅ `16:11:45` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `16:11:47` Unprotected site returns HTTP 200 without auth  
✅ `16:11:47` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `16:11:50` Re-enable Authelia protection returned ok: true  
✅ `16:11:50` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `16:11:52` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `16:11:52` Site deletion returned ok: true  
✅ `16:11:52` Site no longer appears in site list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `16:11:52` Cleaning up test resources...  
🔵 `16:11:52` **Running: 08-invitation-journey.sh**  
