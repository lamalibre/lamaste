# Portlama E2E: 02 — mTLS Enforcement

> Started at `2026-03-26 10:46:06 UTC`


## Request without client certificate

✅ `10:46:06` Request without cert rejected (HTTP 400)  

## Request with valid client certificate

✅ `10:46:06` Request with valid cert returns HTTP 200  
✅ `10:46:06` Health endpoint returns ok with valid cert  

## Request with invalid certificate

✅ `10:46:06` Request with untrusted cert rejected (HTTP 400)  

## Certificate validity check

✅ `10:46:06` Client certificate has valid expiry: notAfter=Mar 25 10:44:44 2028 GMT  
✅ `10:46:06` Client certificate is signed by the CA  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

