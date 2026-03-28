# Portlama E2E: 16 — Hardware-Bound Certificate Enrollment

> Started at `2026-03-28 22:39:12 UTC`


## Pre-flight: check onboarding is complete


## Admin auth mode defaults to p12

✅ `22:39:12` Admin auth mode is p12 by default  

## Create enrollment token

✅ `22:39:12` Token creation returns ok: true  
✅ `22:39:12` Token is not empty  
✅ `22:39:13` Token has expiresAt  
✅ `22:39:13` Token response contains correct label  

## Duplicate token for same label rejected

✅ `22:39:13` Duplicate token for active label returns 409  

## Public enrollment endpoint reachable without mTLS

✅ `22:39:13` Enrollment endpoint reachable without mTLS (HTTP 400)  

## Enrollment with invalid token rejected

✅ `22:39:13` Invalid token rejected with correct message  

## Enroll agent with valid token + CSR

✅ `22:39:13` Enrollment returns ok: true  
✅ `22:39:13` Enrolled label matches  
✅ `22:39:13` Enrollment returns signed certificate  
✅ `22:39:13` Enrollment returns CA certificate  
✅ `22:39:13` Enrollment returns serial number  
✅ `22:39:13` Signed cert has correct CN  

## Token replay rejected (single-use)

✅ `22:39:13` Token replay returns 401  

## Enrolled agent visible in agent list with hardware-bound method

✅ `22:39:13` Agent shows enrollmentMethod: hardware-bound  

## P12 download hidden for hardware-bound agent

✅ `22:39:13` P12 download returns 404 for hardware-bound agent (no P12 on disk)  

## Clean up: revoke test agent

✅ `22:39:13` Revoked enrollment test agent  

## Admin upgrade to hardware-bound

✅ `22:39:13` Admin upgrade returns ok: true  
✅ `22:39:13` Admin upgrade returns signed certificate  

## P12 lockdown after admin upgrade

✅ `22:39:13` P12 rotation blocked after admin upgrade (HTTP 000000)  

## Revert admin to P12 mode (for other tests)

✅ `22:39:17` Reverted admin to P12 mode with fresh cert  
✅ `22:39:17` Admin auth mode reverted to p12  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `23` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `23` |

