# Portlama E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-03-29 09:10:36 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `09:10:39` Tunnel creation returned ok: true  
✅ `09:10:39` Tunnel has an ID  
ℹ️ `09:10:39` Created tunnel ID: 87ecfdb2-0cea-4846-bbb6-f608b744bfdb  
ℹ️ `09:10:48` Waiting for Chisel tunnel to establish...  
✅ `09:10:48` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `09:10:48` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `09:10:48` Redirect points to Authelia portal (auth.test.portlama.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `09:10:49` TOTP reset returned otpauth URI  
✅ `09:10:49` Extracted TOTP secret from otpauth URI  
✅ `09:10:52` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `09:10:52` Generated TOTP code: 156992  
✅ `09:10:52` Second factor authentication succeeded (TOTP accepted)  
✅ `09:10:52` Authenticated request returns tunnel content  
✅ `09:10:52` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `09:10:52` Invalid auth cookie rejected (HTTP 302)  
✅ `09:10:52` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `09:10:53` Authelia portal accessible at https://auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `14` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `14` |

ℹ️ `09:10:53` Cleaning up test resources...  
🔵 `09:10:58` **Running: 05-admin-journey.sh**  
