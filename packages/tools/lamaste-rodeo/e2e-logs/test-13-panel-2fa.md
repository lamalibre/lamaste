# Lamaste E2E: 13 — Panel Built-in TOTP 2FA (Three-VM)

> Started at `2026-11-04 13:32:47 UTC`


## Pre-flight: check onboarding is complete

✅ `13:32:47` Onboarding complete, domain: test.lamaste.local  

## Default state: 2FA disabled

✅ `13:32:47` 2FA is disabled by default  

## Enable 2FA on host

✅ `13:32:47` Setup returns manual key  
✅ `13:32:48` 2FA enabled after confirm  

## Agent API calls still work without 2FA session

ℹ️ `13:32:50` Agent cannot reach panel — agent cert may not be enrolled yet  

## Admin request without cookie returns 401

✅ `13:32:51` Admin request without session cookie returns 401  

## Admin verifies and gets session cookie

ℹ️ `13:32:51` Waiting 10s for next TOTP window...  
✅ `13:33:01` Admin verified with TOTP code  
✅ `13:33:01` Session cookie received  
✅ `13:33:02` Authenticated request with cookie returns 200  

## Disable 2FA and verify IP restored

ℹ️ `13:33:02` Waiting 29s for next TOTP window...  
✅ `13:33:31` 2FA disabled successfully  
✅ `13:33:34` IP:9292 access restored after disabling 2FA  
✅ `13:33:34` 2FA is disabled at end of test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `11` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `11` |

