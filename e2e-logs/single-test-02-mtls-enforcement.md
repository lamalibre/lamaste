# Portlama E2E: 02 — mTLS Enforcement

> Started at `2026-03-28 22:38:23 UTC`


## Request without client certificate

✅ `22:38:23` Request without cert rejected (HTTP 400)  

## Request with valid client certificate

✅ `22:38:23` Request with valid cert returns HTTP 200  
✅ `22:38:23` Health endpoint returns ok with valid cert  

## Request with invalid certificate

✅ `22:38:23` Request with untrusted cert rejected (HTTP 400)  

## Certificate validity check

✅ `22:38:23` Client certificate has valid expiry: notAfter=Mar 27 22:37:03 2028 GMT  
✅ `22:38:23` Client certificate is signed by the CA  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

