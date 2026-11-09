# Lamaste E2E: 12 — Enrollment Token Lifecycle (Three-VM)

> Started at `2026-11-09 12:39:55 UTC`


## Pre-flight: check onboarding is complete

✅ `12:39:55` Onboarding is complete  

## Admin auth mode defaults to p12

✅ `12:39:55` Admin auth mode is p12  

## Create enrollment token on host

✅ `12:39:55` Token created  
✅ `12:39:55` Token value present (64 chars)  

## Public enrollment reachable from agent VM without mTLS

✅ `12:39:56` Enrollment endpoint reachable from agent VM without mTLS (HTTP 401)  

## Generate CSR on agent VM and enroll

✅ `12:39:56` Agent enrolled successfully  
✅ `12:39:56` Enrolled label matches  
✅ `12:39:56` Enrollment returns serial  

## Token replay rejected

✅ `12:39:56` Token replay rejected with 401  

## Enrolled agent in registry with hardware-bound method

✅ `12:39:56` Agent shows enrollmentMethod: hardware-bound  

## Verify lamaste-agent status shows enrolled agent

✅ `12:39:57` lamaste-agent status shows config present  
✅ `12:39:57` lamaste-agent status has a Sync: line  
✅ `12:39:57` Status Sync: line reports the timer installed  
✅ `12:39:57` Status Sync: line reports no failing sync  
✅ `12:39:57` Status Sync: line reports the timer running its program (last run under 120 s ago)  
✅ `12:39:57` Status Chisel: line shows the pinned release 1.12.0  
✅ `12:39:57` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is enabled  
✅ `12:39:57` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active  
✅ `12:39:57` Chisel unit is not running while the agent carries no tunnel (state: inactive)  
✅ `12:39:57` Agent config file exists after setup  

## Clean up: revoke test agent

✅ `12:39:58` Cleaned up test agent and temp files  

## Admin upgrade endpoint is locked down (B9)

✅ `12:39:58` Panel-initiated admin upgrade returns 503  
✅ `12:39:58` Error message references `lamaste-server reset-admin` recovery path  
✅ `12:39:58` Admin auth mode still p12 after refused upgrade  

## P12 rotation lockdown

✅ `12:39:58` P12 rotation blocked (HTTP 503)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `25` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `25` |

