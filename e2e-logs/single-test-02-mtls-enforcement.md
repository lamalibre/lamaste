# Lamaste E2E: 02 — mTLS Enforcement

> Started at `2026-03-30 13:06:17 UTC`


## Request without client certificate

✅ `13:06:17` Request without cert rejected (HTTP 400)  

## Request with valid client certificate

✅ `13:06:17` Request with valid cert returns HTTP 200  
✅ `13:06:17` Health endpoint returns ok with valid cert  

## Request with invalid certificate

✅ `13:06:17` Request with untrusted cert rejected (HTTP 400)  

## Certificate validity check

✅ `13:06:17` Client certificate has valid expiry: notAfter=Mar 29 13:04:54 2028 GMT  
✅ `13:06:17` Client certificate is signed by the CA  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

