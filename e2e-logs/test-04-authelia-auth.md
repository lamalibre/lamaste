# Portlama E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-03-22 18:26:20 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `18:26:23` Tunnel creation returned ok: true  
✅ `18:26:23` Tunnel has an ID  
ℹ️ `18:26:23` Created tunnel ID: 261f531a-fc81-4db9-ac53-7cfd65741932  
ℹ️ `18:26:26` Waiting for Chisel tunnel to establish...  
✅ `18:26:26` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `18:26:26` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `18:26:26` Redirect points to Authelia portal (auth.test.portlama.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `18:26:27` TOTP reset returned otpauth URI  
✅ `18:26:27` Extracted TOTP secret from otpauth URI  
✅ `18:26:30` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `18:26:30` Generated TOTP code: 720021  
✅ `18:26:30` Second factor authentication succeeded (TOTP accepted)  
✅ `18:26:30` Authenticated request returns tunnel content  
✅ `18:26:30` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `18:26:31` Invalid auth cookie rejected (HTTP 302)  
✅ `18:26:31` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `18:26:31` Authelia portal accessible at https://auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `14` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `14` |

ℹ️ `18:26:31` Cleaning up test resources...  
🔵 `18:26:34` **Running: 05-admin-journey.sh**  
