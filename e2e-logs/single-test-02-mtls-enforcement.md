# Portlama E2E: 02 — mTLS Enforcement

> Started at `2026-03-16 17:21:17 UTC`


## Request without client certificate

✅ `17:21:17` Request without cert rejected (HTTP 400)  

## Request with valid client certificate

✅ `17:21:17` Request with valid cert returns HTTP 200  
✅ `17:21:17` Health endpoint returns ok with valid cert  

## Request with invalid certificate

✅ `17:21:18` Request with untrusted cert rejected (HTTP 400)  

## Certificate validity check

✅ `17:21:18` Client certificate has valid expiry: notAfter=Mar 15 17:20:20 2028 GMT  
✅ `17:21:18` Client certificate is signed by the CA  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

