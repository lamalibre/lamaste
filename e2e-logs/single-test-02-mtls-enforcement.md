# Portlama E2E: 02 — mTLS Enforcement

> Started at `2026-03-29 09:07:47 UTC`


## Request without client certificate

✅ `09:07:47` Request without cert rejected (HTTP 400)  

## Request with valid client certificate

✅ `09:07:47` Request with valid cert returns HTTP 200  
✅ `09:07:47` Health endpoint returns ok with valid cert  

## Request with invalid certificate

✅ `09:07:47` Request with untrusted cert rejected (HTTP 400)  

## Certificate validity check

✅ `09:07:47` Client certificate has valid expiry: notAfter=Mar 28 09:06:15 2028 GMT  
✅ `09:07:47` Client certificate is signed by the CA  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

