# Lamaste E2E: 25 — User Access OTP Flow (Three-VM)

> Started at `2026-11-04 13:38:08 UTC`


## Pre-flight: onboarding + domain

✅ `13:38:09` Onboarding is complete  
ℹ️ `13:38:09` Using domain: test.lamaste.local  
ℹ️ `13:38:09` Test user: testuser  

## Admin creates a local grant for testuser

✅ `13:38:09` Grant created with .ok === true  
✅ `13:38:09` Grant has an id  
✅ `13:38:09` Local grant is NOT auto-consumed (used=false)  
ℹ️ `13:38:09` Created grant: c7d60e80-9c02-4e8e-8a84-04ce9e982d53  

## Authelia first-factor + TOTP as testuser

✅ `13:38:09` TOTP reset returned otpauth URI  
✅ `13:38:33` Authelia first-factor returns OK  
✅ `13:38:33` Authelia second-factor (TOTP) returns OK  

## GET /api/user-access/authorize → OTP in redirect fragment

✅ `13:38:34` /authorize returns HTTP 302  
✅ `13:38:34` Location redirects to lamalibre://callback  
✅ `13:38:34` Redirect fragment carries token=  
✅ `13:38:34` Redirect fragment carries the nonce we submitted  
✅ `13:38:34` OTP_TOKEN matches [a-f0-9]{64}  

## POST /api/user-access/exchange → Bearer session token

✅ `13:38:34` /exchange returns HTTP 200  
✅ `13:38:34` Exchange response has .ok === true  
✅ `13:38:34` Exchange response carries a sessionToken  
✅ `13:38:34` Exchange response echoes our username  
✅ `13:38:34` Second exchange (same OTP) returns 401 — single-use  

## GET /api/user-access/plugins with Bearer session

✅ `13:38:35` /plugins returns HTTP 200  
✅ `13:38:35` Granted plugin appears in the response  
✅ `13:38:35` /plugins without Bearer is 401  

## POST /api/user-access/enroll with Bearer — consume grant

✅ `13:38:35` /enroll returns HTTP 200  
✅ `13:38:35` /enroll returns an enrollmentToken  
✅ `13:38:35` /enroll returns a label derived from username+plugin  
✅ `13:38:36` /enroll echoes the plugin name  
ℹ️ `13:38:36` Enrollment minted label: testuser-herd  
✅ `13:38:36` Replay /enroll (same grantId) returns non-200 — grant consumed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `25` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `25` |

ℹ️ `13:38:36` Cleaning up test resources...  
