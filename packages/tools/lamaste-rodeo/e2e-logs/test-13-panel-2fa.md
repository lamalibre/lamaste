# Lamaste E2E: 13 — Panel Built-in TOTP 2FA (Three-VM)

> Started at `2026-11-03 09:28:07 UTC`


## Pre-flight: check onboarding is complete

✅ `09:28:08` Onboarding complete, domain: test.lamaste.local  

## Default state: 2FA disabled

✅ `09:28:08` 2FA is disabled by default  

## Enable 2FA on host

✅ `09:28:08` Setup returns manual key  
✅ `09:28:08` 2FA enabled after confirm  

## Agent API calls still work without 2FA session

ℹ️ `09:28:10` Agent cannot reach panel — agent cert may not be enrolled yet  

## Admin request without cookie returns 401

✅ `09:28:11` Admin request without session cookie returns 401  

## Admin verifies and gets session cookie

ℹ️ `09:28:11` Waiting 20s for next TOTP window...  
✅ `09:28:31` Admin verified with TOTP code  
✅ `09:28:31` Session cookie received  
✅ `09:28:31` Authenticated request with cookie returns 200  

## Disable 2FA and verify IP restored

ℹ️ `09:28:31` Waiting 30s for next TOTP window...  
✅ `09:29:01` 2FA disabled successfully  
✅ `09:29:04` IP:9292 access restored after disabling 2FA  
✅ `09:29:04` 2FA is disabled at end of test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `11` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `11` |

