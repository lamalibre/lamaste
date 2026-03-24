# Portlama E2E: 12 — Enrollment Token Lifecycle (Three-VM)

> Started at `2026-03-24 09:40:47 UTC`


## Pre-flight: check onboarding is complete

✅ `09:40:48` Onboarding is complete  

## Admin auth mode defaults to p12

✅ `09:40:48` Admin auth mode is p12  

## Create enrollment token on host

✅ `09:40:48` Token created  
✅ `09:40:48` Token value present (64 chars)  

## Public enrollment reachable from agent VM without mTLS

✅ `09:40:48` Enrollment endpoint reachable from agent VM without mTLS (HTTP 401)  

## Generate CSR on agent VM and enroll

✅ `09:40:49` Agent enrolled successfully  
✅ `09:40:49` Enrolled label matches  
✅ `09:40:49` Enrollment returns serial  

## Token replay rejected

✅ `09:40:49` Token replay rejected with 401  

## Enrolled agent in registry with hardware-bound method

✅ `09:40:49` Agent shows enrollmentMethod: hardware-bound  

## Clean up: revoke test agent

✅ `09:40:49` Cleaned up test agent and temp files  

## Admin upgrade to hardware-bound

✅ `09:40:50` Admin upgrade to hardware-bound succeeded  

## P12 lockdown: rotate returns 410

✅ `09:40:50` P12 rotation blocked — old admin cert revoked during upgrade (HTTP 000000)  

## Revert admin auth mode for subsequent tests

✅ `09:40:51` Reverted adminAuthMode to p12  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `14` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `14` |

