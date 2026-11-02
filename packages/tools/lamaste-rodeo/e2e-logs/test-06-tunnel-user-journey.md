# Lamaste E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-11-02 15:46:10 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `15:46:11` Tunnel creation returned ok: true  
✅ `15:46:11` Tunnel has an ID  
✅ `15:46:11` Tunnel is owned by test-agent  
ℹ️ `15:46:11` Created tunnel ID: d9cd643c-781d-45b6-b7a5-afaea2aba243 (e2ejourney.test.lamaste.local)  
✅ `15:46:11` Added DNS entries to agent /etc/hosts  
✅ `15:46:11` Added e2ejourney.test.lamaste.local to visitor /etc/hosts  
✅ `15:46:13` HTTP server running on agent at port 18090  
ℹ️ `15:46:14` Waiting for Chisel tunnel to establish...  
✅ `15:46:14` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `15:46:14` oathtool is available on visitor VM  
✅ `15:46:14` TOTP reset returned otpauth URI  
✅ `15:46:14` Extracted TOTP secret from otpauth URI  
✅ `15:46:31` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `15:46:32` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `15:46:32` Redirect URL contains auth.test.lamaste.local  
✅ `15:46:32` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `15:46:33` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `15:46:33` Generated TOTP code: 961259  
✅ `15:46:33` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `15:46:33` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `15:46:33` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `15:46:33` Session persists — second request returns tunnel content without re-auth  
✅ `15:46:33` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `15:46:33` Invalid/expired session rejected (HTTP 302)  
✅ `15:46:34` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `22` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `22` |

ℹ️ `15:46:34` Cleaning up test resources...  
