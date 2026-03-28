# Portlama E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-03-28 22:41:48 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `22:41:51` Tunnel creation returned ok: true  
✅ `22:41:51` Tunnel has an ID  
ℹ️ `22:41:51` Created tunnel ID: 90ea3022-3bcc-4063-aad7-2968af6c2a29 (e2ejourney.test.portlama.local)  
✅ `22:41:51` Added DNS entries to agent /etc/hosts  
✅ `22:41:51` Added e2ejourney.test.portlama.local to visitor /etc/hosts  
✅ `22:41:53` HTTP server running on agent at port 18090  
ℹ️ `22:41:59` Waiting for Chisel tunnel to establish...  
✅ `22:41:59` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `22:41:59` oathtool is available on visitor VM  
✅ `22:42:00` TOTP reset returned otpauth URI  
✅ `22:42:00` Extracted TOTP secret from otpauth URI  
✅ `22:42:02` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `22:42:02` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `22:42:02` Redirect URL contains auth.test.portlama.local  
✅ `22:42:02` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `22:42:03` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `22:42:03` Generated TOTP code: 578480  
✅ `22:42:03` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `22:42:04` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `22:42:04` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `22:42:04` Session persists — second request returns tunnel content without re-auth  
✅ `22:42:04` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `22:42:04` Invalid/expired session rejected (HTTP 302)  
✅ `22:42:04` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `22:42:04` Cleaning up test resources...  
🔵 `22:42:10` **Running: 07-site-visitor-journey.sh**  
