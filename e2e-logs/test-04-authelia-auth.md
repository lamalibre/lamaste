# Portlama E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-03-28 22:41:00 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `22:41:03` Tunnel creation returned ok: true  
✅ `22:41:03` Tunnel has an ID  
ℹ️ `22:41:03` Created tunnel ID: 5ae82cab-2822-4ef1-889a-97eeb8075295  
ℹ️ `22:41:12` Waiting for Chisel tunnel to establish...  
✅ `22:41:12` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `22:41:12` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `22:41:13` Redirect points to Authelia portal (auth.test.portlama.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `22:41:13` TOTP reset returned otpauth URI  
✅ `22:41:13` Extracted TOTP secret from otpauth URI  
✅ `22:41:16` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `22:41:16` Generated TOTP code: 294443  
✅ `22:41:16` Second factor authentication succeeded (TOTP accepted)  
✅ `22:41:16` Authenticated request returns tunnel content  
✅ `22:41:16` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `22:41:17` Invalid auth cookie rejected (HTTP 302)  
✅ `22:41:17` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `22:41:17` Authelia portal accessible at https://auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `14` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `14` |

ℹ️ `22:41:17` Cleaning up test resources...  
🔵 `22:41:22` **Running: 05-admin-journey.sh**  
