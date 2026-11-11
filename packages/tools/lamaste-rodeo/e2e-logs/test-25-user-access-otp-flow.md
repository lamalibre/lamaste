# Lamaste E2E: 25 — User Access OTP Flow (Three-VM)

> Started at `2026-11-10 17:50:08 UTC`


## Pre-flight: onboarding + domain

✅ `17:50:09` Onboarding is complete  
ℹ️ `17:50:09` Using domain: test.lamaste.local  
ℹ️ `17:50:09` Test user: testuser  

## Admin creates a local grant for testuser

✅ `17:50:09` Grant created with .ok === true  
✅ `17:50:09` Grant has an id  
✅ `17:50:09` Local grant is NOT auto-consumed (used=false)  
ℹ️ `17:50:09` Created grant: ce2be709-811b-4557-894a-df0e183f771d  

## Authelia first-factor + TOTP as testuser

✅ `17:50:09` TOTP reset returned otpauth URI  
✅ `17:50:32` Authelia first-factor returns OK  
✅ `17:50:33` Authelia second-factor (TOTP) returns OK  

## GET /api/user-access/authorize → OTP in redirect fragment

✅ `17:50:33` /authorize returns HTTP 302  
✅ `17:50:33` Location redirects to lamalibre://callback  
✅ `17:50:33` Redirect fragment carries token=  
✅ `17:50:33` Redirect fragment carries the nonce we submitted  
✅ `17:50:33` OTP_TOKEN matches [a-f0-9]{64}  

## POST /api/user-access/exchange → Bearer session token

✅ `17:50:33` /exchange returns HTTP 200  
✅ `17:50:33` Exchange response has .ok === true  
✅ `17:50:33` Exchange response carries a sessionToken  
✅ `17:50:33` Exchange response echoes our username  
✅ `17:50:33` Second exchange (same OTP) returns 401 — single-use  

## GET /api/user-access/plugins with Bearer session

✅ `17:50:34` /plugins returns HTTP 200  
✅ `17:50:34` Granted plugin appears in the response  
✅ `17:50:34` /plugins without Bearer is 401  

## POST /api/user-access/enroll with Bearer — consume grant

✅ `17:50:34` /enroll returns HTTP 200  
✅ `17:50:34` /enroll returns an enrollmentToken  
✅ `17:50:34` /enroll returns a label derived from username+plugin  
✅ `17:50:34` /enroll echoes the plugin name  
ℹ️ `17:50:34` Enrollment minted label: testuser-herd  
✅ `17:50:34` Replay /enroll (same grantId) returns non-200 — grant consumed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `25` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `25` |

ℹ️ `17:50:34` Cleaning up test resources...  
