# Lamaste E2E: 16 — Agent JSON Setup Output (Three-VM)

> Started at `2026-11-10 17:47:21 UTC`


## Pre-flight: check onboarding is complete

✅ `17:47:21` Onboarding is complete  
✅ `17:47:21` lamaste-agent found on agent VM: /usr/bin/lamaste-agent  

## --json requires token

✅ `17:47:21` --json without token emits error event  

## Generate enrollment token on host

✅ `17:47:22` Enrollment token generated for json-test-3vm  

## A copy outside npm's global root refuses, keeping the token

✅ `17:47:22` Setup from a non-global copy emits an error event naming the global install  
✅ `17:47:22` Non-global setup never reached the enrollment step  
✅ `17:47:23` Non-global setup created no agent directory  
✅ `17:47:23` Enrollment token still valid after the refused setup  

## lamaste-agent setup --json on agent VM


## NDJSON line validation

✅ `17:47:25` All 29 lines are valid JSON  
✅ `17:47:25` Step events emitted: 28  

## Complete event validation

✅ `17:47:25` Exactly one complete event emitted  
✅ `17:47:25` Agent label matches: json-test-3vm  
✅ `17:47:25` Panel URL present and uses HTTPS  
✅ `17:47:25` Auth method present: p12  
✅ `17:47:25` Complete event reports bootPersistence: enabled (lingering on)  

## No sensitive data in NDJSON output

✅ `17:47:25` Enrollment token not leaked in NDJSON output  

## Step status validation

✅ `17:47:25` create_directories step present  
✅ `17:47:25` generate_keypair step present  
✅ `17:47:25` enroll_panel step present  
✅ `17:47:25` save_config step present  
✅ `17:47:25` All step events have valid status values  

## Sync timer installed by setup

✅ `17:47:25` Sync timer lamalibre-lamaste-sync-json-test-3vm.timer is active after setup  
✅ `17:47:25` Sync timer lamalibre-lamaste-sync-json-test-3vm.timer is enabled (survives reboot with lingering)  
✅ `17:47:25` Sync timer first fires 5 seconds after activation  
✅ `17:47:25` Sync timer fires 30 seconds after each run  
✅ `17:47:26` Sync service is a oneshot  
✅ `17:47:26` Sync service runs '<global lamaste-agent> sync --label json-test-3vm --quiet'  
✅ `17:47:26` Sync service logs to the agent's sync.log  

## No tunnel assigned: the chisel client stays stopped

✅ `17:47:32` sync-state.json records the agent idle (no tunnel assigned)  
✅ `17:47:32` sync-state.json records 0 tunnels  
✅ `17:47:32` sync-state.json records no sync error  
✅ `17:48:20` Chisel unit of a tunnel-less agent never started across 45 s of syncs  
✅ `17:48:20` Chisel unit of a tunnel-less agent has not been restarted (NRestarts: 0)  
✅ `17:48:20` Status Sync: line reports no tunnels assigned  

## Cleanup: uninstall test agent

✅ `17:48:21` Agent uninstalled on agent VM  
✅ `17:48:21` Sync timer stopped after uninstall (state: inactive)  
✅ `17:48:21` Sync timer unit file removed by uninstall  
✅ `17:48:22` Agent cert revoked on host  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `38` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `38` |

