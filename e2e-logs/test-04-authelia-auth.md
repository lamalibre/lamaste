# Portlama E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-03-20 14:35:15 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `14:35:18` Tunnel creation returned ok: true  
✅ `14:35:18` Tunnel has an ID  
ℹ️ `14:35:18` Created tunnel ID: 23acc703-9607-4234-bb0e-71151d53a973  
ℹ️ `14:35:20` Waiting for Chisel tunnel to establish...  
✅ `14:35:21` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `14:35:21` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `14:35:21` Redirect points to Authelia portal (auth.test.portlama.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `14:35:21` TOTP reset returned otpauth URI  
✅ `14:35:21` Extracted TOTP secret from otpauth URI  
✅ `14:35:24` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `14:35:25` Generated TOTP code: 019174  
✅ `14:35:25` Second factor authentication succeeded (TOTP accepted)  
✅ `14:35:25` Authenticated request returns tunnel content  
✅ `14:35:25` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `14:35:25` Invalid auth cookie rejected (HTTP 302)  
✅ `14:35:25` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `14:35:25` Authelia portal accessible at https://auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `14` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `14` |

ℹ️ `14:35:25` Cleaning up test resources...  
🔵 `14:35:28` **Running: 05-admin-journey.sh**  
