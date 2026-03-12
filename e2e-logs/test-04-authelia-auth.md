# Portlama E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-03-16 17:22:58 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `17:23:01` Tunnel creation returned ok: true  
✅ `17:23:01` Tunnel has an ID  
ℹ️ `17:23:01` Created tunnel ID: 60cc8101-4085-4c82-9e09-ae339098016a  
ℹ️ `17:23:03` Waiting for Chisel tunnel to establish...  
✅ `17:23:03` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `17:23:03` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `17:23:03` Redirect points to Authelia portal (auth.test.portlama.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `17:23:04` TOTP reset returned otpauth URI  
✅ `17:23:04` Extracted TOTP secret from otpauth URI  
✅ `17:23:07` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `17:23:07` Generated TOTP code: 854673  
✅ `17:23:07` Second factor authentication succeeded (TOTP accepted)  
✅ `17:23:07` Authenticated request returns tunnel content  
✅ `17:23:07` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `17:23:07` Invalid auth cookie rejected (HTTP 302)  
✅ `17:23:07` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `17:23:08` Authelia portal accessible at https://auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `14` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `14` |

ℹ️ `17:23:08` Cleaning up test resources...  
🔵 `17:23:11` **Running: 05-admin-journey.sh**  
