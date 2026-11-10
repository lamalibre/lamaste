# Lamaste E2E: 25 — User Access OTP Flow (Three-VM)

> Started at `2026-11-10 13:07:34 UTC`


## Pre-flight: onboarding + domain

✅ `13:07:34` Onboarding is complete  
ℹ️ `13:07:34` Using domain: test.lamaste.local  
ℹ️ `13:07:34` Test user: testuser  

## Admin creates a local grant for testuser

✅ `13:07:34` Grant created with .ok === true  
✅ `13:07:34` Grant has an id  
✅ `13:07:34` Local grant is NOT auto-consumed (used=false)  
ℹ️ `13:07:34` Created grant: 7057077a-cfe8-4fef-b7cb-d702700026c2  

## Authelia first-factor + TOTP as testuser

✅ `13:07:35` TOTP reset returned otpauth URI  
✅ `13:08:02` Authelia first-factor returns OK  
✅ `13:08:02` Authelia second-factor (TOTP) returns OK  

## GET /api/user-access/authorize → OTP in redirect fragment

✅ `13:08:03` /authorize returns HTTP 302  
✅ `13:08:03` Location redirects to lamalibre://callback  
✅ `13:08:03` Redirect fragment carries token=  
✅ `13:08:03` Redirect fragment carries the nonce we submitted  
✅ `13:08:03` OTP_TOKEN matches [a-f0-9]{64}  

## POST /api/user-access/exchange → Bearer session token

✅ `13:08:03` /exchange returns HTTP 200  
✅ `13:08:03` Exchange response has .ok === true  
✅ `13:08:03` Exchange response carries a sessionToken  
✅ `13:08:03` Exchange response echoes our username  
✅ `13:08:03` Second exchange (same OTP) returns 401 — single-use  

## GET /api/user-access/plugins with Bearer session

✅ `13:08:04` /plugins returns HTTP 200  
✅ `13:08:04` Granted plugin appears in the response  
✅ `13:08:04` /plugins without Bearer is 401  

## POST /api/user-access/enroll with Bearer — consume grant

✅ `13:08:04` /enroll returns HTTP 200  
✅ `13:08:04` /enroll returns an enrollmentToken  
✅ `13:08:04` /enroll returns a label derived from username+plugin  
✅ `13:08:04` /enroll echoes the plugin name  
ℹ️ `13:08:04` Enrollment minted label: testuser-herd  
✅ `13:08:04` Replay /enroll (same grantId) returns non-200 — grant consumed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `25` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `25` |

ℹ️ `13:08:04` Cleaning up test resources...  
