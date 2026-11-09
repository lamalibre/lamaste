# Lamaste E2E: 13 — Panel Built-in TOTP 2FA (Three-VM)

> Started at `2026-11-09 12:39:59 UTC`


## Pre-flight: check onboarding is complete

✅ `12:39:59` Onboarding complete, domain: test.lamaste.local  

## Default state: 2FA disabled

✅ `12:39:59` 2FA is disabled by default  

## Enable 2FA on host

✅ `12:39:59` Setup returns manual key  
✅ `12:39:59` 2FA enabled after confirm  

## Agent API calls still work without 2FA session

ℹ️ `12:40:01` Agent cannot reach panel — agent cert may not be enrolled yet  

## Admin request without cookie returns 401

✅ `12:40:02` Admin request without session cookie returns 401  

## Admin verifies and gets session cookie

ℹ️ `12:40:02` Waiting 29s for next TOTP window...  
✅ `12:40:31` Admin verified with TOTP code  
✅ `12:40:31` Session cookie received  
✅ `12:40:31` Authenticated request with cookie returns 200  

## Disable 2FA and verify IP restored

ℹ️ `12:40:31` Waiting 30s for next TOTP window...  
✅ `12:41:02` 2FA disabled successfully  
✅ `12:41:04` IP:9292 access restored after disabling 2FA  
✅ `12:41:04` 2FA is disabled at end of test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `11` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `11` |

