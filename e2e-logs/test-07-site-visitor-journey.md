# Portlama E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-03-16 17:23:52 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `17:23:53` Site creation returned ok: true  
✅ `17:23:53` Site has an ID  
ℹ️ `17:23:53` Created site ID: da2d9e76-42b2-45e8-8f91-26093a7fda3f (e2eblog.test.portlama.local)  
✅ `17:23:53` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `17:23:53` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `17:23:55` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `17:23:56` Redirect points to Authelia portal (auth.test.portlama.local)  

## Reset TOTP before authentication

✅ `17:23:56` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `17:23:59` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `17:23:59` Generated TOTP code with oathtool on visitor VM  
✅ `17:23:59` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `17:23:59` Authenticated request returns site content  
✅ `17:23:59` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `17:24:02` Disable Authelia protection returned ok: true  
✅ `17:24:02` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `17:24:04` Unprotected site returns HTTP 200 without auth  
✅ `17:24:04` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `17:24:06` Re-enable Authelia protection returned ok: true  
✅ `17:24:06` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `17:24:09` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `17:24:09` Site deletion returned ok: true  
✅ `17:24:09` Site no longer appears in site list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `17:24:09` Cleaning up test resources...  
🔵 `17:24:09` **Running: 08-invitation-journey.sh**  
