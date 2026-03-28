# Portlama E2E: 05 — User Lifecycle

> Started at `2026-03-28 16:08:11 UTC`


## Pre-flight: check onboarding is complete


## Create user

✅ `16:08:13` User creation returned ok: true  
✅ `16:08:13` Username matches  
✅ `16:08:13` Display name matches  
✅ `16:08:13` Email matches  

## Verify user in list

✅ `16:08:13` User appears in GET /api/users  
✅ `16:08:13` No password field in user list response  
✅ `16:08:13` No bcrypt hash in user list response  

## Validation: duplicate username

✅ `16:08:13` Duplicate username rejected (HTTP 409)  

## Validation: invalid input

✅ `16:08:13` Incomplete user data rejected (HTTP 400)  
✅ `16:08:13` Short password rejected (HTTP 400)  

## Reset TOTP

✅ `16:08:13` TOTP reset returned ok: true  
✅ `16:08:13` TOTP URI is a valid otpauth:// URI  

## TOTP for nonexistent user

✅ `16:08:13` TOTP reset for nonexistent user returns 404  

## Update user

✅ `16:08:15` User update returned ok: true  
✅ `16:08:15` Display name updated  
✅ `16:08:15` Display name persisted after update  

## Update nonexistent user

✅ `16:08:15` Update nonexistent user returns 404  

## Delete user

✅ `16:08:17` User deletion returned ok: true  
✅ `16:08:17` User no longer in list after deletion  

## Cannot delete last user

ℹ️ `16:08:18` Cannot test last-user protection — 2 users exist (need exactly 1)  
ℹ️ `16:08:18` This scenario is tested when only the admin user remains  

## Delete nonexistent user

✅ `16:08:18` Delete nonexistent user returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

