# Portlama E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-03-19 12:18:44 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `12:18:46` Tunnel creation returned ok: true  
✅ `12:18:46` Tunnel has an ID  
ℹ️ `12:18:46` Created tunnel ID: 77f75475-c07f-4ee9-b348-fae789c522d5  
ℹ️ `12:18:49` Waiting for Chisel tunnel to establish...  
✅ `12:18:49` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `12:18:49` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `12:18:49` Redirect points to Authelia portal (auth.test.portlama.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `12:18:49` TOTP reset returned otpauth URI  
✅ `12:18:49` Extracted TOTP secret from otpauth URI  
✅ `12:18:53` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `12:18:53` Generated TOTP code: 619201  
✅ `12:18:53` Second factor authentication succeeded (TOTP accepted)  
✅ `12:18:53` Authenticated request returns tunnel content  
✅ `12:18:53` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `12:18:53` Invalid auth cookie rejected (HTTP 302)  
✅ `12:18:53` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `12:18:53` Authelia portal accessible at https://auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `14` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `14` |

ℹ️ `12:18:53` Cleaning up test resources...  
🔵 `12:18:56` **Running: 05-admin-journey.sh**  
