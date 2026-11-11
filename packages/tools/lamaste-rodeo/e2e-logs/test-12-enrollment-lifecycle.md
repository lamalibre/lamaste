# Lamaste E2E: 12 — Enrollment Token Lifecycle (Three-VM)

> Started at `2026-11-11 09:01:03 UTC`


## Pre-flight: check onboarding is complete

✅ `09:01:03` Onboarding is complete  

## Admin auth mode defaults to p12

✅ `09:01:03` Admin auth mode is p12  

## Create enrollment token on host

✅ `09:01:03` Token created  
✅ `09:01:03` Token value present (64 chars)  

## Public enrollment reachable from agent VM without mTLS

✅ `09:01:04` Enrollment endpoint reachable from agent VM without mTLS (HTTP 401)  

## Generate CSR on agent VM and enroll

✅ `09:01:04` Agent enrolled successfully  
✅ `09:01:04` Enrolled label matches  
✅ `09:01:04` Enrollment returns serial  

## Token replay rejected

✅ `09:01:04` Token replay rejected with 401  

## Enrolled agent in registry with hardware-bound method

✅ `09:01:05` Agent shows enrollmentMethod: hardware-bound  

## Verify lamaste-agent status shows enrolled agent

✅ `09:01:05` lamaste-agent status shows config present  
✅ `09:01:05` lamaste-agent status has a Sync: line  
✅ `09:01:05` Status Sync: line reports the timer installed  
✅ `09:01:05` Status Sync: line reports no failing sync  
✅ `09:01:05` Status Sync: line reports the timer running its program (last run under 120 s ago)  
✅ `09:01:05` Status Chisel: line shows the pinned release 1.12.0  
✅ `09:01:05` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is enabled  
✅ `09:01:05` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active  
✅ `09:01:05` Chisel unit is not running while the agent carries no tunnel (state: inactive)  
✅ `09:01:06` Agent config file exists after setup  

## Clean up: revoke test agent

✅ `09:01:06` Cleaned up test agent and temp files  

## Admin upgrade endpoint is locked down (B9)

✅ `09:01:07` Panel-initiated admin upgrade returns 503  
✅ `09:01:07` Error message references `lamaste-server reset-admin` recovery path  
✅ `09:01:08` Admin auth mode still p12 after refused upgrade  

## P12 rotation lockdown

✅ `09:01:08` P12 rotation blocked (HTTP 503)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `25` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `25` |

