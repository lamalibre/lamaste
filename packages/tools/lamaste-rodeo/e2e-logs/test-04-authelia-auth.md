# Lamaste E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-11-03 09:25:34 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `09:25:35` Tunnel creation returned ok: true  
✅ `09:25:35` Tunnel has an ID  
✅ `09:25:35` Tunnel is owned by test-agent  
ℹ️ `09:25:35` Created tunnel ID: b79b6f24-8b40-4c54-962c-1e9e266235b7  
ℹ️ `09:25:38` Waiting for Chisel tunnel to establish...  
✅ `09:25:38` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `09:25:38` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `09:25:38` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `09:25:39` TOTP reset returned otpauth URI  
✅ `09:25:39` Extracted TOTP secret from otpauth URI  
✅ `09:26:02` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `09:26:02` Generated TOTP code: 407836  
✅ `09:26:02` Second factor authentication succeeded (TOTP accepted)  
✅ `09:26:02` Authenticated request returns tunnel content  
✅ `09:26:02` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `09:26:02` Invalid auth cookie rejected (HTTP 302)  
✅ `09:26:02` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `09:26:03` Authelia portal accessible at https://auth.test.lamaste.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

ℹ️ `09:26:03` Cleaning up test resources...  
