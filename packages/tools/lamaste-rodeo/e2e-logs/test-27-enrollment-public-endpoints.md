# Lamaste E2E: 27 — Enrollment Public Endpoints (Three-VM)

> Started at `2026-11-09 12:45:40 UTC`


## Initialize cleanup-referenced variables


## Pre-flight: onboarding complete

✅ `12:45:41` Onboarding is COMPLETED  

## Admin creates enrollment token for enroll-public-27

✅ `12:45:41` POST /certs/agent/enroll returns 200  
✅ `12:45:41` Token response ok=true  
✅ `12:45:41` Enrollment token value is non-empty  

## Generate CSR on agent VM

✅ `12:45:41` CSR contains BEGIN CERTIFICATE REQUEST marker  

## POST /api/enroll/ from agent VM without mTLS

✅ `12:45:42` POST /api/enroll/ returns ok=true  
✅ `12:45:42` Enroll response .label matches requested label  
✅ `12:45:42` Enroll response .serial is non-empty  
✅ `12:45:42` Enroll response .cert is non-empty  

## Negative: POST /api/enroll/ with invalid token returns 401

✅ `12:45:42` POST /api/enroll/ with invalid token returns 401  

## POST /api/enroll/lookup returns pending token label

✅ `12:45:42` Second enrollment token captured for lookup test  
✅ `12:45:42` POST /api/enroll/lookup returns ok=true  
✅ `12:45:42` Lookup .label matches issued token label  

## Negative: POST /api/enroll/lookup with invalid token returns 401

✅ `12:45:43` POST /api/enroll/lookup with invalid token returns 401  

## DELETE /api/certs/agent/enroll/:label revokes the unused lookup token

✅ `12:45:43` DELETE /certs/agent/enroll/:label returns 200  
✅ `12:45:43` Delete response .revoked=true (unused token was removed)  
✅ `12:45:56` Lookup of revoked token returns 401  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `12:45:56` Cleaning up test resources...  
