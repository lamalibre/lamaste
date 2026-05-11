# Lamaste E2E: 08 — Invitation Journey (Three-VM)

> Started at `2026-03-30 13:11:15 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Admin creates invitation

✅ `13:11:16` Invitation creation returned ok: true  
✅ `13:11:16` Invitation has a token  
✅ `13:11:16` Invitation has an ID  
✅ `13:11:16` Invitation has an invite URL  
ℹ️ `13:11:16` Created invitation for inviteduser (token: e6d7847dae75a312...)  
✅ `13:11:16` Invitation appears in admin invitation list  

## Visit invitation page from visitor VM (public, no mTLS)

✅ `13:11:16` Invite page returns correct username  
✅ `13:11:16` Invite page returns correct email  
✅ `13:11:16` Invite page returns expiresAt  

## Accept invitation from visitor VM (public, no mTLS)

✅ `13:11:18` Invitation acceptance returned ok: true  
✅ `13:11:18` Acceptance response returns correct username  
ℹ️ `13:11:18` User inviteduser created via invitation  

## Verify user appears in admin's user list

✅ `13:11:18` Invited user appears in admin user list  

## Reset TOTP for invited user before authentication

✅ `13:11:19` TOTP reset succeeded for invited user  

## New user authenticates from visitor VM (firstfactor)

✅ `13:11:22` Invited user firstfactor authentication succeeded  

## New user authenticates from visitor VM (secondfactor TOTP)

✅ `13:11:22` Generated TOTP code for invited user on visitor VM  
✅ `13:11:22` Invited user secondfactor TOTP authentication succeeded  
✅ `13:11:22` Invited user session is valid (verify returned 200)  

## Used invitation token is rejected (from visitor VM)

✅ `13:11:22` Used invitation token returns 410 Gone  
✅ `13:11:22` Used invitation token acceptance returns 410 Gone  

## Cleanup: delete invited user

✅ `13:11:24` Invited user deletion returned ok: true  
✅ `13:11:25` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `13:11:25` Cleaning up test resources...  
🔵 `13:11:25` **Running: 09-agent-site-deploy.sh**  
