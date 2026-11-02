# Lamaste E2E: 12 — Enrollment Token Lifecycle (Three-VM)

> Started at `2026-11-02 15:48:19 UTC`


## Pre-flight: check onboarding is complete

✅ `15:48:19` Onboarding is complete  

## Admin auth mode defaults to p12

✅ `15:48:19` Admin auth mode is p12  

## Create enrollment token on host

✅ `15:48:19` Token created  
✅ `15:48:20` Token value present (64 chars)  

## Public enrollment reachable from agent VM without mTLS

✅ `15:48:20` Enrollment endpoint reachable from agent VM without mTLS (HTTP 401)  

## Generate CSR on agent VM and enroll

✅ `15:48:20` Agent enrolled successfully  
✅ `15:48:20` Enrolled label matches  
✅ `15:48:20` Enrollment returns serial  

## Token replay rejected

✅ `15:48:20` Token replay rejected with 401  

## Enrolled agent in registry with hardware-bound method

✅ `15:48:20` Agent shows enrollmentMethod: hardware-bound  

## Verify lamaste-agent status shows enrolled agent

✅ `15:48:21` lamaste-agent status shows config present  
✅ `15:48:21` lamaste-agent status has a Sync: line  
✅ `15:48:21` Status Sync: line reports the timer installed  
✅ `15:48:21` Status Sync: line reports no failing sync  
✅ `15:48:21` Status Sync: line reports the timer running its program (last run under 120 s ago)  
✅ `15:48:21` Status Chisel: line shows the pinned release 1.12.0  
✅ `15:48:21` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is enabled  
✅ `15:48:21` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active  
✅ `15:48:21` Chisel unit is not running while the agent carries no tunnel (state: inactive)  
✅ `15:48:21` Agent config file exists after setup  

## Clean up: revoke test agent

✅ `15:48:22` Cleaned up test agent and temp files  

## Admin upgrade endpoint is locked down (B9)

✅ `15:48:22` Panel-initiated admin upgrade returns 503  
✅ `15:48:22` Error message references `lamaste-server reset-admin` recovery path  
✅ `15:48:22` Admin auth mode still p12 after refused upgrade  

## P12 rotation lockdown

✅ `15:48:22` P12 rotation blocked (HTTP 503)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `25` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `25` |

