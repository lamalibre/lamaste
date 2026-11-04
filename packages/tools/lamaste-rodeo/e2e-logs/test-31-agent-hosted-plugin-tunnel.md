# Lamaste E2E: 31 — Agent-hosted plugin through the internal tunnel (Three-VM)

> Started at `2026-11-04 13:41:15 UTC`


## Pre-flight

✅ `13:41:15` Onboarding is complete  
✅ `13:41:15` Agent test-agent is enrolled on the host  
✅ `13:41:15` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
ℹ️ `13:41:16` Agent VM's @lamalibre/lamaste: /usr/lib/node_modules/@lamalibre/lamaste-agent/node_modules/@lamalibre/lamaste  

## Install, enable, host on test-agent

✅ `13:41:18` Stand-in registry is up on the host VM  
✅ `13:41:19` Fixture installed as agent-hosted  
✅ `13:41:19` Plugin enabled  
✅ `13:41:20` Hosting on test-agent started as an operation  
✅ `13:41:20` Port 21000 assigned from the internal range  

## The agent's sync timer fetches and acknowledges the plugin config

✅ `13:41:26` Plugin config file appeared on the agent VM within 90 seconds  
✅ `13:41:26` The file names the plugin  
✅ `13:41:27` The file carries the assigned port  
✅ `13:41:27` The file is 0600  
✅ `13:41:27` The agent acknowledged the secret  
✅ `13:41:27` The host records the acknowledgement  
✅ `13:41:27` sync.log records the fetch  

## Forwarding through the internal tunnel

✅ `13:41:27` Agent half listens on the agent VM's 127.0.0.1:21000  
✅ `13:41:27` The host's loopback port 21000 reaches the agent half through chisel  
✅ `13:41:31` The hosting operation succeeded once the agent half answered through the tunnel  
✅ `13:41:31` The hosting is active  
✅ `13:41:31` GET /api/e2e-app-plugin/ping reaches the agent half across VMs  
✅ `13:41:31` The caller assertion names the admin  
✅ `13:41:31` No cookie crosses the tunnel  
✅ `13:41:31` The admin bundle comes from the agent half  
✅ `13:41:31` The user surface is out of the forwarder's reach: 401 without a relay assertion  
✅ `13:41:48` Health is up  

## Secret rotation across the tunnel

✅ `13:41:48` Rotation pending  
✅ `13:41:48` Calls keep working while the rotation is pending  
✅ `13:41:58` The sync timer fetched and acknowledged the new secret within 90 seconds  
✅ `13:41:58` The agent's file carries the new secret  
✅ `13:41:58` sync.log records the rotation's fetch as well  
✅ `13:41:58` Calls work on the new secret  

## Health: application down

✅ `13:42:00` A stopped agent half behind a live tunnel is a 502  
✅ `13:42:28` Health reports down within 60 seconds  
✅ `13:42:28` The tunnel is up, the application is down: reason app  
✅ `13:42:48` Health is up again with the agent half back  

## Health: tunnel down

✅ `13:42:49` The agent's tunnel client is stopped  
✅ `13:43:19` Health reports down within 75 seconds  
✅ `13:43:20` Nothing listens on the relay port: reason tunnel  
✅ `13:43:21` The forwarder answers 502 with reason tunnel  
✅ `13:43:39` Health is up again once the tunnel client runs  

## Clear the hosting

✅ `13:43:39` Hosting removed  
✅ `13:43:39` The internal tunnel is gone  
✅ `13:44:05` The sync timer removed the agent's plugin config file  
✅ `13:44:06` sync.log records the removal  
✅ `13:44:08` The relay port no longer reaches the agent half  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `45` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `45` |

ℹ️ `13:44:08` Cleaning up test resources...  
