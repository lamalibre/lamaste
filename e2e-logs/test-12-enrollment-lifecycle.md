# Lamaste E2E: 12 — Enrollment Token Lifecycle (Three-VM)

> Started at `2026-03-30 13:11:44 UTC`


## Pre-flight: check onboarding is complete

✅ `13:11:44` Onboarding is complete  

## Admin auth mode defaults to p12

✅ `13:11:44` Admin auth mode is p12  

## Create enrollment token on host

✅ `13:11:44` Token created  
✅ `13:11:44` Token value present (64 chars)  

## Public enrollment reachable from agent VM without mTLS

✅ `13:11:44` Enrollment endpoint reachable from agent VM without mTLS (HTTP 401)  

## Generate CSR on agent VM and enroll

✅ `13:11:45` Agent enrolled successfully  
✅ `13:11:45` Enrolled label matches  
✅ `13:11:45` Enrollment returns serial  

## Token replay rejected

✅ `13:11:45` Token replay rejected with 401  

## Enrolled agent in registry with hardware-bound method

✅ `13:11:45` Agent shows enrollmentMethod: hardware-bound  

## Verify lamaste-agent status shows enrolled agent

✅ `13:11:45` lamaste-agent status shows config present  
✅ `13:11:45` systemd service lamaste-chisel-e2e-agent is enabled  
✅ `13:11:46` Agent config file exists after setup  

## Clean up: revoke test agent

✅ `13:11:46` Cleaned up test agent and temp files  

## Admin upgrade to hardware-bound

✅ `13:11:46` Admin upgrade to hardware-bound succeeded  

## P12 lockdown: rotate returns 410

✅ `13:11:46` P12 rotation blocked — old admin cert revoked during upgrade (HTTP 000000)  

## Revert admin auth mode for subsequent tests

✅ `13:11:48` Reverted adminAuthMode to p12  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `13:11:48` **Running: 13-panel-2fa.sh**  
