# Lamaste E2E: 33 — Lifecycle hooks on both machines (Three-VM)

> Started at `2026-11-04 13:44:19 UTC`


## Pre-flight

✅ `13:44:20` Onboarding is complete  
✅ `13:44:20` Agent test-agent is enrolled on the host  
✅ `13:44:20` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
ℹ️ `13:44:21` Agent VM's @lamalibre/lamaste: /usr/lib/node_modules/@lamalibre/lamaste-agent/node_modules/@lamalibre/lamaste  

## Install and approve the hooks fixture

✅ `13:44:23` Stand-in registry is up on the host VM  
✅ `13:44:24` Fixture installed; its relay hooks wait for approval  
✅ `13:44:24` The install shows the six agent stages  
✅ `13:44:24` Approved: the runner holds the module  

## Host: install pipeline across the machines

✅ `13:44:35` The hosting operation succeeded  
✅ `13:44:35` Step: relay install:pre-tunnel  
✅ `13:44:35` Step: reserve port, secret and capability  
✅ `13:44:35` Step: agent install:pre-tunnel  
✅ `13:44:35` Step: grant the tunnel and wait for the agent half  
✅ `13:44:35` Step: agent install:post-tunnel  
✅ `13:44:35` Step: relay install:post-tunnel  
✅ `13:44:35` Step: activate  
✅ `13:44:35` The agent's pre-tunnel stage finished before the tunnel was granted  
✅ `13:44:35` The agent half ran install:pre-tunnel  
✅ `13:44:35` The agent half ran install:post-tunnel  
✅ `13:44:36` The agent's sync ran the pre-tunnel job (sync.log)  
✅ `13:44:36` The hosting is active  
✅ `13:44:36` Sandbox: a relay hook cannot read Lamaste's files  
✅ `13:44:36` Sandbox: a relay hook cannot spawn a process  
✅ `13:44:36` Sandbox: a relay hook has no network  
✅ `13:44:36` Sandbox: a relay hook sees an empty environment  

## Request hook across the tunnel

✅ `13:44:36` The token planted on the agent VM is redacted by the relay  
✅ `13:44:36` …and never leaves the relay  

## tunnel:down and tunnel:up on both machines

✅ `13:44:49` Health is up  
✅ `13:44:50` The agent's tunnel client is stopped  
✅ `13:45:21` Relay: health down  
✅ `13:45:21` Relay: reason tunnel  
✅ `13:45:21` Relay: tunnel:down ran (reason tunnel)  
✅ `13:45:21` Relay: the plugin's fallback answers while down  
✅ `13:45:21` …with the plugin's body  
✅ `13:45:22` Agent: the sync told the agent half tunnel:down (reason tunnel)  
✅ `13:45:40` Relay: health up again  
✅ `13:45:40` Relay: tunnel:up ran  
✅ `13:45:41` Agent: the sync told the agent half tunnel:up  
✅ `13:45:41` Requests reach the agent half again  
✅ `13:45:42` sync.log records the tunnel hooks  

## Unhost: uninstall pipeline across the machines

✅ `13:45:46` The unhosting operation succeeded  
✅ `13:45:46` Step: relay uninstall:pre-teardown  
✅ `13:45:46` Step: agent uninstall:pre-teardown  
✅ `13:45:46` Step: remove the tunnel  
✅ `13:45:46` Step: agent uninstall:post-teardown  
✅ `13:45:46` Step: revoke the secret and the capability  
✅ `13:45:46` Step: relay uninstall:post-teardown  
✅ `13:45:46` The agent's post-teardown ran after the tunnel went and before the secret was revoked  
✅ `13:45:46` The agent half ran uninstall:pre-teardown  
✅ `13:45:46` The agent half ran uninstall:post-teardown  
✅ `13:45:46` Unhosted: no hosting record  
✅ `13:45:46` Unhosted: no tunnel  
✅ `13:45:47` Unhosted: no host capability  
✅ `13:45:47` Unhosted: the sync timer removed the agent's plugin config  

## A failing agent install:post-tunnel rolls back

✅ `13:46:03` The operation rolled back  
✅ `13:46:03` agent install:post-tunnel failed  
✅ `13:46:03` …with the agent half's reason  
✅ `13:46:03` Rollback: the agent half's uninstall:pre-teardown ran  
✅ `13:46:03` Rollback: the agent half's uninstall:post-teardown ran  
✅ `13:46:03` The agent half saw phase rollback (pre-teardown)  
✅ `13:46:03` The agent half saw phase rollback (post-teardown)  
✅ `13:46:04` The relay's uninstall stages ran with phase rollback  
✅ `13:46:04` Rolled back: no hosting record  
✅ `13:46:04` Rolled back: no tunnel  
✅ `13:46:04` Rolled back: no host capability  
✅ `13:46:05` Rolled back: the sync timer removed the agent's plugin config  

## A failing agent install:pre-tunnel leaves nothing

✅ `13:46:13` The operation failed  
✅ `13:46:13` …at the agent's pre-tunnel stage  
✅ `13:46:13` The tunnel was never granted  
✅ `13:46:13` The agent half was asked (and refused)  
✅ `13:46:13` The agent side, whose own stage failed, is not asked to undo anything  
✅ `13:46:13` The relay's pre stage was rolled back  
✅ `13:46:14` Failed before the tunnel: no hosting record  
✅ `13:46:14` Failed before the tunnel: no tunnel  
✅ `13:46:14` Failed before the tunnel: no host capability  
✅ `13:46:14` Failed before the tunnel: the sync timer removed the agent's plugin config  

## Uninstall

✅ `13:46:16` The plugin is uninstalled  
✅ `13:46:16` Its hook runner is gone  
✅ `13:46:16` Its hook modules are removed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `78` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `78` |

ℹ️ `13:46:16` Cleaning up test resources...  
