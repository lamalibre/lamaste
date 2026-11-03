# Lamaste E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-11-03 09:26:09 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `09:26:10` Tunnel creation returned ok: true  
✅ `09:26:10` Tunnel has an ID  
✅ `09:26:10` Tunnel is owned by test-agent  
ℹ️ `09:26:10` Created tunnel ID: dcaa1630-0b1d-4c16-83b0-0104e34307c9 (e2ejourney.test.lamaste.local)  
✅ `09:26:10` Added DNS entries to agent /etc/hosts  
✅ `09:26:10` Added e2ejourney.test.lamaste.local to visitor /etc/hosts  
✅ `09:26:13` HTTP server running on agent at port 18090  
ℹ️ `09:26:13` Waiting for Chisel tunnel to establish...  
✅ `09:26:13` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `09:26:13` oathtool is available on visitor VM  
✅ `09:26:14` TOTP reset returned otpauth URI  
✅ `09:26:14` Extracted TOTP secret from otpauth URI  
✅ `09:26:31` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `09:26:31` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `09:26:31` Redirect URL contains auth.test.lamaste.local  
✅ `09:26:31` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `09:26:32` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `09:26:32` Generated TOTP code: 389962  
✅ `09:26:32` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `09:26:32` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `09:26:32` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `09:26:33` Session persists — second request returns tunnel content without re-auth  
✅ `09:26:33` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `09:26:33` Invalid/expired session rejected (HTTP 302)  
✅ `09:26:33` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `22` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `22` |

ℹ️ `09:26:33` Cleaning up test resources...  
