# Lamaste E2E: 16 — Agent JSON Setup Output (Three-VM)

> Started at `2026-11-03 09:30:21 UTC`


## Pre-flight: check onboarding is complete

✅ `09:30:21` Onboarding is complete  
✅ `09:30:21` lamaste-agent found on agent VM: /usr/bin/lamaste-agent  

## --json requires token

✅ `09:30:21` --json without token emits error event  

## Generate enrollment token on host

✅ `09:30:21` Enrollment token generated for json-test-3vm  

## A copy outside npm's global root refuses, keeping the token

✅ `09:30:22` Setup from a non-global copy emits an error event naming the global install  
✅ `09:30:22` Non-global setup never reached the enrollment step  
✅ `09:30:22` Non-global setup created no agent directory  
✅ `09:30:22` Enrollment token still valid after the refused setup  

## lamaste-agent setup --json on agent VM


## NDJSON line validation

✅ `09:30:24` All 29 lines are valid JSON  
✅ `09:30:24` Step events emitted: 28  

## Complete event validation

✅ `09:30:24` Exactly one complete event emitted  
✅ `09:30:24` Agent label matches: json-test-3vm  
✅ `09:30:24` Panel URL present and uses HTTPS  
✅ `09:30:24` Auth method present: p12  
✅ `09:30:24` Complete event reports bootPersistence: enabled (lingering on)  

## No sensitive data in NDJSON output

✅ `09:30:24` Enrollment token not leaked in NDJSON output  

## Step status validation

✅ `09:30:24` create_directories step present  
✅ `09:30:24` generate_keypair step present  
✅ `09:30:24` enroll_panel step present  
✅ `09:30:24` save_config step present  
✅ `09:30:24` All step events have valid status values  

## Sync timer installed by setup

✅ `09:30:24` Sync timer lamalibre-lamaste-sync-json-test-3vm.timer is active after setup  
✅ `09:30:24` Sync timer lamalibre-lamaste-sync-json-test-3vm.timer is enabled (survives reboot with lingering)  
✅ `09:30:25` Sync timer first fires 5 seconds after activation  
✅ `09:30:25` Sync timer fires 30 seconds after each run  
✅ `09:30:25` Sync service is a oneshot  
✅ `09:30:25` Sync service runs '<global lamaste-agent> sync --label json-test-3vm --quiet'  
✅ `09:30:25` Sync service logs to the agent's sync.log  

## No tunnel assigned: the chisel client stays stopped

✅ `09:30:34` sync-state.json records the agent idle (no tunnel assigned)  
✅ `09:30:34` sync-state.json records 0 tunnels  
✅ `09:30:34` sync-state.json records no sync error  
✅ `09:31:21` Chisel unit of a tunnel-less agent never started across 45 s of syncs  
✅ `09:31:21` Chisel unit of a tunnel-less agent has not been restarted (NRestarts: 0)  
✅ `09:31:22` Status Sync: line reports no tunnels assigned  

## Cleanup: uninstall test agent

✅ `09:31:22` Agent uninstalled on agent VM  
✅ `09:31:22` Sync timer stopped after uninstall (state: inactive)  
✅ `09:31:22` Sync timer unit file removed by uninstall  
✅ `09:31:23` Agent cert revoked on host  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `38` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `38` |

