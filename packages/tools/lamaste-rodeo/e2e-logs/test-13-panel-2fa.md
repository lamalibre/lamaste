# Lamaste E2E: 13 — Panel Built-in TOTP 2FA (Three-VM)

> Started at `2026-04-30 08:59:36 UTC`


## Pre-flight: check onboarding is complete

✅ `08:59:36` Onboarding complete, domain: test.lamaste.local  

## Default state: 2FA disabled

✅ `08:59:36` 2FA is disabled by default  

## Enable 2FA on host

✅ `08:59:36` Setup returns manual key  
✅ `08:59:37` 2FA enabled after confirm  

## Agent API calls still work without 2FA session

ℹ️ `08:59:39` Agent cannot reach panel — agent cert may not be enrolled yet  

## Admin request without cookie returns 401

✅ `08:59:39` Admin request without session cookie returns 401  

## Admin verifies and gets session cookie

ℹ️ `08:59:39` Waiting 22s for next TOTP window...  
✅ `09:00:02` Admin verified with TOTP code  
✅ `09:00:02` Session cookie received  
✅ `09:00:02` Authenticated request with cookie returns 200  

## Disable 2FA and verify IP restored

ℹ️ `09:00:02` Waiting 29s for next TOTP window...  
✅ `09:00:31` 2FA disabled successfully  
✅ `09:00:33` IP:9292 access restored after disabling 2FA  
✅ `09:00:33` 2FA is disabled at end of test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `11` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `11` |

