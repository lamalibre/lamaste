# Lamaste E2E: 13 — Panel Built-in TOTP 2FA (Three-VM)

> Started at `2026-11-10 17:45:11 UTC`


## Pre-flight: check onboarding is complete

✅ `17:45:11` Onboarding complete, domain: test.lamaste.local  

## Default state: 2FA disabled

✅ `17:45:11` 2FA is disabled by default  

## Enable 2FA on host

✅ `17:45:11` Setup returns manual key  
✅ `17:45:11` 2FA enabled after confirm  

## Agent API calls still work without 2FA session

ℹ️ `17:45:14` Agent cannot reach panel — agent cert may not be enrolled yet  

## Admin request without cookie returns 401

✅ `17:45:14` Admin request without session cookie returns 401  

## Admin verifies and gets session cookie

ℹ️ `17:45:14` Waiting 17s for next TOTP window...  
✅ `17:45:31` Admin verified with TOTP code  
✅ `17:45:31` Session cookie received  
✅ `17:45:32` Authenticated request with cookie returns 200  

## Disable 2FA and verify IP restored

ℹ️ `17:45:32` Waiting 29s for next TOTP window...  
✅ `17:46:01` 2FA disabled successfully  
✅ `17:46:03` IP:9292 access restored after disabling 2FA  
✅ `17:46:04` 2FA is disabled at end of test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `11` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `11` |

