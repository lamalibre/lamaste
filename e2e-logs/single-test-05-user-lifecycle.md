# Portlama E2E: 05 — User Lifecycle

> Started at `2026-03-16 17:21:27 UTC`


## Pre-flight: check onboarding is complete


## Create user

✅ `17:21:30` User creation returned ok: true  
✅ `17:21:30` Username matches  
✅ `17:21:30` Display name matches  
✅ `17:21:30` Email matches  

## Verify user in list

✅ `17:21:30` User appears in GET /api/users  
✅ `17:21:30` No password field in user list response  
✅ `17:21:30` No bcrypt hash in user list response  

## Validation: duplicate username

✅ `17:21:30` Duplicate username rejected (HTTP 409)  

## Validation: invalid input

✅ `17:21:30` Incomplete user data rejected (HTTP 400)  
✅ `17:21:30` Short password rejected (HTTP 400)  

## Reset TOTP

✅ `17:21:30` TOTP reset returned ok: true  
✅ `17:21:30` TOTP URI is a valid otpauth:// URI  

## TOTP for nonexistent user

✅ `17:21:30` TOTP reset for nonexistent user returns 404  

## Update user

✅ `17:21:32` User update returned ok: true  
✅ `17:21:32` Display name updated  
✅ `17:21:32` Display name persisted after update  

## Update nonexistent user

✅ `17:21:32` Update nonexistent user returns 404  

## Delete user

✅ `17:21:34` User deletion returned ok: true  
✅ `17:21:34` User no longer in list after deletion  

## Cannot delete last user

ℹ️ `17:21:34` Cannot test last-user protection — 2 users exist (need exactly 1)  
ℹ️ `17:21:34` This scenario is tested when only the admin user remains  

## Delete nonexistent user

✅ `17:21:34` Delete nonexistent user returns 404  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

