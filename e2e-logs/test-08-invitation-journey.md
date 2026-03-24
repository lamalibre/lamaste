# Portlama E2E: 08 — Invitation Journey (Three-VM)

> Started at `2026-03-24 08:13:30 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Admin creates invitation

✅ `08:13:30` Invitation creation returned ok: true  
✅ `08:13:30` Invitation has a token  
✅ `08:13:30` Invitation has an ID  
✅ `08:13:30` Invitation has an invite URL  
ℹ️ `08:13:30` Created invitation for inviteduser (token: 879c446a13f8a3ea...)  
✅ `08:13:30` Invitation appears in admin invitation list  

## Visit invitation page from visitor VM (public, no mTLS)

✅ `08:13:30` Invite page returns correct username  
✅ `08:13:30` Invite page returns correct email  
✅ `08:13:30` Invite page returns expiresAt  

## Accept invitation from visitor VM (public, no mTLS)

✅ `08:13:33` Invitation acceptance returned ok: true  
✅ `08:13:33` Acceptance response returns correct username  
ℹ️ `08:13:33` User inviteduser created via invitation  

## Verify user appears in admin's user list

✅ `08:13:33` Invited user appears in admin user list  

## Reset TOTP for invited user before authentication

✅ `08:13:33` TOTP reset succeeded for invited user  

## New user authenticates from visitor VM (firstfactor)

✅ `08:13:36` Invited user firstfactor authentication succeeded  

## New user authenticates from visitor VM (secondfactor TOTP)

✅ `08:13:36` Generated TOTP code for invited user on visitor VM  
✅ `08:13:36` Invited user secondfactor TOTP authentication succeeded  
✅ `08:13:37` Invited user session is valid (verify returned 200)  

## Used invitation token is rejected (from visitor VM)

✅ `08:13:37` Used invitation token returns 410 Gone  
✅ `08:13:37` Used invitation token acceptance returns 410 Gone  

## Cleanup: delete invited user

✅ `08:13:39` Invited user deletion returned ok: true  
✅ `08:13:39` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `08:13:39` Cleaning up test resources...  
🔵 `08:13:39` **Running: 09-agent-site-deploy.sh**  
