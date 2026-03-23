# Portlama E2E: 12 — Enrollment Token Lifecycle (Three-VM)

> Started at `2026-03-23 12:14:13 UTC`


## Pre-flight: check onboarding is complete

✅ `12:14:13` Onboarding is complete  

## Admin auth mode defaults to p12

✅ `12:14:13` Admin auth mode is p12  

## Create enrollment token on host

✅ `12:14:13` Token created  
✅ `12:14:13` Token value present (64 chars)  

## Public enrollment reachable from agent VM without mTLS

✅ `12:14:13` Enrollment endpoint reachable from agent VM without mTLS (HTTP 401)  

## Generate CSR on agent VM and enroll

✅ `12:14:14` Agent enrolled successfully  
✅ `12:14:14` Enrolled label matches  
✅ `12:14:14` Enrollment returns serial  

## Token replay rejected

✅ `12:14:14` Token replay rejected with 401  

## Enrolled agent in registry with hardware-bound method

✅ `12:14:14` Agent shows enrollmentMethod: hardware-bound  

## Clean up: revoke test agent

✅ `12:14:15` Cleaned up test agent and temp files  

## Admin upgrade to hardware-bound

✅ `12:14:15` Admin upgrade to hardware-bound succeeded  

## P12 lockdown: rotate returns 410

✅ `12:14:15` P12 rotation blocked — old admin cert revoked during upgrade (HTTP 000000)  

## Revert admin auth mode for subsequent tests

✅ `12:14:17` Reverted adminAuthMode to p12  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `14` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `14` |

