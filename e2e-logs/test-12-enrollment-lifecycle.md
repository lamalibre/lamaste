# Portlama E2E: 12 — Enrollment Token Lifecycle (Three-VM)

> Started at `2026-03-24 08:15:20 UTC`


## Pre-flight: check onboarding is complete

✅ `08:15:20` Onboarding is complete  

## Admin auth mode defaults to p12

✅ `08:15:20` Admin auth mode is p12  

## Create enrollment token on host

✅ `08:15:20` Token created  
✅ `08:15:20` Token value present (64 chars)  

## Public enrollment reachable from agent VM without mTLS

✅ `08:15:20` Enrollment endpoint reachable from agent VM without mTLS (HTTP 401)  

## Generate CSR on agent VM and enroll

✅ `08:15:21` Agent enrolled successfully  
✅ `08:15:21` Enrolled label matches  
✅ `08:15:21` Enrollment returns serial  

## Token replay rejected

✅ `08:15:21` Token replay rejected with 401  

## Enrolled agent in registry with hardware-bound method

✅ `08:15:21` Agent shows enrollmentMethod: hardware-bound  

## Clean up: revoke test agent

✅ `08:15:21` Cleaned up test agent and temp files  

## Admin upgrade to hardware-bound

✅ `08:15:22` Admin upgrade to hardware-bound succeeded  

## P12 lockdown: rotate returns 410

✅ `08:15:22` P12 rotation blocked — old admin cert revoked during upgrade (HTTP 000000)  

## Revert admin auth mode for subsequent tests

✅ `08:15:23` Reverted adminAuthMode to p12  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `14` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `14` |

