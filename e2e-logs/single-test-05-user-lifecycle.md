# Lamaste E2E: 05 — User Lifecycle

> Started at `2026-03-30 13:06:27 UTC`


## Pre-flight: check onboarding is complete


## Create user

✅ `13:06:29` User creation returned ok: true  
✅ `13:06:29` Username matches  
✅ `13:06:29` Display name matches  
✅ `13:06:29` Email matches  

## Verify user in list

✅ `13:06:29` User appears in GET /api/users  
✅ `13:06:29` No password field in user list response  
✅ `13:06:29` No bcrypt hash in user list response  

## Validation: duplicate username

✅ `13:06:29` Duplicate username rejected (HTTP 409)  

## Validation: invalid input

✅ `13:06:29` Incomplete user data rejected (HTTP 400)  
✅ `13:06:29` Short password rejected (HTTP 400)  

## Reset TOTP

✅ `13:06:29` TOTP reset returned ok: true  
✅ `13:06:29` TOTP URI is a valid otpauth:// URI  

## TOTP for nonexistent user

✅ `13:06:29` TOTP reset for nonexistent user returns 404  

## Update user

✅ `13:06:31` User update returned ok: true  
✅ `13:06:31` Display name updated  
✅ `13:06:31` Display name persisted after update  

## Update nonexistent user

✅ `13:06:31` Update nonexistent user returns 404  

## Delete user

✅ `13:06:33` User deletion returned ok: true  
✅ `13:06:33` User no longer in list after deletion  

## Cannot delete last user

ℹ️ `13:06:33` Cannot test last-user protection — 2 users exist (need exactly 1)  
ℹ️ `13:06:33` This scenario is tested when only the admin user remains  

## Delete nonexistent user

✅ `13:06:33` Delete nonexistent user returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

