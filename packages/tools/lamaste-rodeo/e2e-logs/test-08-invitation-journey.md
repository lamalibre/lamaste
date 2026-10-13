# Lamaste E2E: 08 — Invitation Journey (Three-VM)

> Started at `2026-10-13 11:46:19 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Admin creates invitation

✅ `11:46:19` Invitation creation returned ok: true  
✅ `11:46:19` Invitation has a token  
✅ `11:46:19` Invitation has an ID  
✅ `11:46:19` Invitation has an invite URL  
ℹ️ `11:46:19` Created invitation for inviteduser (token: ac448694af0ae883...)  
✅ `11:46:19` Invitation appears in admin invitation list  

## Visit invitation page from visitor VM (public, no mTLS)

✅ `11:46:19` Invite page returns correct username  
✅ `11:46:19` Invite page returns correct email  
✅ `11:46:19` Invite page returns expiresAt  

## Accept invitation from visitor VM (public, no mTLS)

✅ `11:46:22` Invitation acceptance returned ok: true  
✅ `11:46:22` Acceptance response returns correct username  
ℹ️ `11:46:22` User inviteduser created via invitation  

## Verify user appears in admin's user list

✅ `11:46:22` Invited user appears in admin user list  

## Reset TOTP for invited user before authentication

✅ `11:46:22` TOTP reset succeeded for invited user  

## New user authenticates from visitor VM (firstfactor)

✅ `11:46:26` Invited user firstfactor authentication succeeded  

## New user authenticates from visitor VM (secondfactor TOTP)

✅ `11:46:26` Generated TOTP code for invited user on visitor VM  
✅ `11:46:26` Invited user secondfactor TOTP authentication succeeded  
✅ `11:46:26` Invited user session is valid (verify returned 200)  

## Used invitation token is rejected (from visitor VM)

✅ `11:46:26` Used invitation token returns 410 Gone  
✅ `11:46:26` Used invitation token acceptance returns 410 Gone  

## Cleanup: delete invited user

✅ `11:46:28` Invited user deletion returned ok: true  
✅ `11:46:28` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `11:46:28` Cleaning up test resources...  
