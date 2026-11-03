# Lamaste E2E: 30 — Agent Sync Timer (Three-VM)

> Started at `2026-11-03 09:34:01 UTC`


## Pre-flight: onboarding complete, sync timer running

✅ `09:34:02` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active  
✅ `09:34:02` Fresh setup recorded chiselCredentialSealedAt  

## A tunnel assigned on the panel is carried by the timer

✅ `09:34:05` Tunnel e2esync30 created for test-agent  
✅ `09:34:39` Tunnel carried within 60 seconds with no lamaste-agent update  
✅ `09:34:39` sync-state.json records the tunnel client running  
✅ `09:34:39` sync-state.json records no error  
✅ `09:34:39` sync-state.json records 1 carried tunnel(s)  
✅ `09:34:39` sync.log records the change it applied  
✅ `09:34:39` sync.log records no failure  
✅ `09:34:40` lamaste-agent status reports the timer's last successful run  
✅ `09:34:40` lamaste-agent status reports the carried tunnel count  
✅ `09:34:40` Manual lamaste-agent sync exits 0  
✅ `09:34:40` Manual lamaste-agent sync reports the carried tunnels  
✅ `09:34:40` Manual sync with nothing to change did not restart the client  
✅ `09:34:40` Chisel client PID unchanged by a no-op sync  

## Agent daemon: stop is respected by the timer

✅ `09:34:43` Agent daemon is running on port 9393  
✅ `09:34:43` POST /api/stop on the agent daemon returns 200  
✅ `09:34:44` Stop is persisted in the agent config (tunnelsStopped: true)  
✅ `09:35:31` Tunnel client stayed stopped for 45 seconds of sync runs after agentd /stop  
✅ `09:35:31` sync-state.json records the tunnels stopped by the operator  
✅ `09:35:31` lamaste-agent status reports the tunnels stopped by the operator  
✅ `09:35:31` POST /api/start on the agent daemon returns 200  
✅ `09:35:32` Start converges the client back to running  
✅ `09:35:32` Start clears tunnelsStopped from the agent config  
✅ `09:35:32` Tunnel serves again after agentd /start  
✅ `09:35:32` Syncs never rotate a sealed credential  

## An upgraded agent rotates its chisel credential once

✅ `09:35:32` Agent config no longer marks the credential sealed (simulated upgrade)  
✅ `09:35:42` The next sync rotated the credential and sealed it (within 60 seconds)  
✅ `09:35:42` sync.log records exactly one credential rotation  
✅ `09:35:42` The panel issued a new credential (chiselCredentialIssuedAt changed)  
✅ `09:35:42` chisel.env now holds the rotated credential  
✅ `09:35:42` chisel.env is still mode 600  
✅ `09:35:42` Tunnel serves with the rotated credential  
✅ `09:36:12` The sync timer ran again after the rotation (lastRunAt advanced)  
✅ `09:36:12` No further rotation after the credential was sealed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `35` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `35` |

ℹ️ `09:36:12` Cleaning up test resources...  
