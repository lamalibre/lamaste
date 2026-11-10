# Lamaste E2E: 31 — Agent-hosted plugin through the internal tunnel (Three-VM)

> Started at `2026-11-10 07:55:57 UTC`


## Pre-flight

✅ `07:55:57` Onboarding is complete  
✅ `07:55:58` Agent test-agent is enrolled on the host  
✅ `07:55:58` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
ℹ️ `07:55:58` Agent VM's @lamalibre/lamaste: /usr/lib/node_modules/@lamalibre/lamaste-agent/node_modules/@lamalibre/lamaste  

## Install, enable, host on test-agent

✅ `07:56:03` Stand-in registry is up on the host VM  
✅ `07:56:07` Fixture installed as agent-hosted  
✅ `07:56:07` Plugin enabled  
✅ `07:56:07` Hosting on test-agent started as an operation  
✅ `07:56:08` Port 21000 assigned from the internal range  

## The agent's sync timer fetches and acknowledges the plugin config

✅ `07:56:21` Plugin config file appeared on the agent VM within 90 seconds  
✅ `07:56:21` The file names the plugin  
✅ `07:56:21` The file carries the assigned port  
✅ `07:56:21` The file is 0600  
✅ `07:56:21` The agent acknowledged the secret  
✅ `07:56:22` The host records the acknowledgement  
✅ `07:56:22` sync.log records the fetch  

## Forwarding through the internal tunnel

✅ `07:56:25` Agent half listens on the agent VM's 127.0.0.1:21000  
✅ `07:56:25` The host's loopback port 21000 reaches the agent half through chisel  
✅ `07:56:25` The hosting operation succeeded once the agent half answered through the tunnel  
✅ `07:56:26` The hosting is active  
✅ `07:56:26` GET /api/e2e-app-plugin/ping reaches the agent half across VMs  
✅ `07:56:26` The caller assertion names the admin  
✅ `07:56:26` No cookie crosses the tunnel  
✅ `07:56:26` The admin bundle comes from the agent half  
✅ `07:56:26` The user surface is out of the forwarder's reach: 401 without a relay assertion  
✅ `07:56:39` Health is up  

## Secret rotation across the tunnel

✅ `07:56:39` Rotation pending  
✅ `07:56:40` Calls keep working while the rotation is pending  
✅ `07:56:56` The sync timer fetched and acknowledged the new secret within 90 seconds  
✅ `07:56:56` The agent's file carries the new secret  
✅ `07:56:56` sync.log records the rotation's fetch as well  
✅ `07:56:56` Calls work on the new secret  

## Health: application down

✅ `07:56:58` A stopped agent half behind a live tunnel is a 502  
✅ `07:57:21` Health reports down within 60 seconds  
✅ `07:57:21` The tunnel is up, the application is down: reason app  
✅ `07:57:42` Health is up again with the agent half back  

## Health: tunnel down

✅ `07:57:42` The agent's tunnel client is stopped  
✅ `07:58:09` Health reports down within 75 seconds  
✅ `07:58:09` Nothing listens on the relay port: reason tunnel  
✅ `07:58:09` The forwarder answers 502 with reason tunnel  
✅ `07:58:31` Health is up again once the tunnel client runs  

## Clear the hosting

✅ `07:58:31` Hosting removed  
✅ `07:58:31` The internal tunnel is gone  
✅ `07:58:58` The sync timer removed the agent's plugin config file  
✅ `07:58:59` sync.log records the removal  
✅ `07:58:59` The relay port no longer reaches the agent half  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `45` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `45` |

ℹ️ `07:58:59` Cleaning up test resources...  
