# Portlama E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-03-26 10:49:41 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `10:49:44` Tunnel creation returned ok: true  
✅ `10:49:44` Tunnel has an ID  
ℹ️ `10:49:44` Created tunnel ID: d6173389-aa77-4a3d-9d63-177d565f7531 (e2ejourney.test.portlama.local)  
✅ `10:49:44` Added DNS entries to agent /etc/hosts  
✅ `10:49:44` Added e2ejourney.test.portlama.local to visitor /etc/hosts  
✅ `10:49:46` HTTP server running on agent at port 18090  
ℹ️ `10:49:52` Waiting for Chisel tunnel to establish...  
✅ `10:49:53` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `10:49:53` oathtool is available on visitor VM  
✅ `10:49:53` TOTP reset returned otpauth URI  
✅ `10:49:53` Extracted TOTP secret from otpauth URI  
✅ `10:49:55` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `10:49:55` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `10:49:55` Redirect URL contains auth.test.portlama.local  
✅ `10:49:55` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `10:49:56` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `10:49:57` Generated TOTP code: 311396  
✅ `10:49:57` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `10:49:57` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `10:49:57` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `10:49:57` Session persists — second request returns tunnel content without re-auth  
✅ `10:49:57` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `10:49:57` Invalid/expired session rejected (HTTP 302)  
✅ `10:49:57` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `10:49:57` Cleaning up test resources...  
🔵 `10:50:03` **Running: 07-site-visitor-journey.sh**  
