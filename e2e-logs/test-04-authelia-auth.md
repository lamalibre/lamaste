# Lamaste E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-03-30 13:09:36 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `13:09:39` Tunnel creation returned ok: true  
✅ `13:09:39` Tunnel has an ID  
ℹ️ `13:09:39` Created tunnel ID: 3f644c53-8ec2-4fae-ace8-74ae00456fdc  
ℹ️ `13:09:54` Waiting for Chisel tunnel to establish...  
✅ `13:09:55` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `13:09:55` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `13:09:55` Redirect points to Authelia portal (auth.test.lamaste.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `13:09:55` TOTP reset returned otpauth URI  
✅ `13:09:55` Extracted TOTP secret from otpauth URI  
✅ `13:09:58` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `13:09:59` Generated TOTP code: 276610  
✅ `13:09:59` Second factor authentication succeeded (TOTP accepted)  
✅ `13:09:59` Authenticated request returns tunnel content  
✅ `13:09:59` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `13:09:59` Invalid auth cookie rejected (HTTP 302)  
✅ `13:09:59` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `13:09:59` Authelia portal accessible at https://auth.test.lamaste.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `14` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `14` |

ℹ️ `13:09:59` Cleaning up test resources...  
🔵 `13:10:05` **Running: 05-admin-journey.sh**  
