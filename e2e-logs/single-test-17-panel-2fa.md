# Portlama E2E: 17 — Panel Built-in TOTP 2FA

> Started at `2026-03-28 22:39:17 UTC`


## Pre-flight: check onboarding is complete


## Default state: 2FA disabled

✅ `22:39:17` 2FA is disabled by default  
✅ `22:39:17` setupComplete is false by default  

## Setup: generate TOTP secret

✅ `22:39:17` Setup returns otpauth URI  
✅ `22:39:17` Setup returns manual key  
✅ `22:39:17` URI is valid otpauth format  

## Confirm 2FA with valid code

✅ `22:39:18` Generated TOTP code  
ℹ️ `22:39:18` Generated TOTP code: 844303  
✅ `22:39:18` 2FA is now enabled  
✅ `22:39:18` Session cookie received on confirm  
✅ `22:39:18` Status shows enabled after confirm  

## IP vhost disabled after enabling 2FA

✅ `22:39:20` IP:9292 vhost is disabled (HTTP 000)  

## Request without session returns 401 2fa_required

✅ `22:39:20` Request without session cookie returns 401  

## Authenticated request with session cookie

✅ `22:39:20` Authenticated request with session cookie returns system stats  

## Disable 2FA

ℹ️ `22:39:20` Waiting 11s for next TOTP window...  
✅ `22:39:31` 2FA disabled successfully  

## IP vhost re-enabled after disabling 2FA

✅ `22:39:33` IP:9292 vhost is re-enabled after disabling 2FA  
✅ `22:39:33` 2FA status is disabled  

## Reset admin clears 2FA

✅ `22:39:33` 2FA re-enabled for reset test  
✅ `22:39:37` 2FA disabled after reset-admin  
✅ `22:39:37` IP vhost restored after reset-admin  

## Rate limiting on wrong codes

✅ `22:39:40` Rate limiting kicks in after 6 wrong attempts (HTTP 429)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `19` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `19` |

