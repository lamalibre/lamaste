# Lamaste E2E: 30 — Agent Sync Timer (Three-VM)

> Started at `2026-11-02 15:54:30 UTC`


## Pre-flight: onboarding complete, sync timer running

✅ `15:54:31` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active  
✅ `15:54:31` Fresh setup recorded chiselCredentialSealedAt  

## A tunnel assigned on the panel is carried by the timer

✅ `15:54:34` Tunnel e2esync30 created for test-agent  
✅ `15:54:50` Tunnel carried within 60 seconds with no lamaste-agent update  
✅ `15:54:50` sync-state.json records the tunnel client running  
✅ `15:54:50` sync-state.json records no error  
✅ `15:54:50` sync-state.json records 1 carried tunnel(s)  
✅ `15:54:50` sync.log records the change it applied  
✅ `15:54:50` sync.log records no failure  
✅ `15:54:50` lamaste-agent status reports the timer's last successful run  
✅ `15:54:50` lamaste-agent status reports the carried tunnel count  
✅ `15:54:51` Manual lamaste-agent sync exits 0  
✅ `15:54:51` Manual lamaste-agent sync reports the carried tunnels  
✅ `15:54:51` Manual sync with nothing to change did not restart the client  
✅ `15:54:51` Chisel client PID unchanged by a no-op sync  

## Agent daemon: stop is respected by the timer

✅ `15:54:54` Agent daemon is running on port 9393  
✅ `15:54:54` POST /api/stop on the agent daemon returns 200  
✅ `15:54:54` Stop is persisted in the agent config (tunnelsStopped: true)  
✅ `15:55:41` Tunnel client stayed stopped for 45 seconds of sync runs after agentd /stop  
✅ `15:55:41` sync-state.json records the tunnels stopped by the operator  
✅ `15:55:42` lamaste-agent status reports the tunnels stopped by the operator  
✅ `15:55:42` POST /api/start on the agent daemon returns 200  
✅ `15:55:42` Start converges the client back to running  
✅ `15:55:42` Start clears tunnelsStopped from the agent config  
✅ `15:55:42` Tunnel serves again after agentd /start  
✅ `15:55:42` Syncs never rotate a sealed credential  

## An upgraded agent rotates its chisel credential once

✅ `15:55:43` Agent config no longer marks the credential sealed (simulated upgrade)  
✅ `15:55:50` The next sync rotated the credential and sealed it (within 60 seconds)  
✅ `15:55:50` sync.log records exactly one credential rotation  
✅ `15:55:50` The panel issued a new credential (chiselCredentialIssuedAt changed)  
✅ `15:55:50` chisel.env now holds the rotated credential  
✅ `15:55:50` chisel.env is still mode 600  
✅ `15:55:50` Tunnel serves with the rotated credential  
✅ `15:56:24` The sync timer ran again after the rotation (lastRunAt advanced)  
✅ `15:56:24` No further rotation after the credential was sealed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `35` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `35` |

ℹ️ `15:56:24` Cleaning up test resources...  
