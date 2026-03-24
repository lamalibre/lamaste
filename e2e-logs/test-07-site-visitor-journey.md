# Portlama E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-03-24 08:13:09 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `08:13:10` Site creation returned ok: true  
✅ `08:13:10` Site has an ID  
ℹ️ `08:13:10` Created site ID: 56e26679-2e18-42d8-a949-b0d202d367ed (e2eblog.test.portlama.local)  
✅ `08:13:10` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `08:13:10` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `08:13:13` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `08:13:13` Redirect points to Authelia portal (auth.test.portlama.local)  

## Reset TOTP before authentication

✅ `08:13:13` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `08:13:16` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `08:13:16` Generated TOTP code with oathtool on visitor VM  
✅ `08:13:16` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `08:13:16` Authenticated request returns site content  
✅ `08:13:16` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `08:13:19` Disable Authelia protection returned ok: true  
✅ `08:13:19` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `08:13:21` Unprotected site returns HTTP 200 without auth  
✅ `08:13:21` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `08:13:24` Re-enable Authelia protection returned ok: true  
✅ `08:13:24` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `08:13:26` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `08:13:26` Site deletion returned ok: true  
✅ `08:13:26` Site no longer appears in site list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `08:13:26` Cleaning up test resources...  
🔵 `08:13:26` **Running: 08-invitation-journey.sh**  
