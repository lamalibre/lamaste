# Lamaste E2E: 16 — Agent JSON Setup Output (Three-VM)

> Started at `2026-11-09 12:42:24 UTC`


## Pre-flight: check onboarding is complete

✅ `12:42:24` Onboarding is complete  
✅ `12:42:24` lamaste-agent found on agent VM: /usr/bin/lamaste-agent  

## --json requires token

✅ `12:42:24` --json without token emits error event  

## Generate enrollment token on host

✅ `12:42:24` Enrollment token generated for json-test-3vm  

## A copy outside npm's global root refuses, keeping the token

✅ `12:42:25` Setup from a non-global copy emits an error event naming the global install  
✅ `12:42:25` Non-global setup never reached the enrollment step  
✅ `12:42:25` Non-global setup created no agent directory  
✅ `12:42:25` Enrollment token still valid after the refused setup  

## lamaste-agent setup --json on agent VM


## NDJSON line validation

✅ `12:42:27` All 29 lines are valid JSON  
✅ `12:42:27` Step events emitted: 28  

## Complete event validation

✅ `12:42:27` Exactly one complete event emitted  
✅ `12:42:27` Agent label matches: json-test-3vm  
✅ `12:42:27` Panel URL present and uses HTTPS  
✅ `12:42:27` Auth method present: p12  
✅ `12:42:27` Complete event reports bootPersistence: enabled (lingering on)  

## No sensitive data in NDJSON output

✅ `12:42:27` Enrollment token not leaked in NDJSON output  

## Step status validation

✅ `12:42:27` create_directories step present  
✅ `12:42:27` generate_keypair step present  
✅ `12:42:27` enroll_panel step present  
✅ `12:42:27` save_config step present  
✅ `12:42:27` All step events have valid status values  

## Sync timer installed by setup

✅ `12:42:27` Sync timer lamalibre-lamaste-sync-json-test-3vm.timer is active after setup  
✅ `12:42:28` Sync timer lamalibre-lamaste-sync-json-test-3vm.timer is enabled (survives reboot with lingering)  
✅ `12:42:28` Sync timer first fires 5 seconds after activation  
✅ `12:42:28` Sync timer fires 30 seconds after each run  
✅ `12:42:28` Sync service is a oneshot  
✅ `12:42:28` Sync service runs '<global lamaste-agent> sync --label json-test-3vm --quiet'  
✅ `12:42:28` Sync service logs to the agent's sync.log  

## No tunnel assigned: the chisel client stays stopped

✅ `12:42:35` sync-state.json records the agent idle (no tunnel assigned)  
✅ `12:42:35` sync-state.json records 0 tunnels  
✅ `12:42:35` sync-state.json records no sync error  
✅ `12:43:21` Chisel unit of a tunnel-less agent never started across 45 s of syncs  
✅ `12:43:21` Chisel unit of a tunnel-less agent has not been restarted (NRestarts: 0)  
✅ `12:43:22` Status Sync: line reports no tunnels assigned  

## Cleanup: uninstall test agent

✅ `12:43:22` Agent uninstalled on agent VM  
✅ `12:43:22` Sync timer stopped after uninstall (state: inactive)  
✅ `12:43:22` Sync timer unit file removed by uninstall  
✅ `12:43:23` Agent cert revoked on host  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `38` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `38` |

