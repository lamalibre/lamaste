# Lamaste E2E: 25 — User Access OTP Flow (Three-VM)

> Started at `2026-11-02 15:53:32 UTC`


## Pre-flight: onboarding + domain

✅ `15:53:32` Onboarding is complete  
ℹ️ `15:53:32` Using domain: test.lamaste.local  
ℹ️ `15:53:32` Test user: testuser  

## Admin creates a local grant for testuser

✅ `15:53:32` Grant created with .ok === true  
✅ `15:53:32` Grant has an id  
✅ `15:53:32` Local grant is NOT auto-consumed (used=false)  
ℹ️ `15:53:32` Created grant: d6cf6db7-d5fe-4ed0-9f58-ee801b2359b0  

## Authelia first-factor + TOTP as testuser

✅ `15:53:32` TOTP reset returned otpauth URI  
✅ `15:54:02` Authelia first-factor returns OK  
✅ `15:54:03` Authelia second-factor (TOTP) returns OK  

## GET /api/user-access/authorize → OTP in redirect fragment

✅ `15:54:03` /authorize returns HTTP 302  
✅ `15:54:03` Location redirects to lamalibre://callback  
✅ `15:54:03` Redirect fragment carries token=  
✅ `15:54:03` Redirect fragment carries the nonce we submitted  
✅ `15:54:03` OTP_TOKEN matches [a-f0-9]{64}  

## POST /api/user-access/exchange → Bearer session token

✅ `15:54:03` /exchange returns HTTP 200  
✅ `15:54:03` Exchange response has .ok === true  
✅ `15:54:03` Exchange response carries a sessionToken  
✅ `15:54:03` Exchange response echoes our username  
✅ `15:54:03` Second exchange (same OTP) returns 401 — single-use  

## GET /api/user-access/plugins with Bearer session

✅ `15:54:03` /plugins returns HTTP 200  
✅ `15:54:03` Granted plugin appears in the response  
✅ `15:54:03` /plugins without Bearer is 401  

## POST /api/user-access/enroll with Bearer — consume grant

✅ `15:54:04` /enroll returns HTTP 200  
✅ `15:54:04` /enroll returns an enrollmentToken  
✅ `15:54:04` /enroll returns a label derived from username+plugin  
✅ `15:54:04` /enroll echoes the plugin name  
ℹ️ `15:54:04` Enrollment minted label: testuser-herd  
✅ `15:54:04` Replay /enroll (same grantId) returns non-200 — grant consumed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `25` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `25` |

ℹ️ `15:54:04` Cleaning up test resources...  
