# Portlama E2E: 02 — mTLS Enforcement

> Started at `2026-03-19 12:17:00 UTC`


## Request without client certificate

✅ `12:17:00` Request without cert rejected (HTTP 400)  

## Request with valid client certificate

✅ `12:17:00` Request with valid cert returns HTTP 200  
✅ `12:17:00` Health endpoint returns ok with valid cert  

## Request with invalid certificate

✅ `12:17:00` Request with untrusted cert rejected (HTTP 400)  

## Certificate validity check

✅ `12:17:00` Client certificate has valid expiry: notAfter=Mar 18 12:16:01 2028 GMT  
✅ `12:17:00` Client certificate is signed by the CA  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

