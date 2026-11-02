# Lamaste E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-11-02 15:45:34 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `15:45:35` Tunnel creation returned ok: true  
✅ `15:45:35` Tunnel has an ID  
✅ `15:45:35` Tunnel is owned by test-agent  
ℹ️ `15:45:35` Created tunnel ID: 6e84516b-13e3-480b-9f71-43f29ff3758d  
ℹ️ `15:45:38` Waiting for Chisel tunnel to establish...  
✅ `15:45:38` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `15:45:38` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `15:45:39` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `15:45:39` TOTP reset returned otpauth URI  
✅ `15:45:39` Extracted TOTP secret from otpauth URI  
✅ `15:46:02` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `15:46:02` Generated TOTP code: 765792  
✅ `15:46:02` Second factor authentication succeeded (TOTP accepted)  
✅ `15:46:03` Authenticated request returns tunnel content  
✅ `15:46:03` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `15:46:03` Invalid auth cookie rejected (HTTP 302)  
✅ `15:46:03` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `15:46:03` Authelia portal accessible at https://auth.test.lamaste.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

ℹ️ `15:46:03` Cleaning up test resources...  
