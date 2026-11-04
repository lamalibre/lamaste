# Lamaste E2E: 12 — Enrollment Token Lifecycle (Three-VM)

> Started at `2026-11-04 13:32:40 UTC`


## Pre-flight: check onboarding is complete

✅ `13:32:41` Onboarding is complete  

## Admin auth mode defaults to p12

✅ `13:32:41` Admin auth mode is p12  

## Create enrollment token on host

✅ `13:32:41` Token created  
✅ `13:32:41` Token value present (64 chars)  

## Public enrollment reachable from agent VM without mTLS

✅ `13:32:41` Enrollment endpoint reachable from agent VM without mTLS (HTTP 401)  

## Generate CSR on agent VM and enroll

✅ `13:32:42` Agent enrolled successfully  
✅ `13:32:42` Enrolled label matches  
✅ `13:32:42` Enrollment returns serial  

## Token replay rejected

✅ `13:32:42` Token replay rejected with 401  

## Enrolled agent in registry with hardware-bound method

✅ `13:32:43` Agent shows enrollmentMethod: hardware-bound  

## Verify lamaste-agent status shows enrolled agent

✅ `13:32:43` lamaste-agent status shows config present  
✅ `13:32:43` lamaste-agent status has a Sync: line  
✅ `13:32:43` Status Sync: line reports the timer installed  
✅ `13:32:43` Status Sync: line reports no failing sync  
✅ `13:32:43` Status Sync: line reports the timer running its program (last run under 120 s ago)  
✅ `13:32:43` Status Chisel: line shows the pinned release 1.12.0  
✅ `13:32:43` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is enabled  
✅ `13:32:43` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active  
✅ `13:32:44` Chisel unit is not running while the agent carries no tunnel (state: inactive)  
✅ `13:32:44` Agent config file exists after setup  

## Clean up: revoke test agent

✅ `13:32:44` Cleaned up test agent and temp files  

## Admin upgrade endpoint is locked down (B9)

✅ `13:32:46` Panel-initiated admin upgrade returns 503  
✅ `13:32:46` Error message references `lamaste-server reset-admin` recovery path  
✅ `13:32:46` Admin auth mode still p12 after refused upgrade  

## P12 rotation lockdown

✅ `13:32:47` P12 rotation blocked (HTTP 503)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `25` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `25` |

