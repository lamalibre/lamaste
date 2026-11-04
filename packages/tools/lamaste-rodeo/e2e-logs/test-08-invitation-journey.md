# Lamaste E2E: 08 — Invitation Journey (Three-VM)

> Started at `2026-11-04 13:31:47 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Admin creates invitation

✅ `13:31:47` Invitation creation returned ok: true  
✅ `13:31:47` Invitation has a token  
✅ `13:31:47` Invitation has an ID  
✅ `13:31:48` Invitation has an invite URL  
ℹ️ `13:31:48` Created invitation for inviteduser (token: a487e7f4ce94b6ec...)  
✅ `13:31:48` Invitation appears in admin invitation list  

## Visit invitation page from visitor VM (public, no mTLS)

✅ `13:31:48` Invite page returns correct username  
✅ `13:31:48` Invite page returns correct email  
✅ `13:31:48` Invite page returns expiresAt  

## Accept invitation from visitor VM (public, no mTLS)

✅ `13:31:49` Invitation acceptance returned ok: true  
✅ `13:31:49` Acceptance response returns correct username  
ℹ️ `13:31:49` User inviteduser created via invitation  

## Verify user appears in admin's user list

✅ `13:31:49` Invited user appears in admin user list  

## Reset TOTP for invited user before authentication

✅ `13:31:49` TOTP reset succeeded for invited user  

## New user authenticates from visitor VM (firstfactor)

✅ `13:31:52` Invited user firstfactor authentication succeeded  

## New user authenticates from visitor VM (secondfactor TOTP)

✅ `13:31:52` Generated TOTP code for invited user on visitor VM  
✅ `13:31:52` Invited user secondfactor TOTP authentication succeeded  
✅ `13:31:52` Invited user session is valid (verify returned 200)  

## Used invitation token is rejected (from visitor VM)

✅ `13:31:52` Used invitation token returns 410 Gone  
✅ `13:31:52` Used invitation token acceptance returns 410 Gone  

## Cleanup: delete invited user

✅ `13:31:53` Invited user deletion returned ok: true  
✅ `13:31:53` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `13:31:53` Cleaning up test resources...  
