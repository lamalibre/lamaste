# Lamaste E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-11-10 17:43:14 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `17:43:15` Tunnel creation returned ok: true  
✅ `17:43:15` Tunnel has an ID  
✅ `17:43:15` Tunnel is owned by test-agent  
ℹ️ `17:43:15` Created tunnel ID: 8c62f6ec-f491-4af9-a749-8f92a67c558e (e2ejourney.test.lamaste.local)  
✅ `17:43:15` Added DNS entries to agent /etc/hosts  
✅ `17:43:16` Added e2ejourney.test.lamaste.local to visitor /etc/hosts  
✅ `17:43:18` HTTP server running on agent at port 18090  
ℹ️ `17:43:19` Waiting for Chisel tunnel to establish...  
✅ `17:43:19` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `17:43:19` oathtool is available on visitor VM  
✅ `17:43:19` TOTP reset returned otpauth URI  
✅ `17:43:19` Extracted TOTP secret from otpauth URI  
✅ `17:43:32` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `17:43:32` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `17:43:32` Redirect URL contains auth.test.lamaste.local  
✅ `17:43:32` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `17:43:33` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `17:43:33` Generated TOTP code: 613181  
✅ `17:43:33` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `17:43:34` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `17:43:34` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `17:43:34` Session persists — second request returns tunnel content without re-auth  
✅ `17:43:34` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `17:43:34` Invalid/expired session rejected (HTTP 302)  
✅ `17:43:35` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `22` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `22` |

ℹ️ `17:43:35` Cleaning up test resources...  
