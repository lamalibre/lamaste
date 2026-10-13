# Lamaste E2E: 27 — Enrollment Public Endpoints (Three-VM)

> Started at `2026-10-13 11:52:39 UTC`


## Initialize cleanup-referenced variables


## Pre-flight: onboarding complete

✅ `11:52:39` Onboarding is COMPLETED  

## Admin creates enrollment token for enroll-public-27

✅ `11:52:40` POST /certs/agent/enroll returns 200  
✅ `11:52:40` Token response ok=true  
✅ `11:52:40` Enrollment token value is non-empty  

## Generate CSR on agent VM

✅ `11:52:40` CSR contains BEGIN CERTIFICATE REQUEST marker  

## POST /api/enroll/ from agent VM without mTLS

✅ `11:52:40` POST /api/enroll/ returns ok=true  
✅ `11:52:40` Enroll response .label matches requested label  
✅ `11:52:40` Enroll response .serial is non-empty  
✅ `11:52:40` Enroll response .cert is non-empty  

## Negative: POST /api/enroll/ with invalid token returns 401

✅ `11:52:41` POST /api/enroll/ with invalid token returns 401  

## POST /api/enroll/lookup returns pending token label

✅ `11:52:41` Second enrollment token captured for lookup test  
✅ `11:52:41` POST /api/enroll/lookup returns ok=true  
✅ `11:52:41` Lookup .label matches issued token label  

## Negative: POST /api/enroll/lookup with invalid token returns 401

✅ `11:52:41` POST /api/enroll/lookup with invalid token returns 401  

## DELETE /api/certs/agent/enroll/:label revokes the unused lookup token

✅ `11:52:41` DELETE /certs/agent/enroll/:label returns 200  
✅ `11:52:41` Delete response .revoked=true (unused token was removed)  
✅ `11:52:55` Lookup of revoked token returns 401  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `11:52:55` Cleaning up test resources...  
