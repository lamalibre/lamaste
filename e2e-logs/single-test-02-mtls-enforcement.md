# Portlama E2E: 02 — mTLS Enforcement

> Started at `2026-03-28 16:08:00 UTC`


## Request without client certificate

✅ `16:08:00` Request without cert rejected (HTTP 400)  

## Request with valid client certificate

✅ `16:08:00` Request with valid cert returns HTTP 200  
✅ `16:08:00` Health endpoint returns ok with valid cert  

## Request with invalid certificate

✅ `16:08:01` Request with untrusted cert rejected (HTTP 400)  

## Certificate validity check

✅ `16:08:01` Client certificate has valid expiry: notAfter=Mar 27 16:06:41 2028 GMT  
✅ `16:08:01` Client certificate is signed by the CA  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

