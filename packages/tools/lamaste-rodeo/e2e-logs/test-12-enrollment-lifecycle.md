# Lamaste E2E: 12 — Enrollment Token Lifecycle (Three-VM)

> Started at `2026-04-30 08:59:33 UTC`


## Pre-flight: check onboarding is complete

✅ `08:59:33` Onboarding is complete  

## Admin auth mode defaults to p12

✅ `08:59:33` Admin auth mode is p12  

## Create enrollment token on host

✅ `08:59:33` Token created  
✅ `08:59:33` Token value present (64 chars)  

## Public enrollment reachable from agent VM without mTLS

✅ `08:59:33` Enrollment endpoint reachable from agent VM without mTLS (HTTP 401)  

## Generate CSR on agent VM and enroll

✅ `08:59:34` Agent enrolled successfully  
✅ `08:59:34` Enrolled label matches  
✅ `08:59:34` Enrollment returns serial  

## Token replay rejected

✅ `08:59:34` Token replay rejected with 401  

## Enrolled agent in registry with hardware-bound method

✅ `08:59:34` Agent shows enrollmentMethod: hardware-bound  

## Verify lamaste-agent status shows enrolled agent

✅ `08:59:34` lamaste-agent status shows config present  
✅ `08:59:35` systemd service lamalibre-lamaste-chisel-e2e-agent is enabled  
✅ `08:59:35` Agent config file exists after setup  

## Clean up: revoke test agent

✅ `08:59:35` Cleaned up test agent and temp files  

## Admin upgrade endpoint is locked down (B9)

✅ `08:59:36` Panel-initiated admin upgrade returns 503  
✅ `08:59:36` Error message references `lamaste-server reset-admin` recovery path  
✅ `08:59:36` Admin auth mode still p12 after refused upgrade  

## P12 rotation lockdown

✅ `08:59:36` P12 rotation blocked (HTTP 503)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `18` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `18` |

