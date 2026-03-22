# Portlama E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-03-22 18:27:05 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `18:27:09` Tunnel creation returned ok: true  
✅ `18:27:09` Tunnel has an ID  
ℹ️ `18:27:09` Created tunnel ID: 8cedb97f-1cc9-44ae-96b3-a3aaac1c1df0 (e2ejourney.test.portlama.local)  
✅ `18:27:09` Added DNS entries to agent /etc/hosts  
✅ `18:27:09` Added e2ejourney.test.portlama.local to visitor /etc/hosts  
✅ `18:27:12` HTTP server running on agent at port 18090  
ℹ️ `18:27:12` Waiting for Chisel tunnel to establish...  
✅ `18:27:12` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `18:27:13` oathtool is available on visitor VM  
✅ `18:27:15` TOTP reset returned otpauth URI  
✅ `18:27:15` Extracted TOTP secret from otpauth URI  
✅ `18:27:17` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `18:27:17` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `18:27:17` Redirect URL contains auth.test.portlama.local  
✅ `18:27:17` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `18:27:18` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `18:27:19` Generated TOTP code: 168717  
✅ `18:27:19` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `18:27:19` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `18:27:20` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `18:27:20` Session persists — second request returns tunnel content without re-auth  
✅ `18:27:20` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `18:27:21` Invalid/expired session rejected (HTTP 302)  
✅ `18:27:21` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `18:27:21` Cleaning up test resources...  
🔵 `18:27:24` **Running: 07-site-visitor-journey.sh**  
