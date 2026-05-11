# Lamaste E2E: 16 — Agent JSON Setup Output (Three-VM)

> Started at `2026-03-30 13:12:53 UTC`


## Pre-flight: check onboarding is complete

✅ `13:12:53` Onboarding is complete  
✅ `13:12:54` lamaste-agent found on agent VM: /usr/bin/lamaste-agent  

## --json requires token

✅ `13:12:54` --json without token emits error event  

## Generate enrollment token on host

✅ `13:12:54` Enrollment token generated for json-test-3vm  

## lamaste-agent setup --json on agent VM


## NDJSON line validation

✅ `13:12:55` All 26 lines are valid JSON  
✅ `13:12:55` Step events emitted: 25  

## Complete event validation

✅ `13:12:55` Exactly one complete event emitted  
✅ `13:12:55` Agent label matches: json-test-3vm  
✅ `13:12:55` Panel URL present and uses HTTPS  
✅ `13:12:55` Auth method present: p12  

## No sensitive data in NDJSON output

✅ `13:12:55` Enrollment token not leaked in NDJSON output  

## Step status validation

✅ `13:12:55` create_directories step present  
✅ `13:12:55` generate_keypair step present  
✅ `13:12:55` enroll_panel step present  
✅ `13:12:55` save_config step present  
✅ `13:12:55` All step events have valid status values  

## Cleanup: uninstall test agent

✅ `13:12:56` Agent uninstalled on agent VM  
✅ `13:12:56` Agent cert revoked on host  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `18` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `18` |

🔵 `13:12:56` **Running: 17-identity-system.sh**  
