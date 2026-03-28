# Portlama E2E: 04 — Authelia Authentication (Three-VM)

> Started at `2026-03-28 16:10:23 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `16:10:25` Tunnel creation returned ok: true  
✅ `16:10:25` Tunnel has an ID  
ℹ️ `16:10:25` Created tunnel ID: 7fc71d87-069a-4489-8438-cfa2d7b44fc0  
ℹ️ `16:10:35` Waiting for Chisel tunnel to establish...  
✅ `16:10:35` Chisel tunnel established  

## Test: unauthenticated access is redirected (from visitor VM)

✅ `16:10:35` Unauthenticated request redirected/rejected (HTTP 302)  
✅ `16:10:35` Redirect points to Authelia portal (auth.test.portlama.local)  

## Test: authenticated access succeeds (from visitor VM)

✅ `16:10:36` TOTP reset returned otpauth URI  
✅ `16:10:36` Extracted TOTP secret from otpauth URI  
✅ `16:10:39` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP) from visitor VM

ℹ️ `16:10:39` Generated TOTP code: 674839  
✅ `16:10:39` Second factor authentication succeeded (TOTP accepted)  
✅ `16:10:39` Authenticated request returns tunnel content  
✅ `16:10:39` Authenticated request returns HTTP 200  

## Test: invalid auth cookie is rejected (from visitor VM)

✅ `16:10:39` Invalid auth cookie rejected (HTTP 302)  
✅ `16:10:39` Invalid auth cookie does not return tunnel content  

## Test: Authelia portal is accessible (from visitor VM)

✅ `16:10:39` Authelia portal accessible at https://auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `14` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `14` |

ℹ️ `16:10:39` Cleaning up test resources...  
🔵 `16:10:45` **Running: 05-admin-journey.sh**  
