# Portlama E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-03-16 17:23:36 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `17:23:39` Tunnel creation returned ok: true  
✅ `17:23:39` Tunnel has an ID  
ℹ️ `17:23:39` Created tunnel ID: 2cbcf050-7525-4064-a1f1-1866ccc61a69 (e2ejourney.test.portlama.local)  
✅ `17:23:39` Added DNS entries to agent /etc/hosts  
✅ `17:23:39` Added e2ejourney.test.portlama.local to visitor /etc/hosts  
✅ `17:23:41` HTTP server running on agent at port 18090  
ℹ️ `17:23:41` Waiting for Chisel tunnel to establish...  
✅ `17:23:41` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `17:23:41` oathtool is available on visitor VM  
✅ `17:23:42` TOTP reset returned otpauth URI  
✅ `17:23:42` Extracted TOTP secret from otpauth URI  
✅ `17:23:44` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `17:23:44` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `17:23:44` Redirect URL contains auth.test.portlama.local  
✅ `17:23:44` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `17:23:45` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `17:23:45` Generated TOTP code: 890939  
✅ `17:23:45` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `17:23:46` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `17:23:46` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `17:23:46` Session persists — second request returns tunnel content without re-auth  
✅ `17:23:46` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `17:23:46` Invalid/expired session rejected (HTTP 302)  
✅ `17:23:46` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `17:23:46` Cleaning up test resources...  
🔵 `17:23:49` **Running: 07-site-visitor-journey.sh**  
