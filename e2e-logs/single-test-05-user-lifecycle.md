# Portlama E2E: 05 — User Lifecycle

> Started at `2026-03-28 22:38:33 UTC`


## Pre-flight: check onboarding is complete


## Create user

✅ `22:38:35` User creation returned ok: true  
✅ `22:38:35` Username matches  
✅ `22:38:35` Display name matches  
✅ `22:38:35` Email matches  

## Verify user in list

✅ `22:38:35` User appears in GET /api/users  
✅ `22:38:35` No password field in user list response  
✅ `22:38:35` No bcrypt hash in user list response  

## Validation: duplicate username

✅ `22:38:35` Duplicate username rejected (HTTP 409)  

## Validation: invalid input

✅ `22:38:35` Incomplete user data rejected (HTTP 400)  
✅ `22:38:35` Short password rejected (HTTP 400)  

## Reset TOTP

✅ `22:38:35` TOTP reset returned ok: true  
✅ `22:38:35` TOTP URI is a valid otpauth:// URI  

## TOTP for nonexistent user

✅ `22:38:35` TOTP reset for nonexistent user returns 404  

## Update user

✅ `22:38:38` User update returned ok: true  
✅ `22:38:38` Display name updated  
✅ `22:38:38` Display name persisted after update  

## Update nonexistent user

✅ `22:38:38` Update nonexistent user returns 404  

## Delete user

✅ `22:38:40` User deletion returned ok: true  
✅ `22:38:40` User no longer in list after deletion  

## Cannot delete last user

ℹ️ `22:38:40` Cannot test last-user protection — 2 users exist (need exactly 1)  
ℹ️ `22:38:40` This scenario is tested when only the admin user remains  

## Delete nonexistent user

✅ `22:38:40` Delete nonexistent user returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

