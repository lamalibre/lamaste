# Portlama E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-03-23 12:11:31 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `12:11:34` Tunnel creation returned ok: true  
✅ `12:11:34` Tunnel has an ID  
ℹ️ `12:11:34` Created tunnel ID: 04bb9d46-f57f-4d14-93d7-6e6d3d87bfbd (e2ejourney.test.portlama.local)  
✅ `12:11:35` Added DNS entries to agent /etc/hosts  
✅ `12:11:35` Added e2ejourney.test.portlama.local to visitor /etc/hosts  
✅ `12:11:37` HTTP server running on agent at port 18090  
ℹ️ `12:11:37` Waiting for Chisel tunnel to establish...  
✅ `12:11:38` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `12:11:38` oathtool is available on visitor VM  
✅ `12:11:38` TOTP reset returned otpauth URI  
✅ `12:11:38` Extracted TOTP secret from otpauth URI  
✅ `12:11:40` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `12:11:40` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `12:11:40` Redirect URL contains auth.test.portlama.local  
✅ `12:11:40` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `12:11:42` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `12:11:42` Generated TOTP code: 329887  
✅ `12:11:42` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `12:11:42` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `12:11:42` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `12:11:42` Session persists — second request returns tunnel content without re-auth  
✅ `12:11:42` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `12:11:42` Invalid/expired session rejected (HTTP 302)  
✅ `12:11:43` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `12:11:43` Cleaning up test resources...  
🔵 `12:11:46` **Running: 07-site-visitor-journey.sh**  
