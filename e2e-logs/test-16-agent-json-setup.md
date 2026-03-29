# Portlama E2E: 16 — Agent JSON Setup Output (Three-VM)

> Started at `2026-03-29 09:13:42 UTC`


## Pre-flight: check onboarding is complete

✅ `09:13:42` Onboarding is complete  
✅ `09:13:42` portlama-agent found on agent VM: /usr/bin/portlama-agent  

## --json requires token

✅ `09:13:43` --json without token emits error event  

## Generate enrollment token on host

✅ `09:13:43` Enrollment token generated for json-test-3vm  

## portlama-agent setup --json on agent VM


## NDJSON line validation

✅ `09:13:44` All 26 lines are valid JSON  
✅ `09:13:44` Step events emitted: 25  

## Complete event validation

✅ `09:13:44` Exactly one complete event emitted  
✅ `09:13:44` Agent label matches: json-test-3vm  
✅ `09:13:44` Panel URL present and uses HTTPS  
✅ `09:13:44` Auth method present: p12  

## No sensitive data in NDJSON output

✅ `09:13:44` Enrollment token not leaked in NDJSON output  

## Step status validation

✅ `09:13:44` create_directories step present  
✅ `09:13:44` generate_keypair step present  
✅ `09:13:44` enroll_panel step present  
✅ `09:13:44` save_config step present  
✅ `09:13:44` All step events have valid status values  

## Cleanup: uninstall test agent

