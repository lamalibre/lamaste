# Lamaste E2E: 31 — Agent-hosted plugin through the internal tunnel (Three-VM)

> Started at `2026-11-03 09:36:13 UTC`


## Pre-flight

✅ `09:36:13` Onboarding is complete  
✅ `09:36:14` Agent test-agent is enrolled on the host  
✅ `09:36:14` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
ℹ️ `09:36:14` Agent VM's @lamalibre/lamaste: /usr/lib/node_modules/@lamalibre/lamaste-agent/node_modules/@lamalibre/lamaste  

## Install, enable, host on test-agent

✅ `09:36:19` Stand-in registry is up on the host VM  
✅ `09:36:23` Fixture installed as agent-hosted  
✅ `09:36:23` Plugin enabled  
✅ `09:36:23` Hosting on test-agent started as an operation  
✅ `09:36:23` Port 21000 assigned from the internal range  

## The agent's sync timer fetches and acknowledges the plugin config

✅ `09:36:59` Plugin config file appeared on the agent VM within 90 seconds  
✅ `09:36:59` The file names the plugin  
✅ `09:36:59` The file carries the assigned port  
✅ `09:37:00` The file is 0600  
✅ `09:37:00` The agent acknowledged the secret  
✅ `09:37:00` The host records the acknowledgement  
✅ `09:37:00` sync.log records the fetch  

## Forwarding through the internal tunnel

✅ `09:37:00` Agent half listens on the agent VM's 127.0.0.1:21000  
✅ `09:37:00` The host's loopback port 21000 reaches the agent half through chisel  
✅ `09:37:04` The hosting operation succeeded once the agent half answered through the tunnel  
✅ `09:37:04` The hosting is active  
✅ `09:37:04` GET /api/e2e-app-plugin/ping reaches the agent half across VMs  
✅ `09:37:04` The caller assertion names the admin  
✅ `09:37:04` No cookie crosses the tunnel  
✅ `09:37:04` The admin bundle comes from the agent half  
✅ `09:37:04` The user surface is out of the forwarder's reach: 401 without a relay assertion  
✅ `09:37:21` Health is up  

## Secret rotation across the tunnel

✅ `09:37:21` Rotation pending  
✅ `09:37:21` Calls keep working while the rotation is pending  
✅ `09:37:34` The sync timer fetched and acknowledged the new secret within 90 seconds  
✅ `09:37:34` The agent's file carries the new secret  
✅ `09:37:34` sync.log records the rotation's fetch as well  
✅ `09:37:35` Calls work on the new secret  

## Health: application down

✅ `09:37:36` A stopped agent half behind a live tunnel is a 502  
✅ `09:37:59` Health reports down within 60 seconds  
✅ `09:37:59` The tunnel is up, the application is down: reason app  
✅ `09:38:19` Health is up again with the agent half back  

## Health: tunnel down

✅ `09:38:20` The agent's tunnel client is stopped  
✅ `09:38:49` Health reports down within 75 seconds  
✅ `09:38:49` Nothing listens on the relay port: reason tunnel  
✅ `09:38:50` The forwarder answers 502 with reason tunnel  
✅ `09:39:10` Health is up again once the tunnel client runs  

## Clear the hosting

✅ `09:39:10` Hosting removed  
✅ `09:39:11` The internal tunnel is gone  
✅ `09:39:34` The sync timer removed the agent's plugin config file  
✅ `09:39:34` sync.log records the removal  
✅ `09:39:34` The relay port no longer reaches the agent half  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `45` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `45` |

ℹ️ `09:39:34` Cleaning up test resources...  
