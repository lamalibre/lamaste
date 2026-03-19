# Portlama E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-03-19 12:19:22 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `12:19:25` Tunnel creation returned ok: true  
✅ `12:19:25` Tunnel has an ID  
ℹ️ `12:19:25` Created tunnel ID: a5ed4ad8-12cc-4326-9983-3f6c9646f1d4 (e2ejourney.test.portlama.local)  
✅ `12:19:25` Added DNS entries to agent /etc/hosts  
✅ `12:19:26` Added e2ejourney.test.portlama.local to visitor /etc/hosts  
✅ `12:19:28` HTTP server running on agent at port 18090  
ℹ️ `12:19:28` Waiting for Chisel tunnel to establish...  
✅ `12:19:28` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `12:19:28` oathtool is available on visitor VM  
✅ `12:19:28` TOTP reset returned otpauth URI  
✅ `12:19:28` Extracted TOTP secret from otpauth URI  
✅ `12:19:30` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `12:19:30` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `12:19:31` Redirect URL contains auth.test.portlama.local  
✅ `12:19:31` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `12:19:32` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `12:19:32` Generated TOTP code: 379988  
✅ `12:19:32` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `12:19:32` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `12:19:32` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `12:19:32` Session persists — second request returns tunnel content without re-auth  
✅ `12:19:32` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `12:19:33` Invalid/expired session rejected (HTTP 302)  
✅ `12:19:33` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `12:19:33` Cleaning up test resources...  
🔵 `12:19:36` **Running: 07-site-visitor-journey.sh**  
