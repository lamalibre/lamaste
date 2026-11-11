# Lamaste E2E: 12 — Enrollment Token Lifecycle (Three-VM)

> Started at `2026-11-10 17:45:06 UTC`


## Pre-flight: check onboarding is complete

✅ `17:45:06` Onboarding is complete  

## Admin auth mode defaults to p12

✅ `17:45:06` Admin auth mode is p12  

## Create enrollment token on host

✅ `17:45:06` Token created  
✅ `17:45:06` Token value present (64 chars)  

## Public enrollment reachable from agent VM without mTLS

✅ `17:45:06` Enrollment endpoint reachable from agent VM without mTLS (HTTP 401)  

## Generate CSR on agent VM and enroll

✅ `17:45:07` Agent enrolled successfully  
✅ `17:45:07` Enrolled label matches  
✅ `17:45:07` Enrollment returns serial  

## Token replay rejected

✅ `17:45:07` Token replay rejected with 401  

## Enrolled agent in registry with hardware-bound method

✅ `17:45:08` Agent shows enrollmentMethod: hardware-bound  

## Verify lamaste-agent status shows enrolled agent

✅ `17:45:08` lamaste-agent status shows config present  
✅ `17:45:08` lamaste-agent status has a Sync: line  
✅ `17:45:08` Status Sync: line reports the timer installed  
✅ `17:45:08` Status Sync: line reports no failing sync  
✅ `17:45:08` Status Sync: line reports the timer running its program (last run under 120 s ago)  
✅ `17:45:08` Status Chisel: line shows the pinned release 1.12.0  
✅ `17:45:08` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is enabled  
✅ `17:45:08` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active  
✅ `17:45:08` Chisel unit is not running while the agent carries no tunnel (state: inactive)  
✅ `17:45:09` Agent config file exists after setup  

## Clean up: revoke test agent

✅ `17:45:09` Cleaned up test agent and temp files  

## Admin upgrade endpoint is locked down (B9)

✅ `17:45:10` Panel-initiated admin upgrade returns 503  
✅ `17:45:10` Error message references `lamaste-server reset-admin` recovery path  
✅ `17:45:10` Admin auth mode still p12 after refused upgrade  

## P12 rotation lockdown

✅ `17:45:11` P12 rotation blocked (HTTP 503)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `25` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `25` |

