# Portlama E2E: 17 — Panel Built-in TOTP 2FA

> Started at `2026-03-26 10:47:01 UTC`


## Pre-flight: check onboarding is complete


## Default state: 2FA disabled

✅ `10:47:01` 2FA is disabled by default  
✅ `10:47:01` setupComplete is false by default  

## Setup: generate TOTP secret

✅ `10:47:01` Setup returns otpauth URI  
✅ `10:47:01` Setup returns manual key  
✅ `10:47:01` URI is valid otpauth format  

## Confirm 2FA with valid code

✅ `10:47:01` Generated TOTP code  
ℹ️ `10:47:01` Generated TOTP code: 234254  
✅ `10:47:01` 2FA is now enabled  
✅ `10:47:01` Session cookie received on confirm  
✅ `10:47:01` Status shows enabled after confirm  

## IP vhost disabled after enabling 2FA

✅ `10:47:03` IP:9292 vhost is disabled (HTTP 000)  

## Request without session returns 401 2fa_required

✅ `10:47:03` Request without session cookie returns 401  

## Authenticated request with session cookie

✅ `10:47:03` Authenticated request with session cookie returns system stats  

## Disable 2FA

ℹ️ `10:47:03` Waiting 28s for next TOTP window...  
✅ `10:47:31` 2FA disabled successfully  

## IP vhost re-enabled after disabling 2FA

✅ `10:47:33` IP:9292 vhost is re-enabled after disabling 2FA  
✅ `10:47:33` 2FA status is disabled  

## Reset admin clears 2FA

✅ `10:47:34` 2FA re-enabled for reset test  
✅ `10:47:38` 2FA disabled after reset-admin  
✅ `10:47:38` IP vhost restored after reset-admin  

## Rate limiting on wrong codes

✅ `10:47:40` Rate limiting kicks in after 6 wrong attempts (HTTP 429)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `19` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `19` |

