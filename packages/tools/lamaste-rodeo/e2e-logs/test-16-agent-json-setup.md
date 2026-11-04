# Lamaste E2E: 16 — Agent JSON Setup Output (Three-VM)

> Started at `2026-11-04 13:35:03 UTC`


## Pre-flight: check onboarding is complete

✅ `13:35:03` Onboarding is complete  
✅ `13:35:03` lamaste-agent found on agent VM: /usr/bin/lamaste-agent  

## --json requires token

✅ `13:35:04` --json without token emits error event  

## Generate enrollment token on host

✅ `13:35:04` Enrollment token generated for json-test-3vm  

## A copy outside npm's global root refuses, keeping the token

✅ `13:35:05` Setup from a non-global copy emits an error event naming the global install  
✅ `13:35:05` Non-global setup never reached the enrollment step  
✅ `13:35:05` Non-global setup created no agent directory  
✅ `13:35:05` Enrollment token still valid after the refused setup  

## lamaste-agent setup --json on agent VM


## NDJSON line validation

✅ `13:35:09` All 29 lines are valid JSON  
✅ `13:35:09` Step events emitted: 28  

## Complete event validation

✅ `13:35:09` Exactly one complete event emitted  
✅ `13:35:09` Agent label matches: json-test-3vm  
✅ `13:35:09` Panel URL present and uses HTTPS  
✅ `13:35:09` Auth method present: p12  
✅ `13:35:09` Complete event reports bootPersistence: enabled (lingering on)  

## No sensitive data in NDJSON output

✅ `13:35:09` Enrollment token not leaked in NDJSON output  

## Step status validation

✅ `13:35:09` create_directories step present  
✅ `13:35:09` generate_keypair step present  
✅ `13:35:09` enroll_panel step present  
✅ `13:35:09` save_config step present  
✅ `13:35:09` All step events have valid status values  

## Sync timer installed by setup

✅ `13:35:09` Sync timer lamalibre-lamaste-sync-json-test-3vm.timer is active after setup  
✅ `13:35:09` Sync timer lamalibre-lamaste-sync-json-test-3vm.timer is enabled (survives reboot with lingering)  
✅ `13:35:09` Sync timer first fires 5 seconds after activation  
✅ `13:35:09` Sync timer fires 30 seconds after each run  
✅ `13:35:09` Sync service is a oneshot  
✅ `13:35:09` Sync service runs '<global lamaste-agent> sync --label json-test-3vm --quiet'  
✅ `13:35:09` Sync service logs to the agent's sync.log  

## No tunnel assigned: the chisel client stays stopped

✅ `13:35:18` sync-state.json records the agent idle (no tunnel assigned)  
✅ `13:35:18` sync-state.json records 0 tunnels  
✅ `13:35:18` sync-state.json records no sync error  
✅ `13:36:09` Chisel unit of a tunnel-less agent never started across 45 s of syncs  
✅ `13:36:09` Chisel unit of a tunnel-less agent has not been restarted (NRestarts: 0)  
✅ `13:36:09` Status Sync: line reports no tunnels assigned  

## Cleanup: uninstall test agent

✅ `13:36:10` Agent uninstalled on agent VM  
✅ `13:36:10` Sync timer stopped after uninstall (state: inactive)  
✅ `13:36:10` Sync timer unit file removed by uninstall  
✅ `13:36:10` Agent cert revoked on host  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `38` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `38` |

