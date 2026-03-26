# Portlama E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-03-26 10:48:53 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `10:48:56` Tunnel creation returned ok: true  
✅ `10:48:56` Tunnel has an ID  
ℹ️ `10:48:56` Created tunnel ID: afe87a35-ad67-4759-a937-041b0a186785  
ℹ️ `10:49:06` Waiting for Chisel tunnel to establish...  
✅ `10:49:06` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `10:49:06` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `10:49:06` Redirect points to Authelia portal (auth.test.portlama.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `10:49:06` TOTP reset returned otpauth URI  
✅ `10:49:06` Extracted TOTP secret from otpauth URI  
✅ `10:49:09` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `10:49:10` Generated TOTP code: 833823  
✅ `10:49:10` Second factor authentication succeeded (TOTP accepted)  
✅ `10:49:10` Authenticated request returns tunnel content  
✅ `10:49:10` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `10:49:10` Invalid auth cookie rejected (HTTP 302)  
✅ `10:49:10` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `10:49:10` Authelia portal accessible at https://auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `14` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `14` |

ℹ️ `10:49:10` Cleaning up test resources...  
🔵 `10:49:16` **Running: 05-admin-journey.sh**  
