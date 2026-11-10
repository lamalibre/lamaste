# Lamaste E2E: 13 — Panel Built-in TOTP 2FA (Three-VM)

> Started at `2026-11-10 13:02:11 UTC`


## Pre-flight: check onboarding is complete

✅ `13:02:11` Onboarding complete, domain: test.lamaste.local  

## Default state: 2FA disabled

✅ `13:02:12` 2FA is disabled by default  

## Enable 2FA on host

✅ `13:02:12` Setup returns manual key  
✅ `13:02:12` 2FA enabled after confirm  

## Agent API calls still work without 2FA session

ℹ️ `13:02:14` Agent cannot reach panel — agent cert may not be enrolled yet  

## Admin request without cookie returns 401

✅ `13:02:15` Admin request without session cookie returns 401  

## Admin verifies and gets session cookie

ℹ️ `13:02:15` Waiting 16s for next TOTP window...  
✅ `13:02:31` Admin verified with TOTP code  
✅ `13:02:31` Session cookie received  
✅ `13:02:31` Authenticated request with cookie returns 200  

## Disable 2FA and verify IP restored

ℹ️ `13:02:31` Waiting 30s for next TOTP window...  
✅ `13:03:02` 2FA disabled successfully  
✅ `13:03:04` IP:9292 access restored after disabling 2FA  
✅ `13:03:04` 2FA is disabled at end of test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `11` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `11` |

