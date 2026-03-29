# Portlama E2E: 08 — Invitation Journey (Three-VM)

> Started at `2026-03-29 09:12:08 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Admin creates invitation

✅ `09:12:09` Invitation creation returned ok: true  
✅ `09:12:09` Invitation has a token  
✅ `09:12:09` Invitation has an ID  
✅ `09:12:09` Invitation has an invite URL  
ℹ️ `09:12:09` Created invitation for inviteduser (token: 126d4c4bbf841a9c...)  
✅ `09:12:09` Invitation appears in admin invitation list  

## Visit invitation page from visitor VM (public, no mTLS)

✅ `09:12:09` Invite page returns correct username  
✅ `09:12:09` Invite page returns correct email  
✅ `09:12:09` Invite page returns expiresAt  

## Accept invitation from visitor VM (public, no mTLS)

✅ `09:12:11` Invitation acceptance returned ok: true  
✅ `09:12:11` Acceptance response returns correct username  
ℹ️ `09:12:11` User inviteduser created via invitation  

## Verify user appears in admin's user list

✅ `09:12:11` Invited user appears in admin user list  

## Reset TOTP for invited user before authentication

✅ `09:12:12` TOTP reset succeeded for invited user  

## New user authenticates from visitor VM (firstfactor)

✅ `09:12:15` Invited user firstfactor authentication succeeded  

## New user authenticates from visitor VM (secondfactor TOTP)

✅ `09:12:15` Generated TOTP code for invited user on visitor VM  
✅ `09:12:15` Invited user secondfactor TOTP authentication succeeded  
✅ `09:12:15` Invited user session is valid (verify returned 200)  

## Used invitation token is rejected (from visitor VM)

✅ `09:12:15` Used invitation token returns 410 Gone  
✅ `09:12:15` Used invitation token acceptance returns 410 Gone  

## Cleanup: delete invited user

✅ `09:12:17` Invited user deletion returned ok: true  
✅ `09:12:18` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `09:12:18` Cleaning up test resources...  
🔵 `09:12:18` **Running: 09-agent-site-deploy.sh**  
