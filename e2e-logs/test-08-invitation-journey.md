# Portlama E2E: 08 — Invitation Journey (Three-VM)

> Started at `2026-03-24 09:40:19 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Admin creates invitation

✅ `09:40:19` Invitation creation returned ok: true  
✅ `09:40:19` Invitation has a token  
✅ `09:40:19` Invitation has an ID  
✅ `09:40:19` Invitation has an invite URL  
ℹ️ `09:40:19` Created invitation for inviteduser (token: 81f066d0b3b3a11c...)  
✅ `09:40:19` Invitation appears in admin invitation list  

## Visit invitation page from visitor VM (public, no mTLS)

✅ `09:40:20` Invite page returns correct username  
✅ `09:40:20` Invite page returns correct email  
✅ `09:40:20` Invite page returns expiresAt  

## Accept invitation from visitor VM (public, no mTLS)

✅ `09:40:22` Invitation acceptance returned ok: true  
✅ `09:40:22` Acceptance response returns correct username  
ℹ️ `09:40:22` User inviteduser created via invitation  

## Verify user appears in admin's user list

✅ `09:40:22` Invited user appears in admin user list  

## Reset TOTP for invited user before authentication

✅ `09:40:22` TOTP reset succeeded for invited user  

## New user authenticates from visitor VM (firstfactor)

✅ `09:40:26` Invited user firstfactor authentication succeeded  

## New user authenticates from visitor VM (secondfactor TOTP)

✅ `09:40:26` Generated TOTP code for invited user on visitor VM  
✅ `09:40:26` Invited user secondfactor TOTP authentication succeeded  
✅ `09:40:26` Invited user session is valid (verify returned 200)  

## Used invitation token is rejected (from visitor VM)

✅ `09:40:26` Used invitation token returns 410 Gone  
✅ `09:40:26` Used invitation token acceptance returns 410 Gone  

## Cleanup: delete invited user

✅ `09:40:28` Invited user deletion returned ok: true  
✅ `09:40:28` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `09:40:28` Cleaning up test resources...  
🔵 `09:40:29` **Running: 09-agent-site-deploy.sh**  
