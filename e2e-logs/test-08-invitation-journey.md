# Portlama E2E: 08 — Invitation Journey (Three-VM)

> Started at `2026-03-28 16:11:55 UTC`


## Pre-flight: verify onboarding is complete


## Pre-flight: ensure oathtool is available on visitor VM


## Admin creates invitation

✅ `16:11:56` Invitation creation returned ok: true  
✅ `16:11:56` Invitation has a token  
✅ `16:11:56` Invitation has an ID  
✅ `16:11:56` Invitation has an invite URL  
ℹ️ `16:11:56` Created invitation for inviteduser (token: 8146406493783316...)  
✅ `16:11:56` Invitation appears in admin invitation list  

## Visit invitation page from visitor VM (public, no mTLS)

✅ `16:11:56` Invite page returns correct username  
✅ `16:11:56` Invite page returns correct email  
✅ `16:11:56` Invite page returns expiresAt  

## Accept invitation from visitor VM (public, no mTLS)

✅ `16:11:59` Invitation acceptance returned ok: true  
✅ `16:11:59` Acceptance response returns correct username  
ℹ️ `16:11:59` User inviteduser created via invitation  

## Verify user appears in admin's user list

✅ `16:11:59` Invited user appears in admin user list  

## Reset TOTP for invited user before authentication

✅ `16:11:59` TOTP reset succeeded for invited user  

## New user authenticates from visitor VM (firstfactor)

✅ `16:12:02` Invited user firstfactor authentication succeeded  

## New user authenticates from visitor VM (secondfactor TOTP)

✅ `16:12:02` Generated TOTP code for invited user on visitor VM  
✅ `16:12:02` Invited user secondfactor TOTP authentication succeeded  
✅ `16:12:02` Invited user session is valid (verify returned 200)  

## Used invitation token is rejected (from visitor VM)

✅ `16:12:02` Used invitation token returns 410 Gone  
✅ `16:12:03` Used invitation token acceptance returns 410 Gone  

## Cleanup: delete invited user

✅ `16:12:05` Invited user deletion returned ok: true  
✅ `16:12:05` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `16:12:05` Cleaning up test resources...  
🔵 `16:12:05` **Running: 09-agent-site-deploy.sh**  
