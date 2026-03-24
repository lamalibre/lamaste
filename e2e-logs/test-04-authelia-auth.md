# Portlama E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-03-24 08:12:13 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `08:12:16` Tunnel creation returned ok: true  
✅ `08:12:16` Tunnel has an ID  
ℹ️ `08:12:16` Created tunnel ID: 93148731-e228-4473-bd34-7312d2d69a46  
ℹ️ `08:12:18` Waiting for Chisel tunnel to establish...  
✅ `08:12:19` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `08:12:19` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `08:12:19` Redirect points to Authelia portal (auth.test.portlama.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `08:12:19` TOTP reset returned otpauth URI  
✅ `08:12:19` Extracted TOTP secret from otpauth URI  
✅ `08:12:23` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `08:12:23` Generated TOTP code: 789316  
✅ `08:12:23` Second factor authentication succeeded (TOTP accepted)  
✅ `08:12:23` Authenticated request returns tunnel content  
✅ `08:12:23` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `08:12:23` Invalid auth cookie rejected (HTTP 302)  
✅ `08:12:23` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `08:12:23` Authelia portal accessible at https://auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `14` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `14` |

ℹ️ `08:12:23` Cleaning up test resources...  
🔵 `08:12:26` **Running: 05-admin-journey.sh**  
