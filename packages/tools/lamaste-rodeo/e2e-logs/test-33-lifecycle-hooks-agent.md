# Lamaste E2E: 33 — Lifecycle hooks on both machines (Three-VM)

> Started at `2026-11-02 15:59:27 UTC`


## Pre-flight

✅ `15:59:27` Onboarding is complete  
✅ `15:59:27` Agent test-agent is enrolled on the host  
✅ `15:59:27` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
ℹ️ `15:59:27` Agent VM's @lamalibre/lamaste: /usr/lib/node_modules/@lamalibre/lamaste-agent/node_modules/@lamalibre/lamaste  

## Install and approve the hooks fixture

✅ `15:59:29` Stand-in registry is up on the host VM  
✅ `15:59:31` Fixture installed; its relay hooks wait for approval  
✅ `15:59:31` The install shows the six agent stages  
✅ `15:59:32` Approved: the runner holds the module  

## Host: install pipeline across the machines

✅ `15:59:43` The hosting operation succeeded  
✅ `15:59:43` Step: relay install:pre-tunnel  
✅ `15:59:43` Step: reserve port, secret and capability  
✅ `15:59:43` Step: agent install:pre-tunnel  
✅ `15:59:43` Step: grant the tunnel and wait for the agent half  
✅ `15:59:43` Step: agent install:post-tunnel  
✅ `15:59:43` Step: relay install:post-tunnel  
✅ `15:59:43` Step: activate  
✅ `15:59:43` The agent's pre-tunnel stage finished before the tunnel was granted  
✅ `15:59:43` The agent half ran install:pre-tunnel  
✅ `15:59:43` The agent half ran install:post-tunnel  
✅ `15:59:43` The agent's sync ran the pre-tunnel job (sync.log)  
✅ `15:59:43` The hosting is active  
✅ `15:59:43` Sandbox: a relay hook cannot read Lamaste's files  
✅ `15:59:43` Sandbox: a relay hook cannot spawn a process  
✅ `15:59:43` Sandbox: a relay hook has no network  
✅ `15:59:43` Sandbox: a relay hook sees an empty environment  

## Request hook across the tunnel

✅ `15:59:43` The token planted on the agent VM is redacted by the relay  
✅ `15:59:43` …and never leaves the relay  

## tunnel:down and tunnel:up on both machines

✅ `15:59:59` Health is up  
✅ `16:00:00` The agent's tunnel client is stopped  
✅ `16:00:29` Relay: health down  
✅ `16:00:29` Relay: reason tunnel  
✅ `16:00:30` Relay: tunnel:down ran (reason tunnel)  
✅ `16:00:30` Relay: the plugin's fallback answers while down  
✅ `16:00:30` …with the plugin's body  
✅ `16:00:30` Agent: the sync told the agent half tunnel:down (reason tunnel)  
✅ `16:00:47` Relay: health up again  
✅ `16:00:48` Relay: tunnel:up ran  
✅ `16:00:48` Agent: the sync told the agent half tunnel:up  
✅ `16:00:48` Requests reach the agent half again  
✅ `16:00:48` sync.log records the tunnel hooks  

## Unhost: uninstall pipeline across the machines

✅ `16:00:52` The unhosting operation succeeded  
✅ `16:00:52` Step: relay uninstall:pre-teardown  
✅ `16:00:52` Step: agent uninstall:pre-teardown  
✅ `16:00:52` Step: remove the tunnel  
✅ `16:00:52` Step: agent uninstall:post-teardown  
✅ `16:00:52` Step: revoke the secret and the capability  
✅ `16:00:52` Step: relay uninstall:post-teardown  
✅ `16:00:52` The agent's post-teardown ran after the tunnel went and before the secret was revoked  
✅ `16:00:52` The agent half ran uninstall:pre-teardown  
✅ `16:00:52` The agent half ran uninstall:post-teardown  
✅ `16:00:52` Unhosted: no hosting record  
✅ `16:00:52` Unhosted: no tunnel  
✅ `16:00:52` Unhosted: no host capability  
✅ `16:00:52` Unhosted: the sync timer removed the agent's plugin config  

## A failing agent install:post-tunnel rolls back

✅ `16:01:13` The operation rolled back  
✅ `16:01:13` agent install:post-tunnel failed  
✅ `16:01:13` …with the agent half's reason  
✅ `16:01:13` Rollback: the agent half's uninstall:pre-teardown ran  
✅ `16:01:13` Rollback: the agent half's uninstall:post-teardown ran  
✅ `16:01:14` The agent half saw phase rollback (pre-teardown)  
✅ `16:01:14` The agent half saw phase rollback (post-teardown)  
✅ `16:01:14` The relay's uninstall stages ran with phase rollback  
✅ `16:01:14` Rolled back: no hosting record  
✅ `16:01:14` Rolled back: no tunnel  
✅ `16:01:14` Rolled back: no host capability  
✅ `16:01:14` Rolled back: the sync timer removed the agent's plugin config  

## A failing agent install:pre-tunnel leaves nothing

✅ `16:01:22` The operation failed  
✅ `16:01:22` …at the agent's pre-tunnel stage  
✅ `16:01:22` The tunnel was never granted  
✅ `16:01:22` The agent half was asked (and refused)  
✅ `16:01:22` The agent side, whose own stage failed, is not asked to undo anything  
✅ `16:01:22` The relay's pre stage was rolled back  
✅ `16:01:22` Failed before the tunnel: no hosting record  
✅ `16:01:22` Failed before the tunnel: no tunnel  
✅ `16:01:22` Failed before the tunnel: no host capability  
✅ `16:01:22` Failed before the tunnel: the sync timer removed the agent's plugin config  

## Uninstall

✅ `16:01:23` The plugin is uninstalled  
✅ `16:01:23` Its hook runner is gone  
✅ `16:01:23` Its hook modules are removed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `78` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `78` |

ℹ️ `16:01:23` Cleaning up test resources...  
