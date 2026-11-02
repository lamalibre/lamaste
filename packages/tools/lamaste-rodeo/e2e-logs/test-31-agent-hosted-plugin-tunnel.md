# Lamaste E2E: 31 — Agent-hosted plugin through the internal tunnel (Three-VM)

> Started at `2026-11-02 15:56:26 UTC`


## Pre-flight

✅ `15:56:26` Onboarding is complete  
✅ `15:56:27` Agent test-agent is enrolled on the host  
✅ `15:56:27` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
ℹ️ `15:56:27` Agent VM's @lamalibre/lamaste: /usr/lib/node_modules/@lamalibre/lamaste-agent/node_modules/@lamalibre/lamaste  

## Install, enable, host on test-agent

✅ `15:56:29` Stand-in registry is up on the host VM  
✅ `15:56:31` Fixture installed as agent-hosted  
✅ `15:56:31` Plugin enabled  
✅ `15:56:32` Hosting on test-agent started as an operation  
✅ `15:56:32` Port 21000 assigned from the internal range  

## The agent's sync timer fetches and acknowledges the plugin config

✅ `15:56:39` Plugin config file appeared on the agent VM within 90 seconds  
✅ `15:56:39` The file names the plugin  
✅ `15:56:39` The file carries the assigned port  
✅ `15:56:39` The file is 0600  
✅ `15:56:39` The agent acknowledged the secret  
✅ `15:56:39` The host records the acknowledgement  
✅ `15:56:40` sync.log records the fetch  

## Forwarding through the internal tunnel

✅ `15:56:40` Agent half listens on the agent VM's 127.0.0.1:21000  
✅ `15:56:40` The host's loopback port 21000 reaches the agent half through chisel  
✅ `15:56:43` The hosting operation succeeded once the agent half answered through the tunnel  
✅ `15:56:43` The hosting is active  
✅ `15:56:43` GET /api/e2e-app-plugin/ping reaches the agent half across VMs  
✅ `15:56:43` The caller assertion names the admin  
✅ `15:56:43` No cookie crosses the tunnel  
✅ `15:56:44` The admin bundle comes from the agent half  
✅ `15:56:44` The user surface is out of the forwarder's reach: 401 without a relay assertion  
✅ `15:56:57` Health is up  

## Secret rotation across the tunnel

✅ `15:56:57` Rotation pending  
✅ `15:56:57` Calls keep working while the rotation is pending  
✅ `15:57:11` The sync timer fetched and acknowledged the new secret within 90 seconds  
✅ `15:57:11` The agent's file carries the new secret  
✅ `15:57:11` sync.log records the rotation's fetch as well  
✅ `15:57:11` Calls work on the new secret  

## Health: application down

✅ `15:57:13` A stopped agent half behind a live tunnel is a 502  
✅ `15:57:40` Health reports down within 60 seconds  
✅ `15:57:40` The tunnel is up, the application is down: reason app  
✅ `15:58:00` Health is up again with the agent half back  

## Health: tunnel down

✅ `15:58:00` The agent's tunnel client is stopped  
✅ `15:58:30` Health reports down within 75 seconds  
✅ `15:58:30` Nothing listens on the relay port: reason tunnel  
✅ `15:58:30` The forwarder answers 502 with reason tunnel  
✅ `15:58:47` Health is up again once the tunnel client runs  

## Clear the hosting

✅ `15:58:47` Hosting removed  
✅ `15:58:48` The internal tunnel is gone  
✅ `15:59:17` The sync timer removed the agent's plugin config file  
✅ `15:59:17` sync.log records the removal  
✅ `15:59:17` The relay port no longer reaches the agent half  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `45` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `45` |

ℹ️ `15:59:17` Cleaning up test resources...  
