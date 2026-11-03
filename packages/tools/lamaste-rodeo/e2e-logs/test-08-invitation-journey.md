# Lamaste E2E: 08 — Invitation Journey (Three-VM)

> Started at `2026-11-03 09:27:14 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Admin creates invitation

✅ `09:27:15` Invitation creation returned ok: true  
✅ `09:27:15` Invitation has a token  
✅ `09:27:15` Invitation has an ID  
✅ `09:27:15` Invitation has an invite URL  
ℹ️ `09:27:15` Created invitation for inviteduser (token: 81afde47a66d782d...)  
✅ `09:27:15` Invitation appears in admin invitation list  

## Visit invitation page from visitor VM (public, no mTLS)

✅ `09:27:15` Invite page returns correct username  
✅ `09:27:15` Invite page returns correct email  
✅ `09:27:15` Invite page returns expiresAt  

## Accept invitation from visitor VM (public, no mTLS)

✅ `09:27:16` Invitation acceptance returned ok: true  
✅ `09:27:16` Acceptance response returns correct username  
ℹ️ `09:27:16` User inviteduser created via invitation  

## Verify user appears in admin's user list

✅ `09:27:16` Invited user appears in admin user list  

## Reset TOTP for invited user before authentication

✅ `09:27:16` TOTP reset succeeded for invited user  

## New user authenticates from visitor VM (firstfactor)

✅ `09:27:19` Invited user firstfactor authentication succeeded  

## New user authenticates from visitor VM (secondfactor TOTP)

✅ `09:27:19` Generated TOTP code for invited user on visitor VM  
✅ `09:27:19` Invited user secondfactor TOTP authentication succeeded  
✅ `09:27:19` Invited user session is valid (verify returned 200)  

## Used invitation token is rejected (from visitor VM)

✅ `09:27:19` Used invitation token returns 410 Gone  
✅ `09:27:19` Used invitation token acceptance returns 410 Gone  

## Cleanup: delete invited user

✅ `09:27:19` Invited user deletion returned ok: true  
✅ `09:27:19` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `09:27:19` Cleaning up test resources...  
