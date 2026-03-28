# Portlama E2E: 17 — Panel Built-in TOTP 2FA

> Started at `2026-03-28 16:08:54 UTC`


## Pre-flight: check onboarding is complete


## Default state: 2FA disabled

✅ `16:08:54` 2FA is disabled by default  
✅ `16:08:54` setupComplete is false by default  

## Setup: generate TOTP secret

✅ `16:08:54` Setup returns otpauth URI  
✅ `16:08:54` Setup returns manual key  
✅ `16:08:54` URI is valid otpauth format  

## Confirm 2FA with valid code

✅ `16:08:55` Generated TOTP code  
ℹ️ `16:08:55` Generated TOTP code: 295970  
✅ `16:08:55` 2FA is now enabled  
✅ `16:08:55` Session cookie received on confirm  
✅ `16:08:55` Status shows enabled after confirm  

## IP vhost disabled after enabling 2FA

✅ `16:08:57` IP:9292 vhost is disabled (HTTP 000)  

## Request without session returns 401 2fa_required

✅ `16:08:57` Request without session cookie returns 401  

## Authenticated request with session cookie

✅ `16:08:57` Authenticated request with session cookie returns system stats  

## Disable 2FA

ℹ️ `16:08:57` Waiting 4s for next TOTP window...  
✅ `16:09:01` 2FA disabled successfully  

## IP vhost re-enabled after disabling 2FA

✅ `16:09:03` IP:9292 vhost is re-enabled after disabling 2FA  
✅ `16:09:03` 2FA status is disabled  

## Reset admin clears 2FA

✅ `16:09:03` 2FA re-enabled for reset test  
✅ `16:09:08` 2FA disabled after reset-admin  
✅ `16:09:08` IP vhost restored after reset-admin  

## Rate limiting on wrong codes

✅ `16:09:10` Rate limiting kicks in after 6 wrong attempts (HTTP 429)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `19` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `19` |

