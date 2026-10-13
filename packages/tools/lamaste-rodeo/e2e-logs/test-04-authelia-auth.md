# Lamaste E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-10-13 11:44:33 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `11:44:34` Tunnel creation returned ok: true  
✅ `11:44:34` Tunnel has an ID  
✅ `11:44:34` Tunnel is owned by test-agent  
ℹ️ `11:44:34` Created tunnel ID: 52bc4b3e-23f9-4663-a860-416f5db75177  
ℹ️ `11:44:37` Waiting for Chisel tunnel to establish...  
✅ `11:44:37` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `11:44:38` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `11:44:38` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `11:44:38` TOTP reset returned otpauth URI  
✅ `11:44:38` Extracted TOTP secret from otpauth URI  
✅ `11:45:02` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `11:45:02` Generated TOTP code: 431194  
✅ `11:45:02` Second factor authentication succeeded (TOTP accepted)  
✅ `11:45:02` Authenticated request returns tunnel content  
✅ `11:45:03` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `11:45:03` Invalid auth cookie rejected (HTTP 302)  
✅ `11:45:03` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `11:45:03` Authelia portal accessible at https://auth.test.lamaste.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

ℹ️ `11:45:03` Cleaning up test resources...  
