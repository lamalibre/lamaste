# Lamaste E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-11-10 12:59:34 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `12:59:35` Tunnel creation returned ok: true  
✅ `12:59:35` Tunnel has an ID  
✅ `12:59:35` Tunnel is owned by test-agent  
ℹ️ `12:59:35` Created tunnel ID: ee772707-536a-4a53-9a09-fdb1c7bb0d47  
ℹ️ `12:59:39` Waiting for Chisel tunnel to establish...  
✅ `12:59:39` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `12:59:39` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `12:59:40` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `12:59:40` TOTP reset returned otpauth URI  
✅ `12:59:40` Extracted TOTP secret from otpauth URI  
✅ `13:00:02` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `13:00:02` Generated TOTP code: 111059  
✅ `13:00:02` Second factor authentication succeeded (TOTP accepted)  
✅ `13:00:02` Authenticated request returns tunnel content  
✅ `13:00:03` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `13:00:03` Invalid auth cookie rejected (HTTP 302)  
✅ `13:00:03` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `13:00:03` Authelia portal accessible at https://auth.test.lamaste.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

ℹ️ `13:00:03` Cleaning up test resources...  
