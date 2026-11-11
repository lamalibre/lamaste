# Lamaste E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-11-11 08:58:38 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `08:58:39` Tunnel creation returned ok: true  
✅ `08:58:39` Tunnel has an ID  
✅ `08:58:39` Tunnel is owned by test-agent  
ℹ️ `08:58:39` Created tunnel ID: ee664bea-a17f-4c83-b1cd-206c0c1ea29b  
ℹ️ `08:58:42` Waiting for Chisel tunnel to establish...  
✅ `08:58:42` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `08:58:43` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `08:58:43` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `08:58:43` TOTP reset returned otpauth URI  
✅ `08:58:43` Extracted TOTP secret from otpauth URI  
✅ `08:59:02` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `08:59:02` Generated TOTP code: 184057  
✅ `08:59:02` Second factor authentication succeeded (TOTP accepted)  
✅ `08:59:03` Authenticated request returns tunnel content  
✅ `08:59:03` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `08:59:03` Invalid auth cookie rejected (HTTP 302)  
✅ `08:59:03` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `08:59:03` Authelia portal accessible at https://auth.test.lamaste.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

ℹ️ `08:59:03` Cleaning up test resources...  
