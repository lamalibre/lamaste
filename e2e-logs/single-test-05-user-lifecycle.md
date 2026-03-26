# Portlama E2E: 05 — User Lifecycle

> Started at `2026-03-26 10:46:16 UTC`


## Pre-flight: check onboarding is complete


## Create user

✅ `10:46:19` User creation returned ok: true  
✅ `10:46:19` Username matches  
✅ `10:46:19` Display name matches  
✅ `10:46:19` Email matches  

## Verify user in list

✅ `10:46:19` User appears in GET /api/users  
✅ `10:46:19` No password field in user list response  
✅ `10:46:19` No bcrypt hash in user list response  

## Validation: duplicate username

✅ `10:46:19` Duplicate username rejected (HTTP 409)  

## Validation: invalid input

✅ `10:46:19` Incomplete user data rejected (HTTP 400)  
✅ `10:46:19` Short password rejected (HTTP 400)  

## Reset TOTP

✅ `10:46:19` TOTP reset returned ok: true  
✅ `10:46:19` TOTP URI is a valid otpauth:// URI  

## TOTP for nonexistent user

✅ `10:46:19` TOTP reset for nonexistent user returns 404  

## Update user

✅ `10:46:21` User update returned ok: true  
✅ `10:46:21` Display name updated  
✅ `10:46:21` Display name persisted after update  

## Update nonexistent user

✅ `10:46:21` Update nonexistent user returns 404  

## Delete user

✅ `10:46:23` User deletion returned ok: true  
✅ `10:46:23` User no longer in list after deletion  

## Cannot delete last user

ℹ️ `10:46:23` Cannot test last-user protection — 2 users exist (need exactly 1)  
ℹ️ `10:46:23` This scenario is tested when only the admin user remains  

## Delete nonexistent user

✅ `10:46:23` Delete nonexistent user returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

