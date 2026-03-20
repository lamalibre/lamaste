# Portlama E2E: 02 — mTLS Enforcement

> Started at `2026-03-20 14:33:29 UTC`


## Request without client certificate

✅ `14:33:29` Request without cert rejected (HTTP 400)  

## Request with valid client certificate

✅ `14:33:29` Request with valid cert returns HTTP 200  
✅ `14:33:29` Health endpoint returns ok with valid cert  

## Request with invalid certificate

✅ `14:33:29` Request with untrusted cert rejected (HTTP 400)  

## Certificate validity check

✅ `14:33:29` Client certificate has valid expiry: notAfter=Mar 19 14:32:28 2028 GMT  
✅ `14:33:29` Client certificate is signed by the CA  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

