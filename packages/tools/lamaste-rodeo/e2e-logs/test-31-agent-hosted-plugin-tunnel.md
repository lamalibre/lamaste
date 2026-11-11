# Lamaste E2E: 31 — Agent-hosted plugin through the internal tunnel (Three-VM)

> Started at `2026-11-11 09:09:22 UTC`


## Pre-flight

✅ `09:09:22` Onboarding is complete  
✅ `09:09:22` Agent test-agent is enrolled on the host  
✅ `09:09:23` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
ℹ️ `09:09:23` Agent VM's @lamalibre/lamaste: /usr/lib/node_modules/@lamalibre/lamaste-agent/node_modules/@lamalibre/lamaste  

## Install, enable, host on test-agent

✅ `09:09:28` Stand-in registry is up on the host VM  
✅ `09:09:35` Fixture installed as agent-hosted  
✅ `09:09:35` Plugin enabled  
✅ `09:09:36` Hosting on test-agent started as an operation  
✅ `09:09:36` Port 21000 assigned from the internal range  

## The agent's sync timer fetches and acknowledges the plugin config

✅ `09:10:06` Plugin config file appeared on the agent VM within 90 seconds  
✅ `09:10:06` The file names the plugin  
✅ `09:10:06` The file carries the assigned port  
✅ `09:10:06` The file is 0600  
✅ `09:10:07` The agent acknowledged the secret  
✅ `09:10:07` The host records the acknowledgement  
✅ `09:10:07` sync.log records the fetch  

## Forwarding through the internal tunnel

✅ `09:10:07` Agent half listens on the agent VM's 127.0.0.1:21000  
✅ `09:10:08` The host's loopback port 21000 reaches the agent half through chisel  
✅ `09:10:11` The hosting operation succeeded once the agent half answered through the tunnel  
✅ `09:10:11` The hosting is active  
✅ `09:10:11` GET /api/e2e-app-plugin/ping reaches the agent half across VMs  
✅ `09:10:11` The caller assertion names the admin  
✅ `09:10:11` No cookie crosses the tunnel  
✅ `09:10:11` The admin bundle comes from the agent half  
✅ `09:10:11` The user surface is out of the forwarder's reach: 401 without a relay assertion  
✅ `09:10:28` Health is up  

## Secret rotation across the tunnel

✅ `09:10:28` Rotation pending  
✅ `09:10:28` Calls keep working while the rotation is pending  
✅ `09:10:39` The sync timer fetched and acknowledged the new secret within 90 seconds  
✅ `09:10:39` The agent's file carries the new secret  
✅ `09:10:39` sync.log records the rotation's fetch as well  
✅ `09:10:39` Calls work on the new secret  

## Health: application down

✅ `09:10:40` A stopped agent half behind a live tunnel is a 502  
✅ `09:11:07` Health reports down within 60 seconds  
✅ `09:11:07` The tunnel is up, the application is down: reason app  
✅ `09:11:28` Health is up again with the agent half back  

## Health: tunnel down

✅ `09:11:28` The agent's tunnel client is stopped  
✅ `09:11:58` Health reports down within 75 seconds  
✅ `09:11:58` Nothing listens on the relay port: reason tunnel  
✅ `09:11:59` The forwarder answers 502 with reason tunnel  
✅ `09:12:20` Health is up again once the tunnel client runs  

## Clear the hosting

✅ `09:12:23` Hosting removed  
✅ `09:12:23` The internal tunnel is gone  
✅ `09:12:43` The sync timer removed the agent's plugin config file  
✅ `09:12:43` sync.log records the removal  
✅ `09:12:44` The relay port no longer reaches the agent half  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `45` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `45` |

ℹ️ `09:12:44` Cleaning up test resources...  
