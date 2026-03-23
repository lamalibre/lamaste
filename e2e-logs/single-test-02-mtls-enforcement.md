# Portlama E2E: 02 — mTLS Enforcement

> Started at `2026-03-23 12:08:55 UTC`


## Request without client certificate

✅ `12:08:55` Request without cert rejected (HTTP 400)  

## Request with valid client certificate

✅ `12:08:55` Request with valid cert returns HTTP 200  
✅ `12:08:55` Health endpoint returns ok with valid cert  

## Request with invalid certificate

✅ `12:08:55` Request with untrusted cert rejected (HTTP 400)  

## Certificate validity check

✅ `12:08:55` Client certificate has valid expiry: notAfter=Mar 22 12:07:49 2028 GMT  
✅ `12:08:55` Client certificate is signed by the CA  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

