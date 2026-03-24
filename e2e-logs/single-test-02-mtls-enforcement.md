# Portlama E2E: 02 — mTLS Enforcement

> Started at `2026-03-24 09:37:16 UTC`


## Request without client certificate

✅ `09:37:16` Request without cert rejected (HTTP 400)  

## Request with valid client certificate

✅ `09:37:16` Request with valid cert returns HTTP 200  
✅ `09:37:16` Health endpoint returns ok with valid cert  

## Request with invalid certificate

✅ `09:37:17` Request with untrusted cert rejected (HTTP 400)  

## Certificate validity check

✅ `09:37:17` Client certificate has valid expiry: notAfter=Mar 23 09:36:22 2028 GMT  
✅ `09:37:17` Client certificate is signed by the CA  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

