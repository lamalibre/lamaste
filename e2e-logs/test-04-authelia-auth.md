# Portlama E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-03-23 12:10:50 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `12:10:53` Tunnel creation returned ok: true  
✅ `12:10:53` Tunnel has an ID  
ℹ️ `12:10:53` Created tunnel ID: 80962fec-e2fa-427e-b69c-42ad379ae208  
ℹ️ `12:10:55` Waiting for Chisel tunnel to establish...  
✅ `12:10:56` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `12:10:56` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `12:10:56` Redirect points to Authelia portal (auth.test.portlama.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `12:10:56` TOTP reset returned otpauth URI  
✅ `12:10:56` Extracted TOTP secret from otpauth URI  
✅ `12:11:00` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `12:11:00` Generated TOTP code: 728441  
✅ `12:11:00` Second factor authentication succeeded (TOTP accepted)  
✅ `12:11:00` Authenticated request returns tunnel content  
✅ `12:11:00` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `12:11:00` Invalid auth cookie rejected (HTTP 302)  
✅ `12:11:00` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `12:11:00` Authelia portal accessible at https://auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `14` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `14` |

ℹ️ `12:11:00` Cleaning up test resources...  
🔵 `12:11:04` **Running: 05-admin-journey.sh**  
