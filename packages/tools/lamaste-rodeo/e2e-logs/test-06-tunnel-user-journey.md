# Lamaste E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-10-13 11:45:15 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `11:45:16` Tunnel creation returned ok: true  
✅ `11:45:16` Tunnel has an ID  
✅ `11:45:16` Tunnel is owned by test-agent  
ℹ️ `11:45:16` Created tunnel ID: 3f1c1a4e-bc4a-4cb0-bf88-833e9485084a (e2ejourney.test.lamaste.local)  
✅ `11:45:16` Added DNS entries to agent /etc/hosts  
✅ `11:45:16` Added e2ejourney.test.lamaste.local to visitor /etc/hosts  
✅ `11:45:19` HTTP server running on agent at port 18090  
ℹ️ `11:45:20` Waiting for Chisel tunnel to establish...  
✅ `11:45:20` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `11:45:20` oathtool is available on visitor VM  
✅ `11:45:20` TOTP reset returned otpauth URI  
✅ `11:45:20` Extracted TOTP secret from otpauth URI  
✅ `11:45:31` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `11:45:31` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `11:45:31` Redirect URL contains auth.test.lamaste.local  
✅ `11:45:32` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `11:45:33` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `11:45:33` Generated TOTP code: 079482  
✅ `11:45:33` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `11:45:33` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `11:45:33` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `11:45:33` Session persists — second request returns tunnel content without re-auth  
✅ `11:45:33` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `11:45:34` Invalid/expired session rejected (HTTP 302)  
✅ `11:45:34` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `22` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `22` |

ℹ️ `11:45:34` Cleaning up test resources...  
