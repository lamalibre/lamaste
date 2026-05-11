# Lamaste E2E: 17 — Panel Built-in TOTP 2FA

> Started at `2026-03-30 13:07:11 UTC`


## Pre-flight: check onboarding is complete


## Default state: 2FA disabled

✅ `13:07:11` 2FA is disabled by default  
✅ `13:07:11` setupComplete is false by default  

## Setup: generate TOTP secret

✅ `13:07:11` Setup returns otpauth URI  
✅ `13:07:11` Setup returns manual key  
✅ `13:07:11` URI is valid otpauth format  

## Confirm 2FA with valid code

✅ `13:07:11` Generated TOTP code  
ℹ️ `13:07:11` Generated TOTP code: 160308  
✅ `13:07:11` 2FA is now enabled  
✅ `13:07:11` Session cookie received on confirm  
✅ `13:07:11` Status shows enabled after confirm  

## IP vhost disabled after enabling 2FA

✅ `13:07:13` IP:9292 vhost is disabled (HTTP 000)  

## Request without session returns 401 2fa_required

✅ `13:07:13` Request without session cookie returns 401  

## Authenticated request with session cookie

✅ `13:07:13` Authenticated request with session cookie returns system stats  

## Disable 2FA

ℹ️ `13:07:13` Waiting 18s for next TOTP window...  
✅ `13:07:31` 2FA disabled successfully  

## IP vhost re-enabled after disabling 2FA

✅ `13:07:33` IP:9292 vhost is re-enabled after disabling 2FA  
✅ `13:07:33` 2FA status is disabled  

## Reset admin clears 2FA

✅ `13:07:33` 2FA re-enabled for reset test  
✅ `13:07:38` 2FA disabled after reset-admin  
✅ `13:07:38` IP vhost restored after reset-admin  

## Rate limiting on wrong codes

✅ `13:07:40` Rate limiting kicks in after 6 wrong attempts (HTTP 429)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `19` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `19` |

