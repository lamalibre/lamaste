# Portlama E2E: 12 — Enrollment Token Lifecycle (Three-VM)

> Started at `2026-03-26 10:50:54 UTC`


## Pre-flight: check onboarding is complete

✅ `10:50:55` Onboarding is complete  

## Admin auth mode defaults to p12

✅ `10:50:55` Admin auth mode is p12  

## Create enrollment token on host

✅ `10:50:55` Token created  
✅ `10:50:55` Token value present (64 chars)  

## Public enrollment reachable from agent VM without mTLS

✅ `10:50:55` Enrollment endpoint reachable from agent VM without mTLS (HTTP 401)  

## Generate CSR on agent VM and enroll

✅ `10:50:55` Agent enrolled successfully  
✅ `10:50:55` Enrolled label matches  
✅ `10:50:55` Enrollment returns serial  

## Token replay rejected

✅ `10:50:55` Token replay rejected with 401  

## Enrolled agent in registry with hardware-bound method

✅ `10:50:56` Agent shows enrollmentMethod: hardware-bound  

## Verify portlama-agent status shows enrolled agent

✅ `10:50:56` portlama-agent status shows config present  
✅ `10:50:56` systemd service portlama-chisel is enabled  
✅ `10:50:56` Agent config file exists after setup  

## Clean up: revoke test agent

✅ `10:50:56` Cleaned up test agent and temp files  

## Admin upgrade to hardware-bound

✅ `10:50:57` Admin upgrade to hardware-bound succeeded  

## P12 lockdown: rotate returns 410

✅ `10:50:57` P12 rotation blocked — old admin cert revoked during upgrade (HTTP 000000)  

## Revert admin auth mode for subsequent tests

✅ `10:50:58` Reverted adminAuthMode to p12  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `10:50:58` **Running: 13-panel-2fa.sh**  
