# Lamaste E2E: 33 — Lifecycle hooks on both machines (Three-VM)

> Started at `2026-11-10 13:14:08 UTC`


## Pre-flight

✅ `13:14:08` Onboarding is complete  
✅ `13:14:08` Agent test-agent is enrolled on the host  
✅ `13:14:09` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
ℹ️ `13:14:09` Agent VM's @lamalibre/lamaste: /usr/lib/node_modules/@lamalibre/lamaste-agent/node_modules/@lamalibre/lamaste  

## Install and approve the hooks fixture

✅ `13:14:14` Stand-in registry is up on the host VM  
✅ `13:14:18` Fixture installed; its relay hooks wait for approval  
✅ `13:14:18` The install shows the six agent stages  
✅ `13:14:19` Approved: the runner holds the module  

## Host: install pipeline across the machines

✅ `13:14:30` The hosting operation succeeded  
✅ `13:14:30` Step: relay install:pre-tunnel  
✅ `13:14:30` Step: reserve port, secret and capability  
✅ `13:14:30` Step: agent install:pre-tunnel  
✅ `13:14:30` Step: grant the tunnel and wait for the agent half  
✅ `13:14:30` Step: agent install:post-tunnel  
✅ `13:14:30` Step: relay install:post-tunnel  
✅ `13:14:30` Step: activate  
✅ `13:14:30` The agent's pre-tunnel stage finished before the tunnel was granted  
✅ `13:14:30` The agent half ran install:pre-tunnel  
✅ `13:14:30` The agent half ran install:post-tunnel  
✅ `13:14:31` The agent's sync ran the pre-tunnel job (sync.log)  
✅ `13:14:31` The hosting is active  
✅ `13:14:31` Sandbox: a relay hook cannot read Lamaste's files  
✅ `13:14:31` Sandbox: a relay hook cannot spawn a process  
✅ `13:14:31` Sandbox: a relay hook has no network  
✅ `13:14:31` Sandbox: a relay hook sees an empty environment  

## Request hook across the tunnel

✅ `13:14:31` The token planted on the agent VM is redacted by the relay  
✅ `13:14:31` …and never leaves the relay  

## tunnel:down and tunnel:up on both machines

✅ `13:14:51` Health is up  
✅ `13:14:52` The agent's tunnel client is stopped  
✅ `13:15:22` Relay: health down  
✅ `13:15:22` Relay: reason tunnel  
✅ `13:15:22` Relay: tunnel:down ran (reason tunnel)  
✅ `13:15:23` Relay: the plugin's fallback answers while down  
✅ `13:15:23` …with the plugin's body  
✅ `13:15:23` Agent: the sync told the agent half tunnel:down (reason tunnel)  
✅ `13:15:41` Relay: health up again  
✅ `13:15:41` Relay: tunnel:up ran  
✅ `13:15:42` Agent: the sync told the agent half tunnel:up  
✅ `13:15:42` Requests reach the agent half again  
✅ `13:15:42` sync.log records the tunnel hooks  

## Unhost: uninstall pipeline across the machines

✅ `13:15:46` The unhosting operation succeeded  
✅ `13:15:46` Step: relay uninstall:pre-teardown  
✅ `13:15:46` Step: agent uninstall:pre-teardown  
✅ `13:15:46` Step: remove the tunnel  
✅ `13:15:46` Step: agent uninstall:post-teardown  
✅ `13:15:46` Step: revoke the secret and the capability  
✅ `13:15:46` Step: relay uninstall:post-teardown  
✅ `13:15:46` The agent's post-teardown ran after the tunnel went and before the secret was revoked  
✅ `13:15:47` The agent half ran uninstall:pre-teardown  
✅ `13:15:47` The agent half ran uninstall:post-teardown  
✅ `13:15:47` Unhosted: no hosting record  
✅ `13:15:47` Unhosted: no tunnel  
✅ `13:15:47` Unhosted: no host capability  
✅ `13:15:48` Unhosted: the sync timer removed the agent's plugin config  

## A failing agent install:post-tunnel rolls back

✅ `13:16:03` The operation rolled back  
✅ `13:16:03` agent install:post-tunnel failed  
✅ `13:16:03` …with the agent half's reason  
✅ `13:16:03` Rollback: the agent half's uninstall:pre-teardown ran  
✅ `13:16:03` Rollback: the agent half's uninstall:post-teardown ran  
✅ `13:16:03` The agent half saw phase rollback (pre-teardown)  
✅ `13:16:03` The agent half saw phase rollback (post-teardown)  
✅ `13:16:03` The relay's uninstall stages ran with phase rollback  
✅ `13:16:03` Rolled back: no hosting record  
✅ `13:16:03` Rolled back: no tunnel  
✅ `13:16:04` Rolled back: no host capability  
✅ `13:16:04` Rolled back: the sync timer removed the agent's plugin config  

## A failing agent install:pre-tunnel leaves nothing

✅ `13:16:12` The operation failed  
✅ `13:16:12` …at the agent's pre-tunnel stage  
✅ `13:16:12` The tunnel was never granted  
✅ `13:16:12` The agent half was asked (and refused)  
✅ `13:16:12` The agent side, whose own stage failed, is not asked to undo anything  
✅ `13:16:12` The relay's pre stage was rolled back  
✅ `13:16:12` Failed before the tunnel: no hosting record  
✅ `13:16:12` Failed before the tunnel: no tunnel  
✅ `13:16:12` Failed before the tunnel: no host capability  
✅ `13:16:13` Failed before the tunnel: the sync timer removed the agent's plugin config  

## Uninstall

✅ `13:16:14` The plugin is uninstalled  
✅ `13:16:14` Its hook runner is gone  
✅ `13:16:14` Its hook modules are removed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `78` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `78` |

ℹ️ `13:16:14` Cleaning up test resources...  
