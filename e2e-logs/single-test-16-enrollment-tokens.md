# Portlama E2E: 16 — Hardware-Bound Certificate Enrollment

> Started at `2026-03-28 16:08:50 UTC`


## Pre-flight: check onboarding is complete


## Admin auth mode defaults to p12

✅ `16:08:50` Admin auth mode is p12 by default  

## Create enrollment token

✅ `16:08:50` Token creation returns ok: true  
✅ `16:08:50` Token is not empty  
✅ `16:08:50` Token has expiresAt  
✅ `16:08:50` Token response contains correct label  

## Duplicate token for same label rejected

✅ `16:08:50` Duplicate token for active label returns 409  

## Public enrollment endpoint reachable without mTLS

✅ `16:08:50` Enrollment endpoint reachable without mTLS (HTTP 400)  

## Enrollment with invalid token rejected

✅ `16:08:50` Invalid token rejected with correct message  

## Enroll agent with valid token + CSR

✅ `16:08:50` Enrollment returns ok: true  
✅ `16:08:50` Enrolled label matches  
✅ `16:08:50` Enrollment returns signed certificate  
✅ `16:08:50` Enrollment returns CA certificate  
✅ `16:08:50` Enrollment returns serial number  
✅ `16:08:50` Signed cert has correct CN  

## Token replay rejected (single-use)

✅ `16:08:50` Token replay returns 401  

## Enrolled agent visible in agent list with hardware-bound method

✅ `16:08:50` Agent shows enrollmentMethod: hardware-bound  

## P12 download hidden for hardware-bound agent

✅ `16:08:50` P12 download returns 404 for hardware-bound agent (no P12 on disk)  

## Clean up: revoke test agent

✅ `16:08:50` Revoked enrollment test agent  

## Admin upgrade to hardware-bound

✅ `16:08:50` Admin upgrade returns ok: true  
✅ `16:08:50` Admin upgrade returns signed certificate  

## P12 lockdown after admin upgrade

✅ `16:08:50` P12 rotation blocked after admin upgrade (HTTP 000000)  

## Revert admin to P12 mode (for other tests)

✅ `16:08:54` Reverted admin to P12 mode with fresh cert  
✅ `16:08:54` Admin auth mode reverted to p12  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `23` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `23` |

