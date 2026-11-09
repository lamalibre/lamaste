# Lamaste E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-11-09 12:37:34 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `12:37:35` Tunnel creation returned ok: true  
✅ `12:37:35` Tunnel has an ID  
✅ `12:37:35` Tunnel is owned by test-agent  
ℹ️ `12:37:35` Created tunnel ID: 3d50f2aa-a430-4714-badf-2fa97d646904  
ℹ️ `12:37:38` Waiting for Chisel tunnel to establish...  
✅ `12:37:38` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `12:37:39` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `12:37:39` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `12:37:39` TOTP reset returned otpauth URI  
✅ `12:37:39` Extracted TOTP secret from otpauth URI  
✅ `12:38:02` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `12:38:02` Generated TOTP code: 166620  
✅ `12:38:02` Second factor authentication succeeded (TOTP accepted)  
✅ `12:38:03` Authenticated request returns tunnel content  
✅ `12:38:03` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `12:38:03` Invalid auth cookie rejected (HTTP 302)  
✅ `12:38:03` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `12:38:03` Authelia portal accessible at https://auth.test.lamaste.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

ℹ️ `12:38:03` Cleaning up test resources...  
