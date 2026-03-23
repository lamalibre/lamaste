# Portlama E2E: 16 — Hardware-Bound Certificate Enrollment

> Started at `2026-03-23 12:09:46 UTC`


## Pre-flight: check onboarding is complete


## Admin auth mode defaults to p12

✅ `12:09:46` Admin auth mode is p12 by default  

## Create enrollment token

✅ `12:09:46` Token creation returns ok: true  
✅ `12:09:46` Token is not empty  
✅ `12:09:46` Token has expiresAt  
✅ `12:09:46` Token response contains correct label  

## Duplicate token for same label rejected

✅ `12:09:46` Duplicate token for active label returns 409  

## Public enrollment endpoint reachable without mTLS

✅ `12:09:46` Enrollment endpoint reachable without mTLS (HTTP 400)  

## Enrollment with invalid token rejected

✅ `12:09:46` Invalid token rejected with correct message  

## Enroll agent with valid token + CSR

✅ `12:09:46` Enrollment returns ok: true  
✅ `12:09:46` Enrolled label matches  
✅ `12:09:46` Enrollment returns signed certificate  
✅ `12:09:46` Enrollment returns CA certificate  
✅ `12:09:46` Enrollment returns serial number  
✅ `12:09:46` Signed cert has correct CN  

## Token replay rejected (single-use)

✅ `12:09:46` Token replay returns 401  

## Enrolled agent visible in agent list with hardware-bound method

✅ `12:09:46` Agent shows enrollmentMethod: hardware-bound  

## P12 download hidden for hardware-bound agent

✅ `12:09:46` P12 download returns 404 for hardware-bound agent (no P12 on disk)  

## Clean up: revoke test agent

✅ `12:09:46` Revoked enrollment test agent  

## Admin upgrade to hardware-bound

✅ `12:09:46` Admin upgrade returns ok: true  
✅ `12:09:46` Admin upgrade returns signed certificate  

## P12 lockdown after admin upgrade

✅ `12:09:47` P12 rotation blocked after admin upgrade (HTTP 000000)  

## Revert admin to P12 mode (for other tests)

✅ `12:09:51` Reverted admin to P12 mode with fresh cert  
✅ `12:09:51` Admin auth mode reverted to p12  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `23` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `23` |

