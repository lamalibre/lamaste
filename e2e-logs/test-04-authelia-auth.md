# Portlama E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-03-24 09:39:04 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `09:39:07` Tunnel creation returned ok: true  
✅ `09:39:07` Tunnel has an ID  
ℹ️ `09:39:07` Created tunnel ID: 9e88da60-4059-4777-9193-e44cf57e4e31  
ℹ️ `09:39:09` Waiting for Chisel tunnel to establish...  
✅ `09:39:09` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `09:39:09` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `09:39:09` Redirect points to Authelia portal (auth.test.portlama.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `09:39:10` TOTP reset returned otpauth URI  
✅ `09:39:10` Extracted TOTP secret from otpauth URI  
✅ `09:39:13` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `09:39:13` Generated TOTP code: 605336  
✅ `09:39:13` Second factor authentication succeeded (TOTP accepted)  
✅ `09:39:13` Authenticated request returns tunnel content  
✅ `09:39:13` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `09:39:13` Invalid auth cookie rejected (HTTP 302)  
✅ `09:39:13` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `09:39:14` Authelia portal accessible at https://auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `14` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `14` |

ℹ️ `09:39:14` Cleaning up test resources...  
🔵 `09:39:17` **Running: 05-admin-journey.sh**  
