# Lamaste E2E: 13 — Panel Built-in TOTP 2FA (Three-VM)

> Started at `2026-10-13 11:47:43 UTC`


## Pre-flight: check onboarding is complete

✅ `11:47:43` Onboarding complete, domain: test.lamaste.local  

## Default state: 2FA disabled

✅ `11:47:43` 2FA is disabled by default  

## Enable 2FA on host

✅ `11:47:43` Setup returns manual key  
✅ `11:47:43` 2FA enabled after confirm  

## Agent API calls still work without 2FA session

ℹ️ `11:47:46` Agent cannot reach panel — agent cert may not be enrolled yet  

## Admin request without cookie returns 401

✅ `11:47:46` Admin request without session cookie returns 401  

## Admin verifies and gets session cookie

ℹ️ `11:47:46` Waiting 15s for next TOTP window...  
✅ `11:48:02` Admin verified with TOTP code  
✅ `11:48:02` Session cookie received  
✅ `11:48:02` Authenticated request with cookie returns 200  

## Disable 2FA and verify IP restored

ℹ️ `11:48:02` Waiting 29s for next TOTP window...  
✅ `11:48:32` 2FA disabled successfully  
✅ `11:48:34` IP:9292 access restored after disabling 2FA  
✅ `11:48:34` 2FA is disabled at end of test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `11` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `11` |

