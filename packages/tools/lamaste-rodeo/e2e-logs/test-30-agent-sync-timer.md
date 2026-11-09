# Lamaste E2E: 30 — Agent Sync Timer (Three-VM)

> Started at `2026-11-09 12:46:05 UTC`


## Pre-flight: onboarding complete, sync timer running

✅ `12:46:05` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active  
✅ `12:46:05` Fresh setup recorded chiselCredentialSealedAt  

## A tunnel assigned on the panel is carried by the timer

✅ `12:46:09` Tunnel e2esync30 created for test-agent  
✅ `12:46:35` Tunnel carried within 60 seconds with no lamaste-agent update  
✅ `12:46:35` sync-state.json records the tunnel client running  
✅ `12:46:35` sync-state.json records no error  
✅ `12:46:35` sync-state.json records 1 carried tunnel(s)  
✅ `12:46:36` sync.log records the change it applied  
✅ `12:46:36` sync.log records no failure  
✅ `12:46:36` lamaste-agent status reports the timer's last successful run  
✅ `12:46:36` lamaste-agent status reports the carried tunnel count  
✅ `12:46:36` Manual lamaste-agent sync exits 0  
✅ `12:46:36` Manual lamaste-agent sync reports the carried tunnels  
✅ `12:46:36` Manual sync with nothing to change did not restart the client  
✅ `12:46:36` Chisel client PID unchanged by a no-op sync  

## Agent daemon: stop is respected by the timer

✅ `12:46:39` Agent daemon is running on port 9393  
✅ `12:46:40` POST /api/stop on the agent daemon returns 200  
✅ `12:46:40` Stop is persisted in the agent config (tunnelsStopped: true)  
✅ `12:47:26` Tunnel client stayed stopped for 45 seconds of sync runs after agentd /stop  
✅ `12:47:26` sync-state.json records the tunnels stopped by the operator  
✅ `12:47:26` lamaste-agent status reports the tunnels stopped by the operator  
✅ `12:47:27` POST /api/start on the agent daemon returns 200  
✅ `12:47:27` Start converges the client back to running  
✅ `12:47:27` Start clears tunnelsStopped from the agent config  
✅ `12:47:27` Tunnel serves again after agentd /start  
✅ `12:47:27` Syncs never rotate a sealed credential  

## An upgraded agent rotates its chisel credential once

✅ `12:47:28` Agent config no longer marks the credential sealed (simulated upgrade)  
✅ `12:47:34` The next sync rotated the credential and sealed it (within 60 seconds)  
✅ `12:47:34` sync.log records exactly one credential rotation  
✅ `12:47:35` The panel issued a new credential (chiselCredentialIssuedAt changed)  
✅ `12:47:35` chisel.env now holds the rotated credential  
✅ `12:47:35` chisel.env is still mode 600  
✅ `12:47:35` Tunnel serves with the rotated credential  
✅ `12:48:10` The sync timer ran again after the rotation (lastRunAt advanced)  
✅ `12:48:10` No further rotation after the credential was sealed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `35` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `35` |

ℹ️ `12:48:10` Cleaning up test resources...  
