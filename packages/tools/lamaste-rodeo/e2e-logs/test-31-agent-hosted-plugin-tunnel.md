# Lamaste E2E: 31 — Agent-hosted plugin through the internal tunnel (Three-VM)

> Started at `2026-11-09 12:48:12 UTC`


## Pre-flight

✅ `12:48:12` Onboarding is complete  
✅ `12:48:12` Agent test-agent is enrolled on the host  
✅ `12:48:12` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
ℹ️ `12:48:13` Agent VM's @lamalibre/lamaste: /usr/lib/node_modules/@lamalibre/lamaste-agent/node_modules/@lamalibre/lamaste  

## Install, enable, host on test-agent

✅ `12:48:17` Stand-in registry is up on the host VM  
✅ `12:48:21` Fixture installed as agent-hosted  
✅ `12:48:21` Plugin enabled  
✅ `12:48:22` Hosting on test-agent started as an operation  
✅ `12:48:22` Port 21000 assigned from the internal range  

## The agent's sync timer fetches and acknowledges the plugin config

✅ `12:48:57` Plugin config file appeared on the agent VM within 90 seconds  
✅ `12:48:57` The file names the plugin  
✅ `12:48:57` The file carries the assigned port  
✅ `12:48:58` The file is 0600  
✅ `12:48:58` The agent acknowledged the secret  
✅ `12:48:58` The host records the acknowledgement  
✅ `12:48:58` sync.log records the fetch  

## Forwarding through the internal tunnel

✅ `12:48:58` Agent half listens on the agent VM's 127.0.0.1:21000  
✅ `12:48:58` The host's loopback port 21000 reaches the agent half through chisel  
✅ `12:49:02` The hosting operation succeeded once the agent half answered through the tunnel  
✅ `12:49:02` The hosting is active  
✅ `12:49:02` GET /api/e2e-app-plugin/ping reaches the agent half across VMs  
✅ `12:49:02` The caller assertion names the admin  
✅ `12:49:02` No cookie crosses the tunnel  
✅ `12:49:02` The admin bundle comes from the agent half  
✅ `12:49:02` The user surface is out of the forwarder's reach: 401 without a relay assertion  
✅ `12:49:15` Health is up  

## Secret rotation across the tunnel

✅ `12:49:15` Rotation pending  
✅ `12:49:16` Calls keep working while the rotation is pending  
✅ `12:49:32` The sync timer fetched and acknowledged the new secret within 90 seconds  
✅ `12:49:32` The agent's file carries the new secret  
✅ `12:49:32` sync.log records the rotation's fetch as well  
✅ `12:49:32` Calls work on the new secret  

## Health: application down

✅ `12:49:33` A stopped agent half behind a live tunnel is a 502  
✅ `12:49:56` Health reports down within 60 seconds  
✅ `12:49:56` The tunnel is up, the application is down: reason app  
✅ `12:50:16` Health is up again with the agent half back  

## Health: tunnel down

✅ `12:50:16` The agent's tunnel client is stopped  
✅ `12:50:45` Health reports down within 75 seconds  
✅ `12:50:46` Nothing listens on the relay port: reason tunnel  
✅ `12:50:46` The forwarder answers 502 with reason tunnel  
✅ `12:51:06` Health is up again once the tunnel client runs  

## Clear the hosting

✅ `12:51:06` Hosting removed  
✅ `12:51:06` The internal tunnel is gone  
✅ `12:51:29` The sync timer removed the agent's plugin config file  
✅ `12:51:29` sync.log records the removal  
✅ `12:51:29` The relay port no longer reaches the agent half  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `45` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `45` |

ℹ️ `12:51:29` Cleaning up test resources...  
