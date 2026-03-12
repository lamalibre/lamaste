# Portlama E2E: 08 — Invitation Journey (Three-VM)

> Started at `2026-03-16 17:24:12 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Admin creates invitation

✅ `17:24:13` Invitation creation returned ok: true  
✅ `17:24:13` Invitation has a token  
✅ `17:24:13` Invitation has an ID  
✅ `17:24:13` Invitation has an invite URL  
ℹ️ `17:24:13` Created invitation for inviteduser (token: 1e53e7441dbf0116...)  
✅ `17:24:13` Invitation appears in admin invitation list  

## Visit invitation page from visitor VM (public, no mTLS)

✅ `17:24:13` Invite page returns correct username  
✅ `17:24:13` Invite page returns correct email  
✅ `17:24:13` Invite page returns expiresAt  

## Accept invitation from visitor VM (public, no mTLS)

✅ `17:24:15` Invitation acceptance returned ok: true  
✅ `17:24:15` Acceptance response returns correct username  
ℹ️ `17:24:15` User inviteduser created via invitation  

## Verify user appears in admin's user list

✅ `17:24:16` Invited user appears in admin user list  

## Reset TOTP for invited user before authentication

✅ `17:24:16` TOTP reset succeeded for invited user  

## New user authenticates from visitor VM (firstfactor)

✅ `17:24:19` Invited user firstfactor authentication succeeded  

## New user authenticates from visitor VM (secondfactor TOTP)

✅ `17:24:19` Generated TOTP code for invited user on visitor VM  
✅ `17:24:19` Invited user secondfactor TOTP authentication succeeded  
✅ `17:24:19` Invited user session is valid (verify returned 200)  

## Used invitation token is rejected (from visitor VM)

✅ `17:24:19` Used invitation token returns 410 Gone  
✅ `17:24:19` Used invitation token acceptance returns 410 Gone  

## Cleanup: delete invited user

✅ `17:24:21` Invited user deletion returned ok: true  
✅ `17:24:22` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `17:24:22` Cleaning up test resources...  
