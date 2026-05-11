# Lamaste E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-04-30 08:57:58 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `08:58:01` Tunnel creation returned ok: true  
✅ `08:58:01` Tunnel has an ID  
ℹ️ `08:58:01` Created tunnel ID: 0eb47db0-c6b0-4aac-b5ac-493e71a5734d (e2ejourney.test.lamaste.local)  
✅ `08:58:01` Added DNS entries to agent /etc/hosts  
✅ `08:58:01` Added e2ejourney.test.lamaste.local to visitor /etc/hosts  
✅ `08:58:03` HTTP server running on agent at port 18090  
ℹ️ `08:58:10` Waiting for Chisel tunnel to establish...  
✅ `08:58:10` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `08:58:10` oathtool is available on visitor VM  
✅ `08:58:10` TOTP reset returned otpauth URI  
✅ `08:58:10` Extracted TOTP secret from otpauth URI  
✅ `08:58:32` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `08:58:32` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `08:58:32` Redirect URL contains auth.test.lamaste.local  
✅ `08:58:32` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `08:58:33` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `08:58:33` Generated TOTP code: 409683  
✅ `08:58:33` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `08:58:33` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `08:58:34` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `08:58:34` Session persists — second request returns tunnel content without re-auth  
✅ `08:58:34` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `08:58:34` Invalid/expired session rejected (HTTP 302)  
✅ `08:58:34` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `08:58:34` Cleaning up test resources...  
