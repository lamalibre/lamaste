# Lamaste E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-11-04 13:30:05 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `13:30:06` Tunnel creation returned ok: true  
✅ `13:30:06` Tunnel has an ID  
✅ `13:30:06` Tunnel is owned by test-agent  
ℹ️ `13:30:06` Created tunnel ID: acedbd43-1b8f-43f6-87e4-606b0fc73cc1  
ℹ️ `13:30:09` Waiting for Chisel tunnel to establish...  
✅ `13:30:09` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `13:30:10` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `13:30:10` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `13:30:10` TOTP reset returned otpauth URI  
✅ `13:30:10` Extracted TOTP secret from otpauth URI  
✅ `13:30:32` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `13:30:32` Generated TOTP code: 821046  
✅ `13:30:33` Second factor authentication succeeded (TOTP accepted)  
✅ `13:30:33` Authenticated request returns tunnel content  
✅ `13:30:33` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `13:30:33` Invalid auth cookie rejected (HTTP 302)  
✅ `13:30:33` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `13:30:33` Authelia portal accessible at https://auth.test.lamaste.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

ℹ️ `13:30:33` Cleaning up test resources...  
