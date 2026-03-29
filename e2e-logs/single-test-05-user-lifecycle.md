# Portlama E2E: 05 — User Lifecycle

> Started at `2026-03-29 09:07:57 UTC`


## Pre-flight: check onboarding is complete


## Create user

✅ `09:07:59` User creation returned ok: true  
✅ `09:07:59` Username matches  
✅ `09:07:59` Display name matches  
✅ `09:07:59` Email matches  

## Verify user in list

✅ `09:07:59` User appears in GET /api/users  
✅ `09:07:59` No password field in user list response  
✅ `09:07:59` No bcrypt hash in user list response  

## Validation: duplicate username

✅ `09:07:59` Duplicate username rejected (HTTP 409)  

## Validation: invalid input

✅ `09:07:59` Incomplete user data rejected (HTTP 400)  
✅ `09:07:59` Short password rejected (HTTP 400)  

## Reset TOTP

✅ `09:07:59` TOTP reset returned ok: true  
✅ `09:07:59` TOTP URI is a valid otpauth:// URI  

## TOTP for nonexistent user

✅ `09:07:59` TOTP reset for nonexistent user returns 404  

## Update user

✅ `09:08:01` User update returned ok: true  
✅ `09:08:01` Display name updated  
✅ `09:08:01` Display name persisted after update  

## Update nonexistent user

✅ `09:08:01` Update nonexistent user returns 404  

## Delete user

✅ `09:08:04` User deletion returned ok: true  
✅ `09:08:04` User no longer in list after deletion  

## Cannot delete last user

ℹ️ `09:08:04` Cannot test last-user protection — 2 users exist (need exactly 1)  
ℹ️ `09:08:04` This scenario is tested when only the admin user remains  

## Delete nonexistent user

✅ `09:08:04` Delete nonexistent user returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

