# Lamaste E2E: 27 — Enrollment Public Endpoints (Three-VM)

> Started at `2026-11-10 17:50:42 UTC`


## Initialize cleanup-referenced variables


## Pre-flight: onboarding complete

✅ `17:50:43` Onboarding is COMPLETED  

## Admin creates enrollment token for enroll-public-27

✅ `17:50:43` POST /certs/agent/enroll returns 200  
✅ `17:50:43` Token response ok=true  
✅ `17:50:43` Enrollment token value is non-empty  

## Generate CSR on agent VM

✅ `17:50:43` CSR contains BEGIN CERTIFICATE REQUEST marker  

## POST /api/enroll/ from agent VM without mTLS

✅ `17:50:44` POST /api/enroll/ returns ok=true  
✅ `17:50:44` Enroll response .label matches requested label  
✅ `17:50:44` Enroll response .serial is non-empty  
✅ `17:50:44` Enroll response .cert is non-empty  

## Negative: POST /api/enroll/ with invalid token returns 401

✅ `17:50:44` POST /api/enroll/ with invalid token returns 401  

## POST /api/enroll/lookup returns pending token label

✅ `17:50:44` Second enrollment token captured for lookup test  
✅ `17:50:44` POST /api/enroll/lookup returns ok=true  
✅ `17:50:44` Lookup .label matches issued token label  

## Negative: POST /api/enroll/lookup with invalid token returns 401

✅ `17:50:45` POST /api/enroll/lookup with invalid token returns 401  

## DELETE /api/certs/agent/enroll/:label revokes the unused lookup token

✅ `17:50:45` DELETE /certs/agent/enroll/:label returns 200  
✅ `17:50:45` Delete response .revoked=true (unused token was removed)  
✅ `17:50:59` Lookup of revoked token returns 401  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `17:50:59` Cleaning up test resources...  
