# Portlama E2E: 07 — Static Site Visitor Journey (Three-VM)

> Started at `2026-03-24 09:39:59 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Create managed static site via API

✅ `09:40:00` Site creation returned ok: true  
✅ `09:40:00` Site has an ID  
ℹ️ `09:40:00` Created site ID: 070f2f84-3507-4e98-bb87-d1328b10d414 (e2eblog.test.portlama.local)  
✅ `09:40:00` Site FQDN matches expected value  

## Write test index.html to site directory

✅ `09:40:00` index.html written to site directory  

## Visit site from visitor VM WITHOUT auth — should redirect to Authelia

✅ `09:40:02` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `09:40:02` Redirect points to Authelia portal (auth.test.portlama.local)  

## Reset TOTP before authentication

✅ `09:40:02` TOTP reset succeeded, got otpauth URI  

## Authenticate with Authelia from visitor VM (firstfactor)

✅ `09:40:05` Authelia firstfactor authentication succeeded  

## Authenticate with Authelia from visitor VM (secondfactor TOTP)

✅ `09:40:06` Generated TOTP code with oathtool on visitor VM  
✅ `09:40:06` Authelia secondfactor TOTP authentication succeeded  

## Visit site from visitor VM WITH auth — should return content

✅ `09:40:06` Authenticated request returns site content  
✅ `09:40:06` Authenticated request returns HTTP 200  

## Disable Authelia protection

✅ `09:40:08` Disable Authelia protection returned ok: true  
✅ `09:40:08` Site shows autheliaProtected: false  

## Visit site from visitor VM WITHOUT auth — should now return content (unprotected)

✅ `09:40:10` Unprotected site returns HTTP 200 without auth  
✅ `09:40:11` Unprotected site returns expected content  

## Re-enable Authelia protection

✅ `09:40:13` Re-enable Authelia protection returned ok: true  
✅ `09:40:13` Site shows autheliaProtected: true  

## Verify protection is back — visitor without auth should redirect

✅ `09:40:15` Re-protected site redirects/rejects unauthenticated request (HTTP 302)  

## Cleanup: delete site via API

✅ `09:40:16` Site deletion returned ok: true  
✅ `09:40:16` Site no longer appears in site list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `09:40:16` Cleaning up test resources...  
🔵 `09:40:16` **Running: 08-invitation-journey.sh**  
