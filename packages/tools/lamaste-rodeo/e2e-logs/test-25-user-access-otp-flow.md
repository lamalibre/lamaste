# Lamaste E2E: 25 — User Access OTP Flow (Three-VM)

> Started at `2026-10-13 11:52:28 UTC`


## Pre-flight: onboarding + domain

✅ `11:52:28` Onboarding is complete  
ℹ️ `11:52:28` Using domain: test.lamaste.local  
ℹ️ `11:52:28` Test user: testuser  

## Admin creates a local grant for testuser

✅ `11:52:28` Grant created with .ok === true  
✅ `11:52:28` Grant has an id  
✅ `11:52:28` Local grant is NOT auto-consumed (used=false)  
ℹ️ `11:52:28` Created grant: 31f9e167-c28c-4db1-b909-24c8146f45ff  

## Authelia first-factor + TOTP as testuser

✅ `11:52:28` TOTP reset returned otpauth URI  
✅ `11:52:33` Authelia first-factor returns OK  
✅ `11:52:33` Authelia second-factor (TOTP) returns OK  

## GET /api/user-access/authorize → OTP in redirect fragment

✅ `11:52:33` /authorize returns HTTP 302  
✅ `11:52:33` Location redirects to lamalibre://callback  
✅ `11:52:33` Redirect fragment carries token=  
✅ `11:52:33` Redirect fragment carries the nonce we submitted  
✅ `11:52:33` OTP_TOKEN matches [a-f0-9]{64}  

## POST /api/user-access/exchange → Bearer session token

✅ `11:52:33` /exchange returns HTTP 200  
✅ `11:52:33` Exchange response has .ok === true  
✅ `11:52:33` Exchange response carries a sessionToken  
✅ `11:52:33` Exchange response echoes our username  
✅ `11:52:33` Second exchange (same OTP) returns 401 — single-use  

## GET /api/user-access/plugins with Bearer session

✅ `11:52:33` /plugins returns HTTP 200  
✅ `11:52:33` Granted plugin appears in the response  
✅ `11:52:34` /plugins without Bearer is 401  

## POST /api/user-access/enroll with Bearer — consume grant

✅ `11:52:34` /enroll returns HTTP 200  
✅ `11:52:34` /enroll returns an enrollmentToken  
✅ `11:52:34` /enroll returns a label derived from username+plugin  
✅ `11:52:34` /enroll echoes the plugin name  
ℹ️ `11:52:34` Enrollment minted label: testuser-herd  
✅ `11:52:34` Replay /enroll (same grantId) returns non-200 — grant consumed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `25` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `25` |

ℹ️ `11:52:34` Cleaning up test resources...  
