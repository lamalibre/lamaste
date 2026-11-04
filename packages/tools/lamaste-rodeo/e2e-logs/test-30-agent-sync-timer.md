# Lamaste E2E: 30 — Agent Sync Timer (Three-VM)

> Started at `2026-11-04 13:39:15 UTC`


## Pre-flight: onboarding complete, sync timer running

✅ `13:39:16` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active  
✅ `13:39:16` Fresh setup recorded chiselCredentialSealedAt  

## A tunnel assigned on the panel is carried by the timer

✅ `13:39:20` Tunnel e2esync30 created for test-agent  
✅ `13:39:39` Tunnel carried within 60 seconds with no lamaste-agent update  
✅ `13:39:39` sync-state.json records the tunnel client running  
✅ `13:39:39` sync-state.json records no error  
✅ `13:39:39` sync-state.json records 1 carried tunnel(s)  
✅ `13:39:39` sync.log records the change it applied  
✅ `13:39:39` sync.log records no failure  
✅ `13:39:40` lamaste-agent status reports the timer's last successful run  
✅ `13:39:40` lamaste-agent status reports the carried tunnel count  
✅ `13:39:40` Manual lamaste-agent sync exits 0  
✅ `13:39:40` Manual lamaste-agent sync reports the carried tunnels  
✅ `13:39:40` Manual sync with nothing to change did not restart the client  
✅ `13:39:40` Chisel client PID unchanged by a no-op sync  

## Agent daemon: stop is respected by the timer

✅ `13:39:44` Agent daemon is running on port 9393  
✅ `13:39:44` POST /api/stop on the agent daemon returns 200  
✅ `13:39:44` Stop is persisted in the agent config (tunnelsStopped: true)  
✅ `13:40:31` Tunnel client stayed stopped for 45 seconds of sync runs after agentd /stop  
✅ `13:40:31` sync-state.json records the tunnels stopped by the operator  
✅ `13:40:31` lamaste-agent status reports the tunnels stopped by the operator  
✅ `13:40:31` POST /api/start on the agent daemon returns 200  
✅ `13:40:31` Start converges the client back to running  
✅ `13:40:32` Start clears tunnelsStopped from the agent config  
✅ `13:40:32` Tunnel serves again after agentd /start  
✅ `13:40:32` Syncs never rotate a sealed credential  

## An upgraded agent rotates its chisel credential once

✅ `13:40:32` Agent config no longer marks the credential sealed (simulated upgrade)  
✅ `13:40:39` The next sync rotated the credential and sealed it (within 60 seconds)  
✅ `13:40:39` sync.log records exactly one credential rotation  
✅ `13:40:40` The panel issued a new credential (chiselCredentialIssuedAt changed)  
✅ `13:40:40` chisel.env now holds the rotated credential  
✅ `13:40:40` chisel.env is still mode 600  
✅ `13:40:41` Tunnel serves with the rotated credential  
✅ `13:41:13` The sync timer ran again after the rotation (lastRunAt advanced)  
✅ `13:41:13` No further rotation after the credential was sealed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `35` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `35` |

ℹ️ `13:41:13` Cleaning up test resources...  
