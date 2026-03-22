# Portlama E2E: 08 — Invitation Journey (Three-VM)

> Started at `2026-03-22 18:27:52 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Admin creates invitation

✅ `18:27:54` Invitation creation returned ok: true  
✅ `18:27:54` Invitation has a token  
✅ `18:27:54` Invitation has an ID  
✅ `18:27:54` Invitation has an invite URL  
ℹ️ `18:27:54` Created invitation for inviteduser (token: fbdd542cd84505ec...)  
✅ `18:27:54` Invitation appears in admin invitation list  

## Visit invitation page from visitor VM (public, no mTLS)

✅ `18:27:54` Invite page returns correct username  
✅ `18:27:54` Invite page returns correct email  
✅ `18:27:54` Invite page returns expiresAt  

## Accept invitation from visitor VM (public, no mTLS)

✅ `18:27:57` Invitation acceptance returned ok: true  
✅ `18:27:57` Acceptance response returns correct username  
ℹ️ `18:27:57` User inviteduser created via invitation  

## Verify user appears in admin's user list

✅ `18:27:57` Invited user appears in admin user list  

## Reset TOTP for invited user before authentication

✅ `18:27:57` TOTP reset succeeded for invited user  

## New user authenticates from visitor VM (firstfactor)

✅ `18:28:01` Invited user firstfactor authentication succeeded  

## New user authenticates from visitor VM (secondfactor TOTP)

✅ `18:28:01` Generated TOTP code for invited user on visitor VM  
✅ `18:28:01` Invited user secondfactor TOTP authentication succeeded  
✅ `18:28:01` Invited user session is valid (verify returned 200)  

## Used invitation token is rejected (from visitor VM)

✅ `18:28:01` Used invitation token returns 410 Gone  
✅ `18:28:01` Used invitation token acceptance returns 410 Gone  

## Cleanup: delete invited user

✅ `18:28:03` Invited user deletion returned ok: true  
✅ `18:28:04` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `18:28:04` Cleaning up test resources...  
🔵 `18:28:05` **Running: 09-agent-site-deploy.sh**  
