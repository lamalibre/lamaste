# Lamaste E2E: 08 — Invitation Journey (Three-VM)

> Started at `2026-11-02 15:47:14 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Admin creates invitation

✅ `15:47:14` Invitation creation returned ok: true  
✅ `15:47:14` Invitation has a token  
✅ `15:47:14` Invitation has an ID  
✅ `15:47:14` Invitation has an invite URL  
ℹ️ `15:47:14` Created invitation for inviteduser (token: 48709974c7bda948...)  
✅ `15:47:14` Invitation appears in admin invitation list  

## Visit invitation page from visitor VM (public, no mTLS)

✅ `15:47:15` Invite page returns correct username  
✅ `15:47:15` Invite page returns correct email  
✅ `15:47:15` Invite page returns expiresAt  

## Accept invitation from visitor VM (public, no mTLS)

✅ `15:47:15` Invitation acceptance returned ok: true  
✅ `15:47:15` Acceptance response returns correct username  
ℹ️ `15:47:15` User inviteduser created via invitation  

## Verify user appears in admin's user list

✅ `15:47:15` Invited user appears in admin user list  

## Reset TOTP for invited user before authentication

✅ `15:47:15` TOTP reset succeeded for invited user  

## New user authenticates from visitor VM (firstfactor)

✅ `15:47:18` Invited user firstfactor authentication succeeded  

## New user authenticates from visitor VM (secondfactor TOTP)

✅ `15:47:18` Generated TOTP code for invited user on visitor VM  
✅ `15:47:19` Invited user secondfactor TOTP authentication succeeded  
✅ `15:47:19` Invited user session is valid (verify returned 200)  

## Used invitation token is rejected (from visitor VM)

✅ `15:47:19` Used invitation token returns 410 Gone  
✅ `15:47:19` Used invitation token acceptance returns 410 Gone  

## Cleanup: delete invited user

✅ `15:47:19` Invited user deletion returned ok: true  
✅ `15:47:19` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `15:47:19` Cleaning up test resources...  
