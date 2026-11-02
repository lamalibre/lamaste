# Lamaste E2E: 16 — Agent JSON Setup Output (Three-VM)

> Started at `2026-11-02 15:50:34 UTC`


## Pre-flight: check onboarding is complete

✅ `15:50:34` Onboarding is complete  
✅ `15:50:34` lamaste-agent found on agent VM: /usr/bin/lamaste-agent  

## --json requires token

✅ `15:50:34` --json without token emits error event  

## Generate enrollment token on host

✅ `15:50:34` Enrollment token generated for json-test-3vm  

## A copy outside npm's global root refuses, keeping the token

✅ `15:50:35` Setup from a non-global copy emits an error event naming the global install  
✅ `15:50:35` Non-global setup never reached the enrollment step  
✅ `15:50:35` Non-global setup created no agent directory  
✅ `15:50:35` Enrollment token still valid after the refused setup  

## lamaste-agent setup --json on agent VM


## NDJSON line validation

✅ `15:50:36` All 29 lines are valid JSON  
✅ `15:50:36` Step events emitted: 28  

## Complete event validation

✅ `15:50:36` Exactly one complete event emitted  
✅ `15:50:36` Agent label matches: json-test-3vm  
✅ `15:50:36` Panel URL present and uses HTTPS  
✅ `15:50:36` Auth method present: p12  
✅ `15:50:36` Complete event reports bootPersistence: enabled (lingering on)  

## No sensitive data in NDJSON output

✅ `15:50:36` Enrollment token not leaked in NDJSON output  

## Step status validation

✅ `15:50:36` create_directories step present  
✅ `15:50:36` generate_keypair step present  
✅ `15:50:36` enroll_panel step present  
✅ `15:50:36` save_config step present  
✅ `15:50:36` All step events have valid status values  

## Sync timer installed by setup

✅ `15:50:36` Sync timer lamalibre-lamaste-sync-json-test-3vm.timer is active after setup  
✅ `15:50:37` Sync timer lamalibre-lamaste-sync-json-test-3vm.timer is enabled (survives reboot with lingering)  
✅ `15:50:37` Sync timer first fires 5 seconds after activation  
✅ `15:50:37` Sync timer fires 30 seconds after each run  
✅ `15:50:37` Sync service is a oneshot  
✅ `15:50:37` Sync service runs '<global lamaste-agent> sync --label json-test-3vm --quiet'  
✅ `15:50:37` Sync service logs to the agent's sync.log  

## No tunnel assigned: the chisel client stays stopped

✅ `15:50:48` sync-state.json records the agent idle (no tunnel assigned)  
✅ `15:50:48` sync-state.json records 0 tunnels  
✅ `15:50:48` sync-state.json records no sync error  
✅ `15:51:36` Chisel unit of a tunnel-less agent never started across 45 s of syncs  
✅ `15:51:36` Chisel unit of a tunnel-less agent has not been restarted (NRestarts: 0)  
✅ `15:51:36` Status Sync: line reports no tunnels assigned  

## Cleanup: uninstall test agent

✅ `15:51:36` Agent uninstalled on agent VM  
✅ `15:51:36` Sync timer stopped after uninstall (state: inactive)  
✅ `15:51:37` Sync timer unit file removed by uninstall  
✅ `15:51:37` Agent cert revoked on host  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `38` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `38` |

