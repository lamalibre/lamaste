# Lamaste E2E: 13 — Panel Built-in TOTP 2FA (Three-VM)

> Started at `2026-11-02 15:48:23 UTC`


## Pre-flight: check onboarding is complete

✅ `15:48:23` Onboarding complete, domain: test.lamaste.local  

## Default state: 2FA disabled

✅ `15:48:23` 2FA is disabled by default  

## Enable 2FA on host

✅ `15:48:23` Setup returns manual key  
✅ `15:48:23` 2FA enabled after confirm  

## Agent API calls still work without 2FA session

ℹ️ `15:48:25` Agent cannot reach panel — agent cert may not be enrolled yet  

## Admin request without cookie returns 401

✅ `15:48:26` Admin request without session cookie returns 401  

## Admin verifies and gets session cookie

ℹ️ `15:48:26` Waiting 5s for next TOTP window...  
✅ `15:48:31` Admin verified with TOTP code  
✅ `15:48:31` Session cookie received  
✅ `15:48:31` Authenticated request with cookie returns 200  

## Disable 2FA and verify IP restored

ℹ️ `15:48:31` Waiting 30s for next TOTP window...  
✅ `15:49:01` 2FA disabled successfully  
✅ `15:49:03` IP:9292 access restored after disabling 2FA  
✅ `15:49:04` 2FA is disabled at end of test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `11` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `11` |

