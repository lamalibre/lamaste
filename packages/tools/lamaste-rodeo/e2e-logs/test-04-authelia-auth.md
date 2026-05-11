# Lamaste E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-04-30 08:57:08 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `08:57:10` Tunnel creation returned ok: true  
✅ `08:57:10` Tunnel has an ID  
ℹ️ `08:57:10` Created tunnel ID: 875d6d21-ef8b-46db-9c3c-2511ff2defee  
ℹ️ `08:57:18` Waiting for Chisel tunnel to establish...  
✅ `08:57:18` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `08:57:18` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `08:57:18` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `08:57:19` TOTP reset returned otpauth URI  
✅ `08:57:19` Extracted TOTP secret from otpauth URI  
✅ `08:57:32` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `08:57:32` Generated TOTP code: 729054  
✅ `08:57:32` Second factor authentication succeeded (TOTP accepted)  
✅ `08:57:32` Authenticated request returns tunnel content  
✅ `08:57:32` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `08:57:33` Invalid auth cookie rejected (HTTP 302)  
✅ `08:57:33` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `08:57:33` Authelia portal accessible at https://auth.test.lamaste.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `14` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `14` |

ℹ️ `08:57:33` Cleaning up test resources...  
