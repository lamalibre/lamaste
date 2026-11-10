# Lamaste E2E: 16 — Agent JSON Setup Output (Three-VM)

> Started at `2026-11-10 13:04:21 UTC`


## Pre-flight: check onboarding is complete

✅ `13:04:21` Onboarding is complete  
✅ `13:04:21` lamaste-agent found on agent VM: /usr/bin/lamaste-agent  

## --json requires token

✅ `13:04:21` --json without token emits error event  

## Generate enrollment token on host

✅ `13:04:22` Enrollment token generated for json-test-3vm  

## A copy outside npm's global root refuses, keeping the token

✅ `13:04:22` Setup from a non-global copy emits an error event naming the global install  
✅ `13:04:22` Non-global setup never reached the enrollment step  
✅ `13:04:22` Non-global setup created no agent directory  
✅ `13:04:23` Enrollment token still valid after the refused setup  

## lamaste-agent setup --json on agent VM


## NDJSON line validation

✅ `13:04:25` All 29 lines are valid JSON  
✅ `13:04:25` Step events emitted: 28  

## Complete event validation

✅ `13:04:25` Exactly one complete event emitted  
✅ `13:04:25` Agent label matches: json-test-3vm  
✅ `13:04:25` Panel URL present and uses HTTPS  
✅ `13:04:25` Auth method present: p12  
✅ `13:04:25` Complete event reports bootPersistence: enabled (lingering on)  

## No sensitive data in NDJSON output

✅ `13:04:25` Enrollment token not leaked in NDJSON output  

## Step status validation

✅ `13:04:25` create_directories step present  
✅ `13:04:25` generate_keypair step present  
✅ `13:04:25` enroll_panel step present  
✅ `13:04:25` save_config step present  
✅ `13:04:25` All step events have valid status values  

## Sync timer installed by setup

✅ `13:04:26` Sync timer lamalibre-lamaste-sync-json-test-3vm.timer is active after setup  
✅ `13:04:26` Sync timer lamalibre-lamaste-sync-json-test-3vm.timer is enabled (survives reboot with lingering)  
✅ `13:04:26` Sync timer first fires 5 seconds after activation  
✅ `13:04:26` Sync timer fires 30 seconds after each run  
✅ `13:04:26` Sync service is a oneshot  
✅ `13:04:26` Sync service runs '<global lamaste-agent> sync --label json-test-3vm --quiet'  
✅ `13:04:26` Sync service logs to the agent's sync.log  

## No tunnel assigned: the chisel client stays stopped

✅ `13:04:35` sync-state.json records the agent idle (no tunnel assigned)  
✅ `13:04:35` sync-state.json records 0 tunnels  
✅ `13:04:35` sync-state.json records no sync error  
✅ `13:05:23` Chisel unit of a tunnel-less agent never started across 45 s of syncs  
✅ `13:05:23` Chisel unit of a tunnel-less agent has not been restarted (NRestarts: 0)  
✅ `13:05:23` Status Sync: line reports no tunnels assigned  

## Cleanup: uninstall test agent

✅ `13:05:24` Agent uninstalled on agent VM  
✅ `13:05:24` Sync timer stopped after uninstall (state: inactive)  
✅ `13:05:24` Sync timer unit file removed by uninstall  
✅ `13:05:24` Agent cert revoked on host  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `38` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `38` |

