# Portlama E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-03-24 08:12:52 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `08:12:55` Tunnel creation returned ok: true  
✅ `08:12:55` Tunnel has an ID  
ℹ️ `08:12:55` Created tunnel ID: d8298d7e-7d05-4409-b286-aacc454560d4 (e2ejourney.test.portlama.local)  
✅ `08:12:56` Added DNS entries to agent /etc/hosts  
✅ `08:12:56` Added e2ejourney.test.portlama.local to visitor /etc/hosts  
✅ `08:12:58` HTTP server running on agent at port 18090  
ℹ️ `08:12:58` Waiting for Chisel tunnel to establish...  
✅ `08:12:58` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `08:12:59` oathtool is available on visitor VM  
✅ `08:12:59` TOTP reset returned otpauth URI  
✅ `08:12:59` Extracted TOTP secret from otpauth URI  
✅ `08:13:01` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `08:13:01` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `08:13:01` Redirect URL contains auth.test.portlama.local  
✅ `08:13:01` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `08:13:02` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `08:13:02` Generated TOTP code: 552464  
✅ `08:13:03` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `08:13:03` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `08:13:03` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `08:13:03` Session persists — second request returns tunnel content without re-auth  
✅ `08:13:03` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `08:13:03` Invalid/expired session rejected (HTTP 302)  
✅ `08:13:03` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `08:13:03` Cleaning up test resources...  
🔵 `08:13:06` **Running: 07-site-visitor-journey.sh**  
