# Portlama E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-03-20 14:35:54 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `14:35:57` Tunnel creation returned ok: true  
✅ `14:35:57` Tunnel has an ID  
ℹ️ `14:35:57` Created tunnel ID: c3402dd3-ceeb-4386-8927-b10d920cd7d9 (e2ejourney.test.portlama.local)  
✅ `14:35:57` Added DNS entries to agent /etc/hosts  
✅ `14:35:58` Added e2ejourney.test.portlama.local to visitor /etc/hosts  
✅ `14:36:00` HTTP server running on agent at port 18090  
ℹ️ `14:36:00` Waiting for Chisel tunnel to establish...  
✅ `14:36:00` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `14:36:00` oathtool is available on visitor VM  
✅ `14:36:00` TOTP reset returned otpauth URI  
✅ `14:36:00` Extracted TOTP secret from otpauth URI  
✅ `14:36:03` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `14:36:03` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `14:36:03` Redirect URL contains auth.test.portlama.local  
✅ `14:36:03` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `14:36:04` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `14:36:04` Generated TOTP code: 100805  
✅ `14:36:04` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `14:36:04` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `14:36:04` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `14:36:04` Session persists — second request returns tunnel content without re-auth  
✅ `14:36:05` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `14:36:05` Invalid/expired session rejected (HTTP 302)  
✅ `14:36:05` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `14:36:05` Cleaning up test resources...  
🔵 `14:36:08` **Running: 07-site-visitor-journey.sh**  
