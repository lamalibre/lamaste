# Lamaste E2E: 27 — Enrollment Public Endpoints (Three-VM)

> Started at `2026-11-02 15:54:10 UTC`


## Initialize cleanup-referenced variables


## Pre-flight: onboarding complete

✅ `15:54:10` Onboarding is COMPLETED  

## Admin creates enrollment token for enroll-public-27

✅ `15:54:10` POST /certs/agent/enroll returns 200  
✅ `15:54:10` Token response ok=true  
✅ `15:54:10` Enrollment token value is non-empty  

## Generate CSR on agent VM

✅ `15:54:11` CSR contains BEGIN CERTIFICATE REQUEST marker  

## POST /api/enroll/ from agent VM without mTLS

✅ `15:54:11` POST /api/enroll/ returns ok=true  
✅ `15:54:11` Enroll response .label matches requested label  
✅ `15:54:11` Enroll response .serial is non-empty  
✅ `15:54:11` Enroll response .cert is non-empty  

## Negative: POST /api/enroll/ with invalid token returns 401

✅ `15:54:11` POST /api/enroll/ with invalid token returns 401  

## POST /api/enroll/lookup returns pending token label

✅ `15:54:12` Second enrollment token captured for lookup test  
✅ `15:54:12` POST /api/enroll/lookup returns ok=true  
✅ `15:54:12` Lookup .label matches issued token label  

## Negative: POST /api/enroll/lookup with invalid token returns 401

✅ `15:54:12` POST /api/enroll/lookup with invalid token returns 401  

## DELETE /api/certs/agent/enroll/:label revokes the unused lookup token

✅ `15:54:12` DELETE /certs/agent/enroll/:label returns 200  
✅ `15:54:12` Delete response .revoked=true (unused token was removed)  
✅ `15:54:26` Lookup of revoked token returns 401  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `15:54:26` Cleaning up test resources...  
