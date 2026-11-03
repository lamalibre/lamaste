# Lamaste E2E: 33 — Lifecycle hooks on both machines (Three-VM)

> Started at `2026-11-03 09:39:44 UTC`


## Pre-flight

✅ `09:39:44` Onboarding is complete  
✅ `09:39:45` Agent test-agent is enrolled on the host  
✅ `09:39:45` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
ℹ️ `09:39:45` Agent VM's @lamalibre/lamaste: /usr/lib/node_modules/@lamalibre/lamaste-agent/node_modules/@lamalibre/lamaste  

## Install and approve the hooks fixture

✅ `09:39:50` Stand-in registry is up on the host VM  
✅ `09:39:54` Fixture installed; its relay hooks wait for approval  
✅ `09:39:54` The install shows the six agent stages  
✅ `09:39:54` Approved: the runner holds the module  

## Host: install pipeline across the machines

✅ `09:40:06` The hosting operation succeeded  
✅ `09:40:06` Step: relay install:pre-tunnel  
✅ `09:40:06` Step: reserve port, secret and capability  
✅ `09:40:06` Step: agent install:pre-tunnel  
✅ `09:40:06` Step: grant the tunnel and wait for the agent half  
✅ `09:40:06` Step: agent install:post-tunnel  
✅ `09:40:06` Step: relay install:post-tunnel  
✅ `09:40:06` Step: activate  
✅ `09:40:06` The agent's pre-tunnel stage finished before the tunnel was granted  
✅ `09:40:06` The agent half ran install:pre-tunnel  
✅ `09:40:06` The agent half ran install:post-tunnel  
✅ `09:40:06` The agent's sync ran the pre-tunnel job (sync.log)  
✅ `09:40:06` The hosting is active  
✅ `09:40:06` Sandbox: a relay hook cannot read Lamaste's files  
✅ `09:40:06` Sandbox: a relay hook cannot spawn a process  
✅ `09:40:06` Sandbox: a relay hook has no network  
✅ `09:40:06` Sandbox: a relay hook sees an empty environment  

## Request hook across the tunnel

✅ `09:40:06` The token planted on the agent VM is redacted by the relay  
✅ `09:40:06` …and never leaves the relay  

## tunnel:down and tunnel:up on both machines

✅ `09:40:19` Health is up  
✅ `09:40:20` The agent's tunnel client is stopped  
✅ `09:40:50` Relay: health down  
✅ `09:40:50` Relay: reason tunnel  
✅ `09:40:50` Relay: tunnel:down ran (reason tunnel)  
✅ `09:40:50` Relay: the plugin's fallback answers while down  
✅ `09:40:50` …with the plugin's body  
✅ `09:40:51` Agent: the sync told the agent half tunnel:down (reason tunnel)  
✅ `09:41:11` Relay: health up again  
✅ `09:41:11` Relay: tunnel:up ran  
✅ `09:41:12` Agent: the sync told the agent half tunnel:up  
✅ `09:41:12` Requests reach the agent half again  
✅ `09:41:12` sync.log records the tunnel hooks  

## Unhost: uninstall pipeline across the machines

✅ `09:41:16` The unhosting operation succeeded  
✅ `09:41:16` Step: relay uninstall:pre-teardown  
✅ `09:41:16` Step: agent uninstall:pre-teardown  
✅ `09:41:16` Step: remove the tunnel  
✅ `09:41:16` Step: agent uninstall:post-teardown  
✅ `09:41:16` Step: revoke the secret and the capability  
✅ `09:41:16` Step: relay uninstall:post-teardown  
✅ `09:41:16` The agent's post-teardown ran after the tunnel went and before the secret was revoked  
✅ `09:41:16` The agent half ran uninstall:pre-teardown  
✅ `09:41:16` The agent half ran uninstall:post-teardown  
✅ `09:41:16` Unhosted: no hosting record  
✅ `09:41:16` Unhosted: no tunnel  
✅ `09:41:16` Unhosted: no host capability  
✅ `09:41:16` Unhosted: the sync timer removed the agent's plugin config  

## A failing agent install:post-tunnel rolls back

✅ `09:41:37` The operation rolled back  
✅ `09:41:37` agent install:post-tunnel failed  
✅ `09:41:37` …with the agent half's reason  
✅ `09:41:37` Rollback: the agent half's uninstall:pre-teardown ran  
✅ `09:41:37` Rollback: the agent half's uninstall:post-teardown ran  
✅ `09:41:38` The agent half saw phase rollback (pre-teardown)  
✅ `09:41:38` The agent half saw phase rollback (post-teardown)  
✅ `09:41:38` The relay's uninstall stages ran with phase rollback  
✅ `09:41:38` Rolled back: no hosting record  
✅ `09:41:38` Rolled back: no tunnel  
✅ `09:41:38` Rolled back: no host capability  
✅ `09:41:38` Rolled back: the sync timer removed the agent's plugin config  

## A failing agent install:pre-tunnel leaves nothing

✅ `09:41:46` The operation failed  
✅ `09:41:46` …at the agent's pre-tunnel stage  
✅ `09:41:46` The tunnel was never granted  
✅ `09:41:46` The agent half was asked (and refused)  
✅ `09:41:46` The agent side, whose own stage failed, is not asked to undo anything  
✅ `09:41:46` The relay's pre stage was rolled back  
✅ `09:41:46` Failed before the tunnel: no hosting record  
✅ `09:41:46` Failed before the tunnel: no tunnel  
✅ `09:41:47` Failed before the tunnel: no host capability  
✅ `09:41:47` Failed before the tunnel: the sync timer removed the agent's plugin config  

## Uninstall

✅ `09:41:47` The plugin is uninstalled  
✅ `09:41:48` Its hook runner is gone  
✅ `09:41:48` Its hook modules are removed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `78` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `78` |

ℹ️ `09:41:48` Cleaning up test resources...  
