# Portlama E2E: 06 — Tunnel User Journey (Three-VM)

> Started at `2026-03-24 09:39:42 UTC`


## Pre-flight: verify onboarding is complete


## Step 1: Create tunnel and establish connection

✅ `09:39:45` Tunnel creation returned ok: true  
✅ `09:39:45` Tunnel has an ID  
ℹ️ `09:39:45` Created tunnel ID: af2aaffc-43b4-4ab9-b661-06573bcc90e3 (e2ejourney.test.portlama.local)  
✅ `09:39:45` Added DNS entries to agent /etc/hosts  
✅ `09:39:46` Added e2ejourney.test.portlama.local to visitor /etc/hosts  
✅ `09:39:48` HTTP server running on agent at port 18090  
ℹ️ `09:39:48` Waiting for Chisel tunnel to establish...  
✅ `09:39:48` Chisel tunnel established (port 18090 accessible on host)  

## Step 2: Prepare TOTP for test user

✅ `09:39:48` oathtool is available on visitor VM  
✅ `09:39:48` TOTP reset returned otpauth URI  
✅ `09:39:48` Extracted TOTP secret from otpauth URI  
✅ `09:39:50` oathtool generates valid TOTP codes for this secret  

## Step 3: Unauthenticated access redirects to Authelia (from visitor VM)

✅ `09:39:50` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `09:39:50` Redirect URL contains auth.test.portlama.local  
✅ `09:39:51` Tunnel content is NOT visible without authentication  

## Step 4: First factor authentication from visitor VM (username/password)

✅ `09:39:52` First factor authentication succeeded (username/password accepted)  

## Step 5: Second factor authentication from visitor VM (TOTP)

ℹ️ `09:39:52` Generated TOTP code: 322288  
✅ `09:39:52` Second factor authentication succeeded (TOTP accepted)  

## Step 6: Authenticated access from visitor VM shows tunnel content

✅ `09:39:52` Authenticated request returns tunnel content (full 2FA path verified)  
✅ `09:39:52` Authenticated request returns HTTP 200  

## Step 7: Session persistence (no re-auth needed, from visitor VM)

✅ `09:39:52` Session persists — second request returns tunnel content without re-auth  
✅ `09:39:52` Session persists — HTTP 200 on second request  

## Step 8: Invalid session redirects to Authelia again (from visitor VM)

✅ `09:39:53` Invalid/expired session rejected (HTTP 302)  
✅ `09:39:53` Invalid session does not expose tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `21` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `21` |

ℹ️ `09:39:53` Cleaning up test resources...  
🔵 `09:39:56` **Running: 07-site-visitor-journey.sh**  
