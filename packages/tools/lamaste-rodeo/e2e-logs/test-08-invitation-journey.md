# Lamaste E2E: 08 — Invitation Journey (Three-VM)

> Started at `2026-11-09 12:39:14 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Admin creates invitation

✅ `12:39:15` Invitation creation returned ok: true  
✅ `12:39:15` Invitation has a token  
✅ `12:39:15` Invitation has an ID  
✅ `12:39:15` Invitation has an invite URL  
ℹ️ `12:39:15` Created invitation for inviteduser (token: 8d3f8b5e696ba515...)  
✅ `12:39:15` Invitation appears in admin invitation list  

## Visit invitation page from visitor VM (public, no mTLS)

✅ `12:39:15` Invite page returns correct username  
✅ `12:39:15` Invite page returns correct email  
✅ `12:39:15` Invite page returns expiresAt  

## Accept invitation from visitor VM (public, no mTLS)

✅ `12:39:15` Invitation acceptance returned ok: true  
✅ `12:39:15` Acceptance response returns correct username  
ℹ️ `12:39:15` User inviteduser created via invitation  

## Verify user appears in admin's user list

✅ `12:39:15` Invited user appears in admin user list  

## Reset TOTP for invited user before authentication

✅ `12:39:16` TOTP reset succeeded for invited user  

## New user authenticates from visitor VM (firstfactor)

✅ `12:39:19` Invited user firstfactor authentication succeeded  

## New user authenticates from visitor VM (secondfactor TOTP)

✅ `12:39:19` Generated TOTP code for invited user on visitor VM  
✅ `12:39:19` Invited user secondfactor TOTP authentication succeeded  
✅ `12:39:19` Invited user session is valid (verify returned 200)  

## Used invitation token is rejected (from visitor VM)

✅ `12:39:19` Used invitation token returns 410 Gone  
✅ `12:39:19` Used invitation token acceptance returns 410 Gone  

## Cleanup: delete invited user

✅ `12:39:19` Invited user deletion returned ok: true  
✅ `12:39:19` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `12:39:19` Cleaning up test resources...  
