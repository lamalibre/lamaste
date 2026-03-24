# Portlama E2E: 05 — User Lifecycle

> Started at `2026-03-24 08:10:32 UTC`


## Pre-flight: check onboarding is complete


## Create user

✅ `08:10:35` User creation returned ok: true  
✅ `08:10:35` Username matches  
✅ `08:10:35` Display name matches  
✅ `08:10:35` Email matches  

## Verify user in list

✅ `08:10:35` User appears in GET /api/users  
✅ `08:10:35` No password field in user list response  
✅ `08:10:35` No bcrypt hash in user list response  

## Validation: duplicate username

✅ `08:10:35` Duplicate username rejected (HTTP 409)  

## Validation: invalid input

✅ `08:10:35` Incomplete user data rejected (HTTP 400)  
✅ `08:10:35` Short password rejected (HTTP 400)  

## Reset TOTP

✅ `08:10:35` TOTP reset returned ok: true  
✅ `08:10:35` TOTP URI is a valid otpauth:// URI  

## TOTP for nonexistent user

✅ `08:10:35` TOTP reset for nonexistent user returns 404  

## Update user

✅ `08:10:37` User update returned ok: true  
✅ `08:10:37` Display name updated  
✅ `08:10:37` Display name persisted after update  

## Update nonexistent user

✅ `08:10:37` Update nonexistent user returns 404  

## Delete user

✅ `08:10:39` User deletion returned ok: true  
✅ `08:10:39` User no longer in list after deletion  

## Cannot delete last user

ℹ️ `08:10:39` Cannot test last-user protection — 2 users exist (need exactly 1)  
ℹ️ `08:10:39` This scenario is tested when only the admin user remains  

## Delete nonexistent user

✅ `08:10:39` Delete nonexistent user returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

