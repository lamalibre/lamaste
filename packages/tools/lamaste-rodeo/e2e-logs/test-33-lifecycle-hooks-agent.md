# Lamaste E2E: 33 — Lifecycle hooks on both machines (Three-VM)

> Started at `2026-11-10 17:56:25 UTC`


## Pre-flight

✅ `17:56:25` Onboarding is complete  
✅ `17:56:26` Agent test-agent is enrolled on the host  
✅ `17:56:26` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
ℹ️ `17:56:27` Agent VM's @lamalibre/lamaste: /usr/lib/node_modules/@lamalibre/lamaste-agent/node_modules/@lamalibre/lamaste  

## Install and approve the hooks fixture

✅ `17:56:32` Stand-in registry is up on the host VM  
✅ `17:56:36` Fixture installed; its relay hooks wait for approval  
✅ `17:56:36` The install shows the six agent stages  
✅ `17:56:36` Approved: the runner holds the module  

## Host: install pipeline across the machines

✅ `17:56:48` The hosting operation succeeded  
✅ `17:56:48` Step: relay install:pre-tunnel  
✅ `17:56:48` Step: reserve port, secret and capability  
✅ `17:56:48` Step: agent install:pre-tunnel  
✅ `17:56:48` Step: grant the tunnel and wait for the agent half  
✅ `17:56:48` Step: agent install:post-tunnel  
✅ `17:56:48` Step: relay install:post-tunnel  
✅ `17:56:48` Step: activate  
✅ `17:56:48` The agent's pre-tunnel stage finished before the tunnel was granted  
✅ `17:56:48` The agent half ran install:pre-tunnel  
✅ `17:56:48` The agent half ran install:post-tunnel  
✅ `17:56:48` The agent's sync ran the pre-tunnel job (sync.log)  
✅ `17:56:48` The hosting is active  
✅ `17:56:49` Sandbox: a relay hook cannot read Lamaste's files  
✅ `17:56:49` Sandbox: a relay hook cannot spawn a process  
✅ `17:56:49` Sandbox: a relay hook has no network  
✅ `17:56:49` Sandbox: a relay hook sees an empty environment  

## Request hook across the tunnel

✅ `17:56:49` The token planted on the agent VM is redacted by the relay  
✅ `17:56:49` …and never leaves the relay  

## tunnel:down and tunnel:up on both machines

✅ `17:56:59` Health is up  
✅ `17:56:59` The agent's tunnel client is stopped  
✅ `17:57:30` Relay: health down  
✅ `17:57:30` Relay: reason tunnel  
✅ `17:57:30` Relay: tunnel:down ran (reason tunnel)  
✅ `17:57:30` Relay: the plugin's fallback answers while down  
✅ `17:57:30` …with the plugin's body  
✅ `17:57:31` Agent: the sync told the agent half tunnel:down (reason tunnel)  
✅ `17:57:48` Relay: health up again  
✅ `17:57:48` Relay: tunnel:up ran  
✅ `17:57:49` Agent: the sync told the agent half tunnel:up  
✅ `17:57:49` Requests reach the agent half again  
✅ `17:57:49` sync.log records the tunnel hooks  

## Unhost: uninstall pipeline across the machines

✅ `17:57:56` The unhosting operation succeeded  
✅ `17:57:56` Step: relay uninstall:pre-teardown  
✅ `17:57:56` Step: agent uninstall:pre-teardown  
✅ `17:57:56` Step: remove the tunnel  
✅ `17:57:56` Step: agent uninstall:post-teardown  
✅ `17:57:56` Step: revoke the secret and the capability  
✅ `17:57:56` Step: relay uninstall:post-teardown  
✅ `17:57:56` The agent's post-teardown ran after the tunnel went and before the secret was revoked  
✅ `17:57:57` The agent half ran uninstall:pre-teardown  
✅ `17:57:57` The agent half ran uninstall:post-teardown  
✅ `17:57:57` Unhosted: no hosting record  
✅ `17:57:57` Unhosted: no tunnel  
✅ `17:57:57` Unhosted: no host capability  
✅ `17:57:57` Unhosted: the sync timer removed the agent's plugin config  

## A failing agent install:post-tunnel rolls back

✅ `17:58:12` The operation rolled back  
✅ `17:58:12` agent install:post-tunnel failed  
✅ `17:58:12` …with the agent half's reason  
✅ `17:58:12` Rollback: the agent half's uninstall:pre-teardown ran  
✅ `17:58:12` Rollback: the agent half's uninstall:post-teardown ran  
✅ `17:58:12` The agent half saw phase rollback (pre-teardown)  
✅ `17:58:12` The agent half saw phase rollback (post-teardown)  
✅ `17:58:12` The relay's uninstall stages ran with phase rollback  
✅ `17:58:13` Rolled back: no hosting record  
✅ `17:58:13` Rolled back: no tunnel  
✅ `17:58:13` Rolled back: no host capability  
✅ `17:58:13` Rolled back: the sync timer removed the agent's plugin config  

## A failing agent install:pre-tunnel leaves nothing

✅ `17:58:21` The operation failed  
✅ `17:58:21` …at the agent's pre-tunnel stage  
✅ `17:58:21` The tunnel was never granted  
✅ `17:58:21` The agent half was asked (and refused)  
✅ `17:58:21` The agent side, whose own stage failed, is not asked to undo anything  
✅ `17:58:21` The relay's pre stage was rolled back  
✅ `17:58:21` Failed before the tunnel: no hosting record  
✅ `17:58:21` Failed before the tunnel: no tunnel  
✅ `17:58:22` Failed before the tunnel: no host capability  
✅ `17:58:22` Failed before the tunnel: the sync timer removed the agent's plugin config  

## Uninstall

✅ `17:58:23` The plugin is uninstalled  
✅ `17:58:23` Its hook runner is gone  
✅ `17:58:23` Its hook modules are removed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `78` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `78` |

ℹ️ `17:58:23` Cleaning up test resources...  
