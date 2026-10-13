# Lamaste E2E: 12 — Enrollment Token Lifecycle (Three-VM)

> Started at `2026-10-13 11:47:39 UTC`


## Pre-flight: check onboarding is complete

✅ `11:47:39` Onboarding is complete  

## Admin auth mode defaults to p12

✅ `11:47:39` Admin auth mode is p12  

## Create enrollment token on host

✅ `11:47:39` Token created  
✅ `11:47:39` Token value present (64 chars)  

## Public enrollment reachable from agent VM without mTLS

✅ `11:47:40` Enrollment endpoint reachable from agent VM without mTLS (HTTP 401)  

## Generate CSR on agent VM and enroll

✅ `11:47:41` Agent enrolled successfully  
✅ `11:47:41` Enrolled label matches  
✅ `11:47:41` Enrollment returns serial  

## Token replay rejected

✅ `11:47:41` Token replay rejected with 401  

## Enrolled agent in registry with hardware-bound method

✅ `11:47:41` Agent shows enrollmentMethod: hardware-bound  

## Verify lamaste-agent status shows enrolled agent

✅ `11:47:41` lamaste-agent status shows config present  
✅ `11:47:41` lamaste-agent status has a Sync: line  
✅ `11:47:41` Status Sync: line reports the timer installed  
✅ `11:47:41` Status Sync: line reports no failing sync  
✅ `11:47:41` Status Sync: line reports the timer running its program (last run under 120 s ago)  
✅ `11:47:41` Status Chisel: line shows the pinned release 1.12.0  
✅ `11:47:41` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is enabled  
✅ `11:47:41` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active  
✅ `11:47:41` Chisel unit is not running while the agent carries no tunnel (state: inactive)  
✅ `11:47:41` Agent config file exists after setup  

## Clean up: revoke test agent

✅ `11:47:42` Cleaned up test agent and temp files  

## Admin upgrade endpoint is locked down (B9)

✅ `11:47:42` Panel-initiated admin upgrade returns 503  
✅ `11:47:42` Error message references `lamaste-server reset-admin` recovery path  
✅ `11:47:42` Admin auth mode still p12 after refused upgrade  

## P12 rotation lockdown

✅ `11:47:43` P12 rotation blocked (HTTP 503)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `25` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `25` |

