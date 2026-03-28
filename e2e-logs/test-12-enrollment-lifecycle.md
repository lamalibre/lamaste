# Portlama E2E: 12 — Enrollment Token Lifecycle (Three-VM)

> Started at `2026-03-28 16:12:23 UTC`


## Pre-flight: check onboarding is complete

✅ `16:12:23` Onboarding is complete  

## Admin auth mode defaults to p12

✅ `16:12:23` Admin auth mode is p12  

## Create enrollment token on host

✅ `16:12:23` Token created  
✅ `16:12:23` Token value present (64 chars)  

## Public enrollment reachable from agent VM without mTLS

✅ `16:12:24` Enrollment endpoint reachable from agent VM without mTLS (HTTP 401)  

## Generate CSR on agent VM and enroll

✅ `16:12:24` Agent enrolled successfully  
✅ `16:12:24` Enrolled label matches  
✅ `16:12:24` Enrollment returns serial  

## Token replay rejected

✅ `16:12:24` Token replay rejected with 401  

## Enrolled agent in registry with hardware-bound method

✅ `16:12:24` Agent shows enrollmentMethod: hardware-bound  

## Verify portlama-agent status shows enrolled agent

✅ `16:12:24` portlama-agent status shows config present  
✅ `16:12:25` systemd service portlama-chisel-e2e-agent is enabled  
✅ `16:12:25` Agent config file exists after setup  

## Clean up: revoke test agent

✅ `16:12:25` Cleaned up test agent and temp files  

## Admin upgrade to hardware-bound

✅ `16:12:26` Admin upgrade to hardware-bound succeeded  

## P12 lockdown: rotate returns 410

✅ `16:12:26` P12 rotation blocked — old admin cert revoked during upgrade (HTTP 000000)  

## Revert admin auth mode for subsequent tests

✅ `16:12:27` Reverted adminAuthMode to p12  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `16:12:27` **Running: 13-panel-2fa.sh**  
