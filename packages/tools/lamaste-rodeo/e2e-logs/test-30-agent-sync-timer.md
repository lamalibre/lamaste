# Lamaste E2E: 30 — Agent Sync Timer (Three-VM)

> Started at `2026-10-13 11:53:00 UTC`


## Pre-flight: onboarding complete, sync timer running

✅ `11:53:00` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active  
✅ `11:53:00` Fresh setup recorded chiselCredentialSealedAt  

## A tunnel assigned on the panel is carried by the timer

✅ `11:53:04` Tunnel e2esync30 created for test-agent  
✅ `11:53:36` Tunnel carried within 60 seconds with no lamaste-agent update  
✅ `11:53:36` sync-state.json records the tunnel client running  
✅ `11:53:36` sync-state.json records no error  
✅ `11:53:36` sync-state.json records 1 carried tunnel(s)  
✅ `11:53:36` sync.log records the change it applied  
✅ `11:53:36` sync.log records no failure  
✅ `11:53:36` lamaste-agent status reports the timer's last successful run  
✅ `11:53:36` lamaste-agent status reports the carried tunnel count  
✅ `11:53:37` Manual lamaste-agent sync exits 0  
✅ `11:53:37` Manual lamaste-agent sync reports the carried tunnels  
✅ `11:53:37` Manual sync with nothing to change did not restart the client  
✅ `11:53:37` Chisel client PID unchanged by a no-op sync  

## Agent daemon: stop is respected by the timer

✅ `11:53:40` Agent daemon is running on port 9393  
✅ `11:53:40` POST /api/stop on the agent daemon returns 200  
✅ `11:53:40` Stop is persisted in the agent config (tunnelsStopped: true)  
✅ `11:54:27` Tunnel client stayed stopped for 45 seconds of sync runs after agentd /stop  
✅ `11:54:28` sync-state.json records the tunnels stopped by the operator  
✅ `11:54:28` lamaste-agent status reports the tunnels stopped by the operator  
✅ `11:54:28` POST /api/start on the agent daemon returns 200  
✅ `11:54:28` Start converges the client back to running  
✅ `11:54:28` Start clears tunnelsStopped from the agent config  
✅ `11:54:28` Tunnel serves again after agentd /start  
✅ `11:54:29` Syncs never rotate a sealed credential  

## An upgraded agent rotates its chisel credential once

✅ `11:54:29` Agent config no longer marks the credential sealed (simulated upgrade)  
✅ `11:54:38` The next sync rotated the credential and sealed it (within 60 seconds)  
✅ `11:54:39` sync.log records exactly one credential rotation  
✅ `11:54:39` The panel issued a new credential (chiselCredentialIssuedAt changed)  
✅ `11:54:39` chisel.env now holds the rotated credential  
✅ `11:54:39` chisel.env is still mode 600  
✅ `11:54:39` Tunnel serves with the rotated credential  
✅ `11:55:11` The sync timer ran again after the rotation (lastRunAt advanced)  
✅ `11:55:11` No further rotation after the credential was sealed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `35` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `35` |

ℹ️ `11:55:11` Cleaning up test resources...  
