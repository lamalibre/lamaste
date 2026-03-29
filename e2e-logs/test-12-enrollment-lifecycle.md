# Portlama E2E: 12 — Enrollment Token Lifecycle (Three-VM)

> Started at `2026-03-29 09:12:36 UTC`


## Pre-flight: check onboarding is complete

✅ `09:12:36` Onboarding is complete  

## Admin auth mode defaults to p12

✅ `09:12:37` Admin auth mode is p12  

## Create enrollment token on host

✅ `09:12:37` Token created  
✅ `09:12:37` Token value present (64 chars)  

## Public enrollment reachable from agent VM without mTLS

✅ `09:12:37` Enrollment endpoint reachable from agent VM without mTLS (HTTP 401)  

## Generate CSR on agent VM and enroll

✅ `09:12:37` Agent enrolled successfully  
✅ `09:12:37` Enrolled label matches  
✅ `09:12:37` Enrollment returns serial  

## Token replay rejected

✅ `09:12:37` Token replay rejected with 401  

## Enrolled agent in registry with hardware-bound method

✅ `09:12:38` Agent shows enrollmentMethod: hardware-bound  

## Verify portlama-agent status shows enrolled agent

✅ `09:12:38` portlama-agent status shows config present  
✅ `09:12:38` systemd service portlama-chisel-e2e-agent is enabled  
✅ `09:12:38` Agent config file exists after setup  

## Clean up: revoke test agent

✅ `09:12:38` Cleaned up test agent and temp files  

## Admin upgrade to hardware-bound

✅ `09:12:39` Admin upgrade to hardware-bound succeeded  

## P12 lockdown: rotate returns 410

✅ `09:12:39` P12 rotation blocked — old admin cert revoked during upgrade (HTTP 000000)  

## Revert admin auth mode for subsequent tests

✅ `09:12:40` Reverted adminAuthMode to p12  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `09:12:40` **Running: 13-panel-2fa.sh**  
