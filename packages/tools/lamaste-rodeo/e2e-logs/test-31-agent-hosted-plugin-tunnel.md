# Lamaste E2E: 31 — Agent-hosted plugin through the internal tunnel (Three-VM)

> Started at `2026-11-10 17:52:54 UTC`


## Pre-flight

✅ `17:52:55` Onboarding is complete  
✅ `17:52:55` Agent test-agent is enrolled on the host  
✅ `17:52:55` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
ℹ️ `17:52:55` Agent VM's @lamalibre/lamaste: /usr/lib/node_modules/@lamalibre/lamaste-agent/node_modules/@lamalibre/lamaste  

## Install, enable, host on test-agent

✅ `17:53:01` Stand-in registry is up on the host VM  
✅ `17:53:05` Fixture installed as agent-hosted  
✅ `17:53:05` Plugin enabled  
✅ `17:53:05` Hosting on test-agent started as an operation  
✅ `17:53:06` Port 21000 assigned from the internal range  

## The agent's sync timer fetches and acknowledges the plugin config

✅ `17:53:39` Plugin config file appeared on the agent VM within 90 seconds  
✅ `17:53:39` The file names the plugin  
✅ `17:53:39` The file carries the assigned port  
✅ `17:53:39` The file is 0600  
✅ `17:53:39` The agent acknowledged the secret  
✅ `17:53:39` The host records the acknowledgement  
✅ `17:53:40` sync.log records the fetch  

## Forwarding through the internal tunnel

✅ `17:53:40` Agent half listens on the agent VM's 127.0.0.1:21000  
✅ `17:53:40` The host's loopback port 21000 reaches the agent half through chisel  
✅ `17:53:43` The hosting operation succeeded once the agent half answered through the tunnel  
✅ `17:53:43` The hosting is active  
✅ `17:53:44` GET /api/e2e-app-plugin/ping reaches the agent half across VMs  
✅ `17:53:44` The caller assertion names the admin  
✅ `17:53:44` No cookie crosses the tunnel  
✅ `17:53:44` The admin bundle comes from the agent half  
✅ `17:53:44` The user surface is out of the forwarder's reach: 401 without a relay assertion  
✅ `17:53:58` Health is up  

## Secret rotation across the tunnel

✅ `17:53:58` Rotation pending  
✅ `17:53:58` Calls keep working while the rotation is pending  
✅ `17:54:12` The sync timer fetched and acknowledged the new secret within 90 seconds  
✅ `17:54:12` The agent's file carries the new secret  
✅ `17:54:12` sync.log records the rotation's fetch as well  
✅ `17:54:12` Calls work on the new secret  

## Health: application down

✅ `17:54:14` A stopped agent half behind a live tunnel is a 502  
✅ `17:54:40` Health reports down within 60 seconds  
✅ `17:54:40` The tunnel is up, the application is down: reason app  
✅ `17:54:57` Health is up again with the agent half back  

## Health: tunnel down

✅ `17:54:58` The agent's tunnel client is stopped  
✅ `17:55:28` Health reports down within 75 seconds  
✅ `17:55:28` Nothing listens on the relay port: reason tunnel  
✅ `17:55:28` The forwarder answers 502 with reason tunnel  
✅ `17:55:49` Health is up again once the tunnel client runs  

## Clear the hosting

✅ `17:55:53` Hosting removed  
✅ `17:55:53` The internal tunnel is gone  
✅ `17:56:13` The sync timer removed the agent's plugin config file  
✅ `17:56:13` sync.log records the removal  
✅ `17:56:13` The relay port no longer reaches the agent half  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `45` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `45` |

ℹ️ `17:56:13` Cleaning up test resources...  
