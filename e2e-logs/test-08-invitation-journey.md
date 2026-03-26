# Portlama E2E: 08 — Invitation Journey (Three-VM)

> Started at `2026-03-26 10:50:26 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Admin creates invitation

✅ `10:50:26` Invitation creation returned ok: true  
✅ `10:50:26` Invitation has a token  
✅ `10:50:26` Invitation has an ID  
✅ `10:50:26` Invitation has an invite URL  
ℹ️ `10:50:26` Created invitation for inviteduser (token: 5614df86e25d151f...)  
✅ `10:50:26` Invitation appears in admin invitation list  

## Visit invitation page from visitor VM (public, no mTLS)

✅ `10:50:26` Invite page returns correct username  
✅ `10:50:26` Invite page returns correct email  
✅ `10:50:26` Invite page returns expiresAt  

## Accept invitation from visitor VM (public, no mTLS)

✅ `10:50:29` Invitation acceptance returned ok: true  
✅ `10:50:29` Acceptance response returns correct username  
ℹ️ `10:50:29` User inviteduser created via invitation  

## Verify user appears in admin's user list

✅ `10:50:29` Invited user appears in admin user list  

## Reset TOTP for invited user before authentication

✅ `10:50:29` TOTP reset succeeded for invited user  

## New user authenticates from visitor VM (firstfactor)

✅ `10:50:32` Invited user firstfactor authentication succeeded  

## New user authenticates from visitor VM (secondfactor TOTP)

✅ `10:50:33` Generated TOTP code for invited user on visitor VM  
✅ `10:50:33` Invited user secondfactor TOTP authentication succeeded  
✅ `10:50:33` Invited user session is valid (verify returned 200)  

## Used invitation token is rejected (from visitor VM)

✅ `10:50:33` Used invitation token returns 410 Gone  
✅ `10:50:33` Used invitation token acceptance returns 410 Gone  

## Cleanup: delete invited user

✅ `10:50:35` Invited user deletion returned ok: true  
✅ `10:50:35` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `10:50:35` Cleaning up test resources...  
🔵 `10:50:35` **Running: 09-agent-site-deploy.sh**  
