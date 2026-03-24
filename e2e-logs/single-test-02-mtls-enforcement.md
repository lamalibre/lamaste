# Portlama E2E: 02 — mTLS Enforcement

> Started at `2026-03-24 08:10:22 UTC`


## Request without client certificate

✅ `08:10:22` Request without cert rejected (HTTP 400)  

## Request with valid client certificate

✅ `08:10:22` Request with valid cert returns HTTP 200  
✅ `08:10:22` Health endpoint returns ok with valid cert  

## Request with invalid certificate

✅ `08:10:23` Request with untrusted cert rejected (HTTP 400)  

## Certificate validity check

✅ `08:10:23` Client certificate has valid expiry: notAfter=Mar 23 08:09:22 2028 GMT  
✅ `08:10:23` Client certificate is signed by the CA  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

