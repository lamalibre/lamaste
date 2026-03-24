# Portlama E2E: 16 — Hardware-Bound Certificate Enrollment

> Started at `2026-03-24 08:11:13 UTC`


## Pre-flight: check onboarding is complete


## Admin auth mode defaults to p12

✅ `08:11:13` Admin auth mode is p12 by default  

## Create enrollment token

✅ `08:11:13` Token creation returns ok: true  
✅ `08:11:13` Token is not empty  
✅ `08:11:13` Token has expiresAt  
✅ `08:11:13` Token response contains correct label  

## Duplicate token for same label rejected

✅ `08:11:13` Duplicate token for active label returns 409  

## Public enrollment endpoint reachable without mTLS

✅ `08:11:13` Enrollment endpoint reachable without mTLS (HTTP 400)  

## Enrollment with invalid token rejected

✅ `08:11:13` Invalid token rejected with correct message  

## Enroll agent with valid token + CSR

✅ `08:11:13` Enrollment returns ok: true  
✅ `08:11:13` Enrolled label matches  
✅ `08:11:13` Enrollment returns signed certificate  
✅ `08:11:13` Enrollment returns CA certificate  
✅ `08:11:13` Enrollment returns serial number  
✅ `08:11:13` Signed cert has correct CN  

## Token replay rejected (single-use)

✅ `08:11:13` Token replay returns 401  

## Enrolled agent visible in agent list with hardware-bound method

✅ `08:11:13` Agent shows enrollmentMethod: hardware-bound  

## P12 download hidden for hardware-bound agent

✅ `08:11:13` P12 download returns 404 for hardware-bound agent (no P12 on disk)  

## Clean up: revoke test agent

✅ `08:11:13` Revoked enrollment test agent  

## Admin upgrade to hardware-bound

✅ `08:11:14` Admin upgrade returns ok: true  
✅ `08:11:14` Admin upgrade returns signed certificate  

## P12 lockdown after admin upgrade

✅ `08:11:14` P12 rotation blocked after admin upgrade (HTTP 000000)  

## Revert admin to P12 mode (for other tests)

✅ `08:11:18` Reverted admin to P12 mode with fresh cert  
✅ `08:11:18` Admin auth mode reverted to p12  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `23` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `23` |

