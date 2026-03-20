# Portlama E2E: 05 — User Lifecycle

> Started at `2026-03-20 14:33:39 UTC`


## Pre-flight: check onboarding is complete


## Create user

✅ `14:33:42` User creation returned ok: true  
✅ `14:33:42` Username matches  
✅ `14:33:42` Display name matches  
✅ `14:33:42` Email matches  

## Verify user in list

✅ `14:33:42` User appears in GET /api/users  
✅ `14:33:42` No password field in user list response  
✅ `14:33:42` No bcrypt hash in user list response  

## Validation: duplicate username

✅ `14:33:42` Duplicate username rejected (HTTP 409)  

## Validation: invalid input

✅ `14:33:42` Incomplete user data rejected (HTTP 400)  
✅ `14:33:42` Short password rejected (HTTP 400)  

## Reset TOTP

✅ `14:33:42` TOTP reset returned ok: true  
✅ `14:33:42` TOTP URI is a valid otpauth:// URI  

## TOTP for nonexistent user

✅ `14:33:42` TOTP reset for nonexistent user returns 404  

## Update user

✅ `14:33:44` User update returned ok: true  
✅ `14:33:44` Display name updated  
✅ `14:33:44` Display name persisted after update  

## Update nonexistent user

✅ `14:33:44` Update nonexistent user returns 404  

## Delete user

✅ `14:33:46` User deletion returned ok: true  
✅ `14:33:46` User no longer in list after deletion  

## Cannot delete last user

ℹ️ `14:33:46` Cannot test last-user protection — 2 users exist (need exactly 1)  
ℹ️ `14:33:46` This scenario is tested when only the admin user remains  

## Delete nonexistent user

✅ `14:33:46` Delete nonexistent user returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

