# Portlama E2E: 17 — Panel Built-in TOTP 2FA

> Started at `2026-03-29 09:08:41 UTC`


## Pre-flight: check onboarding is complete


## Default state: 2FA disabled

✅ `09:08:41` 2FA is disabled by default  
✅ `09:08:41` setupComplete is false by default  

## Setup: generate TOTP secret

✅ `09:08:41` Setup returns otpauth URI  
✅ `09:08:41` Setup returns manual key  
✅ `09:08:41` URI is valid otpauth format  

## Confirm 2FA with valid code

✅ `09:08:41` Generated TOTP code  
ℹ️ `09:08:41` Generated TOTP code: 142792  
✅ `09:08:42` 2FA is now enabled  
✅ `09:08:42` Session cookie received on confirm  
✅ `09:08:42` Status shows enabled after confirm  

## IP vhost disabled after enabling 2FA

✅ `09:08:44` IP:9292 vhost is disabled (HTTP 000)  

## Request without session returns 401 2fa_required

✅ `09:08:44` Request without session cookie returns 401  

## Authenticated request with session cookie

✅ `09:08:44` Authenticated request with session cookie returns system stats  

## Disable 2FA

ℹ️ `09:08:44` Waiting 17s for next TOTP window...  
✅ `09:09:01` 2FA disabled successfully  

## IP vhost re-enabled after disabling 2FA

✅ `09:09:03` IP:9292 vhost is re-enabled after disabling 2FA  
✅ `09:09:03` 2FA status is disabled  

## Reset admin clears 2FA

✅ `09:09:03` 2FA re-enabled for reset test  
✅ `09:09:08` 2FA disabled after reset-admin  
✅ `09:09:08` IP vhost restored after reset-admin  

## Rate limiting on wrong codes

✅ `09:09:10` Rate limiting kicks in after 6 wrong attempts (HTTP 429)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `19` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `19` |

