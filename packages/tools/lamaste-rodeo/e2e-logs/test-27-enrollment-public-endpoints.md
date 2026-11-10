# Lamaste E2E: 27 — Enrollment Public Endpoints (Three-VM)

> Started at `2026-11-10 13:08:13 UTC`


## Initialize cleanup-referenced variables


## Pre-flight: onboarding complete

✅ `13:08:13` Onboarding is COMPLETED  

## Admin creates enrollment token for enroll-public-27

✅ `13:08:13` POST /certs/agent/enroll returns 200  
✅ `13:08:13` Token response ok=true  
✅ `13:08:13` Enrollment token value is non-empty  

## Generate CSR on agent VM

✅ `13:08:14` CSR contains BEGIN CERTIFICATE REQUEST marker  

## POST /api/enroll/ from agent VM without mTLS

✅ `13:08:14` POST /api/enroll/ returns ok=true  
✅ `13:08:14` Enroll response .label matches requested label  
✅ `13:08:14` Enroll response .serial is non-empty  
✅ `13:08:14` Enroll response .cert is non-empty  

## Negative: POST /api/enroll/ with invalid token returns 401

✅ `13:08:14` POST /api/enroll/ with invalid token returns 401  

## POST /api/enroll/lookup returns pending token label

✅ `13:08:15` Second enrollment token captured for lookup test  
✅ `13:08:15` POST /api/enroll/lookup returns ok=true  
✅ `13:08:15` Lookup .label matches issued token label  

## Negative: POST /api/enroll/lookup with invalid token returns 401

✅ `13:08:15` POST /api/enroll/lookup with invalid token returns 401  

## DELETE /api/certs/agent/enroll/:label revokes the unused lookup token

✅ `13:08:16` DELETE /certs/agent/enroll/:label returns 200  
✅ `13:08:16` Delete response .revoked=true (unused token was removed)  
✅ `13:08:29` Lookup of revoked token returns 401  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `13:08:29` Cleaning up test resources...  
