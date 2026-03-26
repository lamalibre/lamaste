# Portlama E2E: 16 — Hardware-Bound Certificate Enrollment

> Started at `2026-03-26 10:46:56 UTC`


## Pre-flight: check onboarding is complete


## Admin auth mode defaults to p12

✅ `10:46:56` Admin auth mode is p12 by default  

## Create enrollment token

✅ `10:46:56` Token creation returns ok: true  
✅ `10:46:56` Token is not empty  
✅ `10:46:56` Token has expiresAt  
✅ `10:46:56` Token response contains correct label  

## Duplicate token for same label rejected

✅ `10:46:56` Duplicate token for active label returns 409  

## Public enrollment endpoint reachable without mTLS

✅ `10:46:56` Enrollment endpoint reachable without mTLS (HTTP 400)  

## Enrollment with invalid token rejected

✅ `10:46:56` Invalid token rejected with correct message  

## Enroll agent with valid token + CSR

✅ `10:46:57` Enrollment returns ok: true  
✅ `10:46:57` Enrolled label matches  
✅ `10:46:57` Enrollment returns signed certificate  
✅ `10:46:57` Enrollment returns CA certificate  
✅ `10:46:57` Enrollment returns serial number  
✅ `10:46:57` Signed cert has correct CN  

## Token replay rejected (single-use)

✅ `10:46:57` Token replay returns 401  

## Enrolled agent visible in agent list with hardware-bound method

✅ `10:46:57` Agent shows enrollmentMethod: hardware-bound  

## P12 download hidden for hardware-bound agent

✅ `10:46:57` P12 download returns 404 for hardware-bound agent (no P12 on disk)  

## Clean up: revoke test agent

✅ `10:46:57` Revoked enrollment test agent  

## Admin upgrade to hardware-bound

✅ `10:46:57` Admin upgrade returns ok: true  
✅ `10:46:57` Admin upgrade returns signed certificate  

## P12 lockdown after admin upgrade

✅ `10:46:57` P12 rotation blocked after admin upgrade (HTTP 000000)  

## Revert admin to P12 mode (for other tests)

✅ `10:47:01` Reverted admin to P12 mode with fresh cert  
✅ `10:47:01` Admin auth mode reverted to p12  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `23` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `23` |

