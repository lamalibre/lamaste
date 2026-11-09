# Lamaste E2E: 25 — User Access OTP Flow (Three-VM)

> Started at `2026-11-09 12:45:01 UTC`


## Pre-flight: onboarding + domain

✅ `12:45:01` Onboarding is complete  
ℹ️ `12:45:01` Using domain: test.lamaste.local  
ℹ️ `12:45:01` Test user: testuser  

## Admin creates a local grant for testuser

✅ `12:45:01` Grant created with .ok === true  
✅ `12:45:01` Grant has an id  
✅ `12:45:01` Local grant is NOT auto-consumed (used=false)  
ℹ️ `12:45:01` Created grant: 785f16af-7314-4e83-8f8a-c52aae5c9647  

## Authelia first-factor + TOTP as testuser

✅ `12:45:01` TOTP reset returned otpauth URI  
✅ `12:45:33` Authelia first-factor returns OK  
✅ `12:45:33` Authelia second-factor (TOTP) returns OK  

## GET /api/user-access/authorize → OTP in redirect fragment

✅ `12:45:33` /authorize returns HTTP 302  
✅ `12:45:33` Location redirects to lamalibre://callback  
✅ `12:45:33` Redirect fragment carries token=  
✅ `12:45:33` Redirect fragment carries the nonce we submitted  
✅ `12:45:33` OTP_TOKEN matches [a-f0-9]{64}  

## POST /api/user-access/exchange → Bearer session token

✅ `12:45:33` /exchange returns HTTP 200  
✅ `12:45:33` Exchange response has .ok === true  
✅ `12:45:33` Exchange response carries a sessionToken  
✅ `12:45:33` Exchange response echoes our username  
✅ `12:45:33` Second exchange (same OTP) returns 401 — single-use  

## GET /api/user-access/plugins with Bearer session

✅ `12:45:34` /plugins returns HTTP 200  
✅ `12:45:34` Granted plugin appears in the response  
✅ `12:45:34` /plugins without Bearer is 401  

## POST /api/user-access/enroll with Bearer — consume grant

✅ `12:45:34` /enroll returns HTTP 200  
✅ `12:45:34` /enroll returns an enrollmentToken  
✅ `12:45:34` /enroll returns a label derived from username+plugin  
✅ `12:45:34` /enroll echoes the plugin name  
ℹ️ `12:45:34` Enrollment minted label: testuser-herd  
✅ `12:45:34` Replay /enroll (same grantId) returns non-200 — grant consumed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `25` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `25` |

ℹ️ `12:45:34` Cleaning up test resources...  
