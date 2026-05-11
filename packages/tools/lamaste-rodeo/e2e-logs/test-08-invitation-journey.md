# Lamaste E2E: 08 — Invitation Journey (Three-VM)

> Started at `2026-04-30 08:59:13 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Admin creates invitation

✅ `08:59:13` Invitation creation returned ok: true  
✅ `08:59:13` Invitation has a token  
✅ `08:59:13` Invitation has an ID  
✅ `08:59:13` Invitation has an invite URL  
ℹ️ `08:59:13` Created invitation for inviteduser (token: d34d51dd442c37b6...)  
✅ `08:59:13` Invitation appears in admin invitation list  

## Visit invitation page from visitor VM (public, no mTLS)

✅ `08:59:14` Invite page returns correct username  
✅ `08:59:14` Invite page returns correct email  
✅ `08:59:14` Invite page returns expiresAt  

## Accept invitation from visitor VM (public, no mTLS)

✅ `08:59:16` Invitation acceptance returned ok: true  
✅ `08:59:16` Acceptance response returns correct username  
ℹ️ `08:59:16` User inviteduser created via invitation  

## Verify user appears in admin's user list

✅ `08:59:16` Invited user appears in admin user list  

## Reset TOTP for invited user before authentication

✅ `08:59:16` TOTP reset succeeded for invited user  

## New user authenticates from visitor VM (firstfactor)

✅ `08:59:20` Invited user firstfactor authentication succeeded  

## New user authenticates from visitor VM (secondfactor TOTP)

✅ `08:59:20` Generated TOTP code for invited user on visitor VM  
✅ `08:59:20` Invited user secondfactor TOTP authentication succeeded  
✅ `08:59:20` Invited user session is valid (verify returned 200)  

## Used invitation token is rejected (from visitor VM)

✅ `08:59:20` Used invitation token returns 410 Gone  
✅ `08:59:20` Used invitation token acceptance returns 410 Gone  

## Cleanup: delete invited user

✅ `08:59:22` Invited user deletion returned ok: true  
✅ `08:59:23` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `08:59:23` Cleaning up test resources...  
