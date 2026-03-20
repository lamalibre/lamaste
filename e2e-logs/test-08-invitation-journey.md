# Portlama E2E: 08 — Invitation Journey (Three-VM)

> Started at `2026-03-20 14:36:32 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Admin creates invitation

✅ `14:36:32` Invitation creation returned ok: true  
✅ `14:36:32` Invitation has a token  
✅ `14:36:32` Invitation has an ID  
✅ `14:36:32` Invitation has an invite URL  
ℹ️ `14:36:32` Created invitation for inviteduser (token: 2d08fa58fd01cff0...)  
✅ `14:36:32` Invitation appears in admin invitation list  

## Visit invitation page from visitor VM (public, no mTLS)

✅ `14:36:32` Invite page returns correct username  
✅ `14:36:32` Invite page returns correct email  
✅ `14:36:32` Invite page returns expiresAt  

## Accept invitation from visitor VM (public, no mTLS)

✅ `14:36:35` Invitation acceptance returned ok: true  
✅ `14:36:35` Acceptance response returns correct username  
ℹ️ `14:36:35` User inviteduser created via invitation  

## Verify user appears in admin's user list

✅ `14:36:35` Invited user appears in admin user list  

## Reset TOTP for invited user before authentication

✅ `14:36:35` TOTP reset succeeded for invited user  

## New user authenticates from visitor VM (firstfactor)

✅ `14:36:38` Invited user firstfactor authentication succeeded  

## New user authenticates from visitor VM (secondfactor TOTP)

✅ `14:36:38` Generated TOTP code for invited user on visitor VM  
✅ `14:36:38` Invited user secondfactor TOTP authentication succeeded  
✅ `14:36:38` Invited user session is valid (verify returned 200)  

## Used invitation token is rejected (from visitor VM)

✅ `14:36:39` Used invitation token returns 410 Gone  
✅ `14:36:39` Used invitation token acceptance returns 410 Gone  

## Cleanup: delete invited user

✅ `14:36:41` Invited user deletion returned ok: true  
✅ `14:36:41` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `14:36:41` Cleaning up test resources...  
🔵 `14:36:41` **Running: 09-agent-site-deploy.sh**  
