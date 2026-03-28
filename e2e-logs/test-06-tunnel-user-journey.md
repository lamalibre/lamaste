# Portlama E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-03-28 16:11:11 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `16:11:14` Tunnel creation returned ok: true  
✅ `16:11:14` Tunnel has an ID  
ℹ️ `16:11:14` Created tunnel ID: 7916cf8a-0776-4e55-b2be-687115254b76 (e2ejourney.test.portlama.local)  
✅ `16:11:14` Added DNS entries to agent /etc/hosts  
✅ `16:11:14` Added e2ejourney.test.portlama.local to visitor /etc/hosts  
✅ `16:11:16` HTTP server running on agent at port 18090  
ℹ️ `16:11:22` Waiting for Chisel tunnel to establish...  
✅ `16:11:22` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `16:11:22` oathtool is available on visitor VM  
✅ `16:11:22` TOTP reset returned otpauth URI  
✅ `16:11:22` Extracted TOTP secret from otpauth URI  
✅ `16:11:24` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `16:11:24` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `16:11:25` Redirect URL contains auth.test.portlama.local  
✅ `16:11:25` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `16:11:26` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `16:11:26` Generated TOTP code: 421350  
✅ `16:11:26` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `16:11:26` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `16:11:26` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `16:11:26` Session persists — second request returns tunnel content without re-auth  
✅ `16:11:27` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `16:11:27` Invalid/expired session rejected (HTTP 302)  
✅ `16:11:27` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `16:11:27` Cleaning up test resources...  
🔵 `16:11:33` **Running: 07-site-visitor-journey.sh**  
