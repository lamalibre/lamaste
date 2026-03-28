# Portlama E2E: 12 — Enrollment Token Lifecycle (Three-VM)

> Started at `2026-03-28 22:43:02 UTC`


## Pre-flight: check onboarding is complete

✅ `22:43:02` Onboarding is complete  

## Admin auth mode defaults to p12

✅ `22:43:02` Admin auth mode is p12  

## Create enrollment token on host

✅ `22:43:03` Token created  
✅ `22:43:03` Token value present (64 chars)  

## Public enrollment reachable from agent VM without mTLS

✅ `22:43:03` Enrollment endpoint reachable from agent VM without mTLS (HTTP 401)  

## Generate CSR on agent VM and enroll

✅ `22:43:03` Agent enrolled successfully  
✅ `22:43:03` Enrolled label matches  
✅ `22:43:03` Enrollment returns serial  

## Token replay rejected

✅ `22:43:03` Token replay rejected with 401  

## Enrolled agent in registry with hardware-bound method

✅ `22:43:03` Agent shows enrollmentMethod: hardware-bound  

## Verify portlama-agent status shows enrolled agent

✅ `22:43:04` portlama-agent status shows config present  
✅ `22:43:04` systemd service portlama-chisel-e2e-agent is enabled  
✅ `22:43:04` Agent config file exists after setup  

## Clean up: revoke test agent

✅ `22:43:04` Cleaned up test agent and temp files  

## Admin upgrade to hardware-bound

✅ `22:43:05` Admin upgrade to hardware-bound succeeded  

## P12 lockdown: rotate returns 410

✅ `22:43:05` P12 rotation blocked — old admin cert revoked during upgrade (HTTP 000000)  

## Revert admin auth mode for subsequent tests

✅ `22:43:06` Reverted adminAuthMode to p12  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `22:43:06` **Running: 13-panel-2fa.sh**  
