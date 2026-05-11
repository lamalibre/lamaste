# Lamaste E2E: 16 — Hardware-Bound Certificate Enrollment

> Started at `2026-03-30 13:07:06 UTC`


## Pre-flight: check onboarding is complete


## Admin auth mode defaults to p12

✅ `13:07:06` Admin auth mode is p12 by default  

## Create enrollment token

✅ `13:07:06` Token creation returns ok: true  
✅ `13:07:06` Token is not empty  
✅ `13:07:06` Token has expiresAt  
✅ `13:07:06` Token response contains correct label  

## Duplicate token for same label rejected

✅ `13:07:06` Duplicate token for active label returns 409  

## Public enrollment endpoint reachable without mTLS

✅ `13:07:06` Enrollment endpoint reachable without mTLS (HTTP 400)  

## Enrollment with invalid token rejected

✅ `13:07:06` Invalid token rejected with correct message  

## Enroll agent with valid token + CSR

✅ `13:07:06` Enrollment returns ok: true  
✅ `13:07:06` Enrolled label matches  
✅ `13:07:06` Enrollment returns signed certificate  
✅ `13:07:06` Enrollment returns CA certificate  
✅ `13:07:06` Enrollment returns serial number  
✅ `13:07:06` Signed cert has correct CN  

## Token replay rejected (single-use)

✅ `13:07:06` Token replay returns 401  

## Enrolled agent visible in agent list with hardware-bound method

✅ `13:07:06` Agent shows enrollmentMethod: hardware-bound  

## P12 download hidden for hardware-bound agent

✅ `13:07:06` P12 download returns 404 for hardware-bound agent (no P12 on disk)  

## Clean up: revoke test agent

✅ `13:07:06` Revoked enrollment test agent  

## Admin upgrade to hardware-bound

✅ `13:07:07` Admin upgrade returns ok: true  
✅ `13:07:07` Admin upgrade returns signed certificate  

## P12 lockdown after admin upgrade

✅ `13:07:07` P12 rotation blocked after admin upgrade (HTTP 000000)  

## Revert admin to P12 mode (for other tests)

✅ `13:07:11` Reverted admin to P12 mode with fresh cert  
✅ `13:07:11` Admin auth mode reverted to p12  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `23` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `23` |

