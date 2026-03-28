# Portlama E2E: 08 — Invitation Journey (Three-VM)

> Started at `2026-03-28 22:42:33 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Admin creates invitation

✅ `22:42:33` Invitation creation returned ok: true  
✅ `22:42:33` Invitation has a token  
✅ `22:42:33` Invitation has an ID  
✅ `22:42:33` Invitation has an invite URL  
ℹ️ `22:42:33` Created invitation for inviteduser (token: d51294e8e83c680a...)  
✅ `22:42:33` Invitation appears in admin invitation list  

## Visit invitation page from visitor VM (public, no mTLS)

✅ `22:42:33` Invite page returns correct username  
✅ `22:42:33` Invite page returns correct email  
✅ `22:42:33` Invite page returns expiresAt  

## Accept invitation from visitor VM (public, no mTLS)

✅ `22:42:36` Invitation acceptance returned ok: true  
✅ `22:42:36` Acceptance response returns correct username  
ℹ️ `22:42:36` User inviteduser created via invitation  

## Verify user appears in admin's user list

✅ `22:42:36` Invited user appears in admin user list  

## Reset TOTP for invited user before authentication

✅ `22:42:36` TOTP reset succeeded for invited user  

## New user authenticates from visitor VM (firstfactor)

✅ `22:42:39` Invited user firstfactor authentication succeeded  

## New user authenticates from visitor VM (secondfactor TOTP)

✅ `22:42:39` Generated TOTP code for invited user on visitor VM  
✅ `22:42:39` Invited user secondfactor TOTP authentication succeeded  
✅ `22:42:40` Invited user session is valid (verify returned 200)  

## Used invitation token is rejected (from visitor VM)

✅ `22:42:40` Used invitation token returns 410 Gone  
✅ `22:42:40` Used invitation token acceptance returns 410 Gone  

## Cleanup: delete invited user

✅ `22:42:42` Invited user deletion returned ok: true  
✅ `22:42:42` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `22:42:42` Cleaning up test resources...  
🔵 `22:42:42` **Running: 09-agent-site-deploy.sh**  
