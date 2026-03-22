# Portlama E2E: 02 — mTLS Enforcement

> Started at `2026-03-22 18:24:27 UTC`


## Request without client certificate

✅ `18:24:27` Request without cert rejected (HTTP 400)  

## Request with valid client certificate

✅ `18:24:27` Request with valid cert returns HTTP 200  
✅ `18:24:27` Health endpoint returns ok with valid cert  

## Request with invalid certificate

✅ `18:24:28` Request with untrusted cert rejected (HTTP 400)  

## Certificate validity check

✅ `18:24:28` Client certificate has valid expiry: notAfter=Mar 21 18:23:09 2028 GMT  
✅ `18:24:28` Client certificate is signed by the CA  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

