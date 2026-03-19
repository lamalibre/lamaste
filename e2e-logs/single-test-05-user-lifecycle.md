# Portlama E2E: 05 — User Lifecycle

> Started at `2026-03-19 12:17:10 UTC`


## Pre-flight: check onboarding is complete


## Create user

✅ `12:17:13` User creation returned ok: true  
✅ `12:17:13` Username matches  
✅ `12:17:13` Display name matches  
✅ `12:17:13` Email matches  

## Verify user in list

✅ `12:17:13` User appears in GET /api/users  
✅ `12:17:13` No password field in user list response  
✅ `12:17:13` No bcrypt hash in user list response  

## Validation: duplicate username

✅ `12:17:13` Duplicate username rejected (HTTP 409)  

## Validation: invalid input

✅ `12:17:13` Incomplete user data rejected (HTTP 400)  
✅ `12:17:13` Short password rejected (HTTP 400)  

## Reset TOTP

✅ `12:17:13` TOTP reset returned ok: true  
✅ `12:17:13` TOTP URI is a valid otpauth:// URI  

## TOTP for nonexistent user

✅ `12:17:13` TOTP reset for nonexistent user returns 404  

## Update user

✅ `12:17:15` User update returned ok: true  
✅ `12:17:15` Display name updated  
✅ `12:17:15` Display name persisted after update  

## Update nonexistent user

✅ `12:17:15` Update nonexistent user returns 404  

## Delete user

✅ `12:17:17` User deletion returned ok: true  
✅ `12:17:17` User no longer in list after deletion  

## Cannot delete last user

ℹ️ `12:17:17` Cannot test last-user protection — 2 users exist (need exactly 1)  
ℹ️ `12:17:17` This scenario is tested when only the admin user remains  

## Delete nonexistent user

✅ `12:17:17` Delete nonexistent user returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

