# Lamaste E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-11-10 17:42:38 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `17:42:38` Tunnel creation returned ok: true  
✅ `17:42:38` Tunnel has an ID  
✅ `17:42:38` Tunnel is owned by test-agent  
ℹ️ `17:42:38` Created tunnel ID: c7f06efc-ac2d-474c-acea-4afcdafcd23a  
ℹ️ `17:42:42` Waiting for Chisel tunnel to establish...  
✅ `17:42:42` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `17:42:42` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `17:42:42` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `17:42:43` TOTP reset returned otpauth URI  
✅ `17:42:43` Extracted TOTP secret from otpauth URI  
✅ `17:43:02` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `17:43:02` Generated TOTP code: 778912  
✅ `17:43:02` Second factor authentication succeeded (TOTP accepted)  
✅ `17:43:02` Authenticated request returns tunnel content  
✅ `17:43:03` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `17:43:03` Invalid auth cookie rejected (HTTP 302)  
✅ `17:43:03` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `17:43:03` Authelia portal accessible at https://auth.test.lamaste.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

ℹ️ `17:43:03` Cleaning up test resources...  
