# Lamaste E2E: 13 — Panel Built-in TOTP 2FA (Three-VM)

> Started at `2026-11-11 09:01:08 UTC`


## Pre-flight: check onboarding is complete

✅ `09:01:08` Onboarding complete, domain: test.lamaste.local  

## Default state: 2FA disabled

✅ `09:01:08` 2FA is disabled by default  

## Enable 2FA on host

✅ `09:01:08` Setup returns manual key  
✅ `09:01:09` 2FA enabled after confirm  

## Agent API calls still work without 2FA session

ℹ️ `09:01:11` Agent cannot reach panel — agent cert may not be enrolled yet  

## Admin request without cookie returns 401

✅ `09:01:11` Admin request without session cookie returns 401  

## Admin verifies and gets session cookie

ℹ️ `09:01:11` Waiting 20s for next TOTP window...  
✅ `09:01:32` Admin verified with TOTP code  
✅ `09:01:32` Session cookie received  
✅ `09:01:32` Authenticated request with cookie returns 200  

## Disable 2FA and verify IP restored

ℹ️ `09:01:32` Waiting 29s for next TOTP window...  
✅ `09:02:01` 2FA disabled successfully  
✅ `09:02:04` IP:9292 access restored after disabling 2FA  
✅ `09:02:04` 2FA is disabled at end of test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `11` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `11` |

