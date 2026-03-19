# Portlama E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-03-19 12:19:39 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `12:19:40` Site creation returned ok: true  
✅ `12:19:40` Site has an ID  
ℹ️ `12:19:40` Created site ID: bf09f3bd-38e9-4429-934c-8c195ddb5425 (e2eblog.test.portlama.local)  
✅ `12:19:40` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `12:19:40` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `12:19:42` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `12:19:42` Redirect points to Authelia portal (auth.test.portlama.local)  

## Reset TOTP before authentication

✅ `12:19:42` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `12:19:45` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `12:19:46` Generated TOTP code with oathtool on visitor VM  
✅ `12:19:46` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `12:19:46` Authenticated request returns site content  
✅ `12:19:46` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `12:19:48` Disable Authelia protection returned ok: true  
✅ `12:19:48` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `12:19:50` Unprotected site returns HTTP 200 without auth  
✅ `12:19:50` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `12:19:53` Re-enable Authelia protection returned ok: true  
✅ `12:19:53` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `12:19:55` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `12:19:55` Site deletion returned ok: true  
✅ `12:19:56` Site no longer appears in site list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `12:19:56` Cleaning up test resources...  
🔵 `12:19:56` **Running: 08-invitation-journey.sh**  
