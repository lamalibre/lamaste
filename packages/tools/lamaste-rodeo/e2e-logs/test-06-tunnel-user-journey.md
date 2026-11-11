# Lamaste E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-11-11 08:59:14 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `08:59:15` Tunnel creation returned ok: true  
✅ `08:59:15` Tunnel has an ID  
✅ `08:59:15` Tunnel is owned by test-agent  
ℹ️ `08:59:15` Created tunnel ID: 482269d6-0e7e-4872-81ff-a9b4234e5c2d (e2ejourney.test.lamaste.local)  
✅ `08:59:15` Added DNS entries to agent /etc/hosts  
✅ `08:59:15` Added e2ejourney.test.lamaste.local to visitor /etc/hosts  
✅ `08:59:18` HTTP server running on agent at port 18090  
ℹ️ `08:59:18` Waiting for Chisel tunnel to establish...  
✅ `08:59:19` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `08:59:19` oathtool is available on visitor VM  
✅ `08:59:19` TOTP reset returned otpauth URI  
✅ `08:59:19` Extracted TOTP secret from otpauth URI  
✅ `08:59:31` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `08:59:31` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `08:59:32` Redirect URL contains auth.test.lamaste.local  
✅ `08:59:32` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `08:59:33` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `08:59:33` Generated TOTP code: 690410  
✅ `08:59:33` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `08:59:33` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `08:59:34` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `08:59:34` Session persists — second request returns tunnel content without re-auth  
✅ `08:59:34` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `08:59:34` Invalid/expired session rejected (HTTP 302)  
✅ `08:59:34` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `22` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `22` |

ℹ️ `08:59:34` Cleaning up test resources...  
