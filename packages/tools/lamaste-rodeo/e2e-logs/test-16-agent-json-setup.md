# Lamaste E2E: 16 — Agent JSON Setup Output (Three-VM)

> Started at `2026-10-13 11:49:54 UTC`


## Pre-flight: check onboarding is complete

✅ `11:49:54` Onboarding is complete  
✅ `11:49:54` lamaste-agent found on agent VM: /usr/bin/lamaste-agent  

## --json requires token

✅ `11:49:55` --json without token emits error event  

## Generate enrollment token on host

✅ `11:49:55` Enrollment token generated for json-test-3vm  

## A copy outside npm's global root refuses, keeping the token

✅ `11:49:55` Setup from a non-global copy emits an error event naming the global install  
✅ `11:49:56` Non-global setup never reached the enrollment step  
✅ `11:49:56` Non-global setup created no agent directory  
✅ `11:49:56` Enrollment token still valid after the refused setup  

## lamaste-agent setup --json on agent VM


## NDJSON line validation

✅ `11:49:59` All 29 lines are valid JSON  
✅ `11:49:59` Step events emitted: 28  

## Complete event validation

✅ `11:49:59` Exactly one complete event emitted  
✅ `11:49:59` Agent label matches: json-test-3vm  
✅ `11:49:59` Panel URL present and uses HTTPS  
✅ `11:49:59` Auth method present: p12  
✅ `11:49:59` Complete event reports bootPersistence: enabled (lingering on)  

## No sensitive data in NDJSON output

✅ `11:49:59` Enrollment token not leaked in NDJSON output  

## Step status validation

✅ `11:49:59` create_directories step present  
✅ `11:49:59` generate_keypair step present  
✅ `11:49:59` enroll_panel step present  
✅ `11:49:59` save_config step present  
✅ `11:49:59` All step events have valid status values  

## Sync timer installed by setup

✅ `11:49:59` Sync timer lamalibre-lamaste-sync-json-test-3vm.timer is active after setup  
✅ `11:50:00` Sync timer lamalibre-lamaste-sync-json-test-3vm.timer is enabled (survives reboot with lingering)  
✅ `11:50:00` Sync timer first fires 5 seconds after activation  
✅ `11:50:00` Sync timer fires 30 seconds after each run  
✅ `11:50:00` Sync service is a oneshot  
✅ `11:50:00` Sync service runs '<global lamaste-agent> sync --label json-test-3vm --quiet'  
✅ `11:50:00` Sync service logs to the agent's sync.log  

## No tunnel assigned: the chisel client stays stopped

✅ `11:50:09` sync-state.json records the agent idle (no tunnel assigned)  
✅ `11:50:09` sync-state.json records 0 tunnels  
✅ `11:50:09` sync-state.json records no sync error  
✅ `11:50:56` Chisel unit of a tunnel-less agent never started across 45 s of syncs  
✅ `11:50:57` Chisel unit of a tunnel-less agent has not been restarted (NRestarts: 0)  
✅ `11:50:57` Status Sync: line reports no tunnels assigned  

## Cleanup: uninstall test agent

✅ `11:50:57` Agent uninstalled on agent VM  
✅ `11:50:57` Sync timer stopped after uninstall (state: inactive)  
✅ `11:50:57` Sync timer unit file removed by uninstall  
✅ `11:50:58` Agent cert revoked on host  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `38` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `38` |

