# Lamaste E2E: 25 — User Access OTP Flow (Three-VM)

> Started at `2026-04-30 09:10:08 UTC`


## Pre-flight: onboarding + domain

✅ `09:10:08` Onboarding is complete  
ℹ️ `09:10:08` Using domain: test.lamaste.local  
ℹ️ `09:10:08` Test user: testuser  

## Admin creates a local grant for testuser

✅ `09:10:08` Grant created with .ok === true  
✅ `09:10:08` Grant has an id  
✅ `09:10:08` Local grant is NOT auto-consumed (used=false)  
ℹ️ `09:10:08` Created grant: 347aa021-6a8f-4599-83c8-bd65a39812d2  

## Authelia first-factor + TOTP as testuser

✅ `09:10:08` TOTP reset returned otpauth URI  
✅ `09:10:33` Authelia first-factor returns OK  
✅ `09:10:33` Authelia second-factor (TOTP) returns OK  

## GET /api/user-access/authorize → OTP in redirect fragment

✅ `09:10:33` /authorize returns HTTP 302  
✅ `09:10:33` Location redirects to lamalibre://callback  
✅ `09:10:33` Redirect fragment carries token=  
✅ `09:10:33` Redirect fragment carries the nonce we submitted  
✅ `09:10:33` OTP_TOKEN matches [a-f0-9]{64}  

## POST /api/user-access/exchange → Bearer session token

✅ `09:10:33` /exchange returns HTTP 200  
✅ `09:10:33` Exchange response has .ok === true  
✅ `09:10:33` Exchange response carries a sessionToken  
✅ `09:10:33` Exchange response echoes our username  
✅ `09:10:33` Second exchange (same OTP) returns 401 — single-use  

## GET /api/user-access/plugins with Bearer session

✅ `09:10:33` /plugins returns HTTP 200  
✅ `09:10:33` Granted plugin appears in the response  
✅ `09:10:34` /plugins without Bearer is 401  

## POST /api/user-access/enroll with Bearer — consume grant

✅ `09:10:34` /enroll returns HTTP 200  
✅ `09:10:34` /enroll returns an enrollmentToken  
✅ `09:10:34` /enroll returns a label derived from username+plugin  
✅ `09:10:34` /enroll echoes the plugin name  
ℹ️ `09:10:34` Enrollment minted label: testuser-herd  
✅ `09:10:34` Replay /enroll (same grantId) returns non-200 — grant consumed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `25` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `25` |

ℹ️ `09:10:34` Cleaning up test resources...  
