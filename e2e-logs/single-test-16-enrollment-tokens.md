# Portlama E2E: 16 — Hardware-Bound Certificate Enrollment

> Started at `2026-03-24 09:38:06 UTC`


## Pre-flight: check onboarding is complete


## Admin auth mode defaults to p12

✅ `09:38:06` Admin auth mode is p12 by default  

## Create enrollment token

✅ `09:38:06` Token creation returns ok: true  
✅ `09:38:06` Token is not empty  
✅ `09:38:06` Token has expiresAt  
✅ `09:38:06` Token response contains correct label  

## Duplicate token for same label rejected

✅ `09:38:06` Duplicate token for active label returns 409  

## Public enrollment endpoint reachable without mTLS

✅ `09:38:06` Enrollment endpoint reachable without mTLS (HTTP 400)  

## Enrollment with invalid token rejected

✅ `09:38:06` Invalid token rejected with correct message  

## Enroll agent with valid token + CSR

✅ `09:38:06` Enrollment returns ok: true  
✅ `09:38:06` Enrolled label matches  
✅ `09:38:06` Enrollment returns signed certificate  
✅ `09:38:06` Enrollment returns CA certificate  
✅ `09:38:06` Enrollment returns serial number  
✅ `09:38:06` Signed cert has correct CN  

## Token replay rejected (single-use)

✅ `09:38:06` Token replay returns 401  

## Enrolled agent visible in agent list with hardware-bound method

✅ `09:38:06` Agent shows enrollmentMethod: hardware-bound  

## P12 download hidden for hardware-bound agent

✅ `09:38:06` P12 download returns 404 for hardware-bound agent (no P12 on disk)  

## Clean up: revoke test agent

✅ `09:38:06` Revoked enrollment test agent  

## Admin upgrade to hardware-bound

✅ `09:38:06` Admin upgrade returns ok: true  
✅ `09:38:06` Admin upgrade returns signed certificate  

## P12 lockdown after admin upgrade

✅ `09:38:06` P12 rotation blocked after admin upgrade (HTTP 000000)  

## Revert admin to P12 mode (for other tests)

✅ `09:38:10` Reverted admin to P12 mode with fresh cert  
✅ `09:38:10` Admin auth mode reverted to p12  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `23` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `23` |

