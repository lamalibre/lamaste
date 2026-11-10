# Lamaste E2E: 30 — Agent Sync Timer (Three-VM)

> Started at `2026-11-10 17:51:09 UTC`


## Pre-flight: onboarding complete, sync timer running

✅ `17:51:09` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active  
✅ `17:51:09` Fresh setup recorded chiselCredentialSealedAt  

## A tunnel assigned on the panel is carried by the timer

✅ `17:51:13` Tunnel e2esync30 created for test-agent  
✅ `17:51:17` Tunnel carried within 60 seconds with no lamaste-agent update  
✅ `17:51:17` sync-state.json records the tunnel client running  
✅ `17:51:17` sync-state.json records no error  
✅ `17:51:17` sync-state.json records 1 carried tunnel(s)  
✅ `17:51:17` sync.log records the change it applied  
✅ `17:51:17` sync.log records no failure  
✅ `17:51:18` lamaste-agent status reports the timer's last successful run  
✅ `17:51:18` lamaste-agent status reports the carried tunnel count  
✅ `17:51:18` Manual lamaste-agent sync exits 0  
✅ `17:51:18` Manual lamaste-agent sync reports the carried tunnels  
✅ `17:51:18` Manual sync with nothing to change did not restart the client  
✅ `17:51:18` Chisel client PID unchanged by a no-op sync  

## Agent daemon: stop is respected by the timer

✅ `17:51:22` Agent daemon is running on port 9393  
✅ `17:51:22` POST /api/stop on the agent daemon returns 200  
✅ `17:51:22` Stop is persisted in the agent config (tunnelsStopped: true)  
✅ `17:52:07` Tunnel client stayed stopped for 45 seconds of sync runs after agentd /stop  
✅ `17:52:07` sync-state.json records the tunnels stopped by the operator  
✅ `17:52:08` lamaste-agent status reports the tunnels stopped by the operator  
✅ `17:52:08` POST /api/start on the agent daemon returns 200  
✅ `17:52:08` Start converges the client back to running  
✅ `17:52:08` Start clears tunnelsStopped from the agent config  
✅ `17:52:08` Tunnel serves again after agentd /start  
✅ `17:52:08` Syncs never rotate a sealed credential  

## An upgraded agent rotates its chisel credential once

✅ `17:52:09` Agent config no longer marks the credential sealed (simulated upgrade)  
✅ `17:52:19` The next sync rotated the credential and sealed it (within 60 seconds)  
✅ `17:52:19` sync.log records exactly one credential rotation  
✅ `17:52:19` The panel issued a new credential (chiselCredentialIssuedAt changed)  
✅ `17:52:19` chisel.env now holds the rotated credential  
✅ `17:52:19` chisel.env is still mode 600  
✅ `17:52:19` Tunnel serves with the rotated credential  
✅ `17:52:52` The sync timer ran again after the rotation (lastRunAt advanced)  
✅ `17:52:52` No further rotation after the credential was sealed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `35` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `35` |

ℹ️ `17:52:52` Cleaning up test resources...  
