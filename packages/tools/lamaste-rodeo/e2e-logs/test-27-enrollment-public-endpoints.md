# Lamaste E2E: 27 — Enrollment Public Endpoints (Three-VM)

> Started at `2026-11-04 13:38:46 UTC`


## Initialize cleanup-referenced variables


## Pre-flight: onboarding complete

✅ `13:38:46` Onboarding is COMPLETED  

## Admin creates enrollment token for enroll-public-27

✅ `13:38:47` POST /certs/agent/enroll returns 200  
✅ `13:38:47` Token response ok=true  
✅ `13:38:47` Enrollment token value is non-empty  

## Generate CSR on agent VM

✅ `13:38:47` CSR contains BEGIN CERTIFICATE REQUEST marker  

## POST /api/enroll/ from agent VM without mTLS

✅ `13:38:48` POST /api/enroll/ returns ok=true  
✅ `13:38:48` Enroll response .label matches requested label  
✅ `13:38:48` Enroll response .serial is non-empty  
✅ `13:38:48` Enroll response .cert is non-empty  

## Negative: POST /api/enroll/ with invalid token returns 401

✅ `13:38:48` POST /api/enroll/ with invalid token returns 401  

## POST /api/enroll/lookup returns pending token label

✅ `13:38:49` Second enrollment token captured for lookup test  
✅ `13:38:49` POST /api/enroll/lookup returns ok=true  
✅ `13:38:49` Lookup .label matches issued token label  

## Negative: POST /api/enroll/lookup with invalid token returns 401

✅ `13:38:50` POST /api/enroll/lookup with invalid token returns 401  

## DELETE /api/certs/agent/enroll/:label revokes the unused lookup token

✅ `13:38:50` DELETE /certs/agent/enroll/:label returns 200  
✅ `13:38:50` Delete response .revoked=true (unused token was removed)  
✅ `13:39:04` Lookup of revoked token returns 401  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `13:39:04` Cleaning up test resources...  
