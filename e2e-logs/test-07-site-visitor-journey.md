# Portlama E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-03-28 22:42:13 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `22:42:14` Site creation returned ok: true  
✅ `22:42:14` Site has an ID  
ℹ️ `22:42:14` Created site ID: 07907416-9d4d-4ff4-8aaa-c4521faadf6d (e2eblog.test.portlama.local)  
✅ `22:42:14` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `22:42:14` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `22:42:16` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `22:42:16` Redirect points to Authelia portal (auth.test.portlama.local)  

## Reset TOTP before authentication

✅ `22:42:16` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `22:42:19` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `22:42:19` Generated TOTP code with oathtool on visitor VM  
✅ `22:42:20` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `22:42:20` Authenticated request returns site content  
✅ `22:42:20` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `22:42:22` Disable Authelia protection returned ok: true  
✅ `22:42:22` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `22:42:24` Unprotected site returns HTTP 200 without auth  
✅ `22:42:24` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `22:42:27` Re-enable Authelia protection returned ok: true  
✅ `22:42:27` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `22:42:29` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `22:42:29` Site deletion returned ok: true  
✅ `22:42:29` Site no longer appears in site list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `22:42:29` Cleaning up test resources...  
🔵 `22:42:30` **Running: 08-invitation-journey.sh**  
