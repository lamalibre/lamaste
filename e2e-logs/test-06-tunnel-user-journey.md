# Lamaste E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-03-30 13:10:31 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `13:10:35` Tunnel creation returned ok: true  
✅ `13:10:35` Tunnel has an ID  
ℹ️ `13:10:35` Created tunnel ID: 7f0b7786-6929-4789-9041-fa4f2e0b8c9d (e2ejourney.test.lamaste.local)  
✅ `13:10:35` Added DNS entries to agent /etc/hosts  
✅ `13:10:35` Added e2ejourney.test.lamaste.local to visitor /etc/hosts  
✅ `13:10:37` HTTP server running on agent at port 18090  
ℹ️ `13:10:42` Waiting for Chisel tunnel to establish...  
✅ `13:10:42` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `13:10:42` oathtool is available on visitor VM  
✅ `13:10:42` TOTP reset returned otpauth URI  
✅ `13:10:42` Extracted TOTP secret from otpauth URI  
✅ `13:10:44` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `13:10:44` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `13:10:44` Redirect URL contains auth.test.lamaste.local  
✅ `13:10:44` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `13:10:46` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `13:10:46` Generated TOTP code: 571671  
✅ `13:10:46` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `13:10:46` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `13:10:46` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `13:10:46` Session persists — second request returns tunnel content without re-auth  
✅ `13:10:46` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `13:10:46` Invalid/expired session rejected (HTTP 302)  
✅ `13:10:46` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `13:10:46` Cleaning up test resources...  
🔵 `13:10:52` **Running: 07-site-visitor-journey.sh**  
