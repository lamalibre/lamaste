# Lamaste E2E: 16 — Agent JSON Setup Output (Three-VM)

> Started at `2026-04-30 09:02:18 UTC`


## Pre-flight: check onboarding is complete

✅ `09:02:18` Onboarding is complete  
✅ `09:02:18` lamaste-agent found on agent VM: /usr/bin/lamaste-agent  

## --json requires token

✅ `09:02:18` --json without token emits error event  

## Generate enrollment token on host

✅ `09:02:18` Enrollment token generated for json-test-3vm  

## lamaste-agent setup --json on agent VM


## NDJSON line validation

✅ `09:02:20` All 30 lines are valid JSON  
✅ `09:02:20` Step events emitted: 29  

## Complete event validation

✅ `09:02:20` Exactly one complete event emitted  
✅ `09:02:20` Agent label matches: json-test-3vm  
✅ `09:02:20` Panel URL present and uses HTTPS  
✅ `09:02:20` Auth method present: p12  

## No sensitive data in NDJSON output

✅ `09:02:20` Enrollment token not leaked in NDJSON output  

## Step status validation

✅ `09:02:20` create_directories step present  
✅ `09:02:20` generate_keypair step present  
✅ `09:02:20` enroll_panel step present  
✅ `09:02:20` save_config step present  
✅ `09:02:20` All step events have valid status values  

## Cleanup: uninstall test agent

✅ `09:02:20` Agent uninstalled on agent VM  
✅ `09:02:20` Agent cert revoked on host  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `18` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `18` |

