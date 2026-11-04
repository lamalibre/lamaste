# Lamaste E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-11-04 13:30:41 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `13:30:42` Tunnel creation returned ok: true  
✅ `13:30:42` Tunnel has an ID  
✅ `13:30:42` Tunnel is owned by test-agent  
ℹ️ `13:30:42` Created tunnel ID: 9422fcb1-2daa-4e44-9d15-d910da1e8fb4 (e2ejourney.test.lamaste.local)  
✅ `13:30:43` Added DNS entries to agent /etc/hosts  
✅ `13:30:43` Added e2ejourney.test.lamaste.local to visitor /etc/hosts  
✅ `13:30:45` HTTP server running on agent at port 18090  
ℹ️ `13:30:46` Waiting for Chisel tunnel to establish...  
✅ `13:30:46` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `13:30:46` oathtool is available on visitor VM  
✅ `13:30:47` TOTP reset returned otpauth URI  
✅ `13:30:47` Extracted TOTP secret from otpauth URI  
✅ `13:31:01` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `13:31:01` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `13:31:01` Redirect URL contains auth.test.lamaste.local  
✅ `13:31:01` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `13:31:02` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `13:31:02` Generated TOTP code: 074014  
✅ `13:31:02` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `13:31:03` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `13:31:03` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `13:31:03` Session persists — second request returns tunnel content without re-auth  
✅ `13:31:03` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `13:31:03` Invalid/expired session rejected (HTTP 302)  
✅ `13:31:03` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `22` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `22` |

ℹ️ `13:31:04` Cleaning up test resources...  
