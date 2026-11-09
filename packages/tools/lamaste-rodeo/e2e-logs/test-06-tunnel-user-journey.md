# Lamaste E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-11-09 12:38:10 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `12:38:11` Tunnel creation returned ok: true  
✅ `12:38:11` Tunnel has an ID  
✅ `12:38:11` Tunnel is owned by test-agent  
ℹ️ `12:38:11` Created tunnel ID: e540c982-cfed-41b4-87b0-ca16dd5b9df6 (e2ejourney.test.lamaste.local)  
✅ `12:38:11` Added DNS entries to agent /etc/hosts  
✅ `12:38:11` Added e2ejourney.test.lamaste.local to visitor /etc/hosts  
✅ `12:38:14` HTTP server running on agent at port 18090  
ℹ️ `12:38:14` Waiting for Chisel tunnel to establish...  
✅ `12:38:14` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `12:38:15` oathtool is available on visitor VM  
✅ `12:38:15` TOTP reset returned otpauth URI  
✅ `12:38:15` Extracted TOTP secret from otpauth URI  
✅ `12:38:31` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `12:38:31` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `12:38:31` Redirect URL contains auth.test.lamaste.local  
✅ `12:38:31` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `12:38:32` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `12:38:32` Generated TOTP code: 144024  
✅ `12:38:33` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `12:38:33` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `12:38:33` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `12:38:33` Session persists — second request returns tunnel content without re-auth  
✅ `12:38:33` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `12:38:33` Invalid/expired session rejected (HTTP 302)  
✅ `12:38:33` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `22` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `22` |

ℹ️ `12:38:33` Cleaning up test resources...  
