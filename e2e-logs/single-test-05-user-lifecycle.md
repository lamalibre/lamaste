# Portlama E2E: 05 — User Lifecycle

> Started at `2026-03-22 18:24:38 UTC`


## Pre-flight: check onboarding is complete


## Create user

✅ `18:24:41` User creation returned ok: true  
✅ `18:24:41` Username matches  
✅ `18:24:41` Display name matches  
✅ `18:24:41` Email matches  

## Verify user in list

✅ `18:24:41` User appears in GET /api/users  
✅ `18:24:41` No password field in user list response  
✅ `18:24:41` No bcrypt hash in user list response  

## Validation: duplicate username

✅ `18:24:41` Duplicate username rejected (HTTP 409)  

## Validation: invalid input

✅ `18:24:41` Incomplete user data rejected (HTTP 400)  
✅ `18:24:41` Short password rejected (HTTP 400)  

## Reset TOTP

✅ `18:24:41` TOTP reset returned ok: true  
✅ `18:24:41` TOTP URI is a valid otpauth:// URI  

## TOTP for nonexistent user

✅ `18:24:41` TOTP reset for nonexistent user returns 404  

## Update user

✅ `18:24:43` User update returned ok: true  
✅ `18:24:43` Display name updated  
✅ `18:24:43` Display name persisted after update  

## Update nonexistent user

✅ `18:24:43` Update nonexistent user returns 404  

## Delete user

✅ `18:24:45` User deletion returned ok: true  
✅ `18:24:45` User no longer in list after deletion  

## Cannot delete last user

ℹ️ `18:24:45` Cannot test last-user protection — 2 users exist (need exactly 1)  
ℹ️ `18:24:45` This scenario is tested when only the admin user remains  

## Delete nonexistent user

✅ `18:24:45` Delete nonexistent user returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

