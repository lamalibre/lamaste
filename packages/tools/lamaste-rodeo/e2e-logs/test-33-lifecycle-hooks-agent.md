# Lamaste E2E: 33 — Lifecycle hooks on both machines (Three-VM)

> Started at `2026-11-10 07:59:03 UTC`


## Pre-flight

✅ `07:59:03` Onboarding is complete  
✅ `07:59:04` Agent test-agent is enrolled on the host  
✅ `07:59:04` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
ℹ️ `07:59:05` Agent VM's @lamalibre/lamaste: /usr/lib/node_modules/@lamalibre/lamaste-agent/node_modules/@lamalibre/lamaste  

## Install and approve the hooks fixture

✅ `07:59:10` Stand-in registry is up on the host VM  
✅ `07:59:14` Fixture installed; its relay hooks wait for approval  
✅ `07:59:14` The install shows the six agent stages  
✅ `07:59:15` Approved: the runner holds the module  

## Host: install pipeline across the machines

✅ `07:59:26` The hosting operation succeeded  
✅ `07:59:26` Step: relay install:pre-tunnel  
✅ `07:59:26` Step: reserve port, secret and capability  
✅ `07:59:26` Step: agent install:pre-tunnel  
✅ `07:59:27` Step: grant the tunnel and wait for the agent half  
✅ `07:59:27` Step: agent install:post-tunnel  
✅ `07:59:27` Step: relay install:post-tunnel  
✅ `07:59:27` Step: activate  
✅ `07:59:27` The agent's pre-tunnel stage finished before the tunnel was granted  
✅ `07:59:27` The agent half ran install:pre-tunnel  
✅ `07:59:27` The agent half ran install:post-tunnel  
✅ `07:59:27` The agent's sync ran the pre-tunnel job (sync.log)  
✅ `07:59:27` The hosting is active  
✅ `07:59:27` Sandbox: a relay hook cannot read Lamaste's files  
✅ `07:59:27` Sandbox: a relay hook cannot spawn a process  
✅ `07:59:27` Sandbox: a relay hook has no network  
✅ `07:59:27` Sandbox: a relay hook sees an empty environment  

## Request hook across the tunnel

✅ `07:59:27` The token planted on the agent VM is redacted by the relay  
✅ `07:59:27` …and never leaves the relay  

## tunnel:down and tunnel:up on both machines

✅ `07:59:40` Health is up  
✅ `07:59:41` The agent's tunnel client is stopped  
✅ `08:00:11` Relay: health down  
✅ `08:00:11` Relay: reason tunnel  
✅ `08:00:12` Relay: tunnel:down ran (reason tunnel)  
✅ `08:00:12` Relay: the plugin's fallback answers while down  
✅ `08:00:12` …with the plugin's body  
✅ `08:00:12` Agent: the sync told the agent half tunnel:down (reason tunnel)  
✅ `08:00:30` Relay: health up again  
✅ `08:00:30` Relay: tunnel:up ran  
✅ `08:00:31` Agent: the sync told the agent half tunnel:up  
✅ `08:00:31` Requests reach the agent half again  
✅ `08:00:31` sync.log records the tunnel hooks  

## Unhost: uninstall pipeline across the machines

✅ `08:00:35` The unhosting operation succeeded  
✅ `08:00:35` Step: relay uninstall:pre-teardown  
✅ `08:00:35` Step: agent uninstall:pre-teardown  
✅ `08:00:35` Step: remove the tunnel  
✅ `08:00:35` Step: agent uninstall:post-teardown  
✅ `08:00:35` Step: revoke the secret and the capability  
✅ `08:00:35` Step: relay uninstall:post-teardown  
✅ `08:00:35` The agent's post-teardown ran after the tunnel went and before the secret was revoked  
✅ `08:00:35` The agent half ran uninstall:pre-teardown  
✅ `08:00:35` The agent half ran uninstall:post-teardown  
✅ `08:00:36` Unhosted: no hosting record  
✅ `08:00:36` Unhosted: no tunnel  
✅ `08:00:36` Unhosted: no host capability  
✅ `08:00:36` Unhosted: the sync timer removed the agent's plugin config  

## A failing agent install:post-tunnel rolls back

✅ `08:00:55` The operation rolled back  
✅ `08:00:55` agent install:post-tunnel failed  
✅ `08:00:55` …with the agent half's reason  
✅ `08:00:55` Rollback: the agent half's uninstall:pre-teardown ran  
✅ `08:00:55` Rollback: the agent half's uninstall:post-teardown ran  
✅ `08:00:56` The agent half saw phase rollback (pre-teardown)  
✅ `08:00:56` The agent half saw phase rollback (post-teardown)  
✅ `08:00:57` The relay's uninstall stages ran with phase rollback  
✅ `08:00:57` Rolled back: no hosting record  
✅ `08:00:57` Rolled back: no tunnel  
✅ `08:00:57` Rolled back: no host capability  
✅ `08:00:57` Rolled back: the sync timer removed the agent's plugin config  

## A failing agent install:pre-tunnel leaves nothing

✅ `08:01:06` The operation failed  
✅ `08:01:06` …at the agent's pre-tunnel stage  
✅ `08:01:06` The tunnel was never granted  
✅ `08:01:06` The agent half was asked (and refused)  
✅ `08:01:06` The agent side, whose own stage failed, is not asked to undo anything  
✅ `08:01:06` The relay's pre stage was rolled back  
✅ `08:01:06` Failed before the tunnel: no hosting record  
✅ `08:01:06` Failed before the tunnel: no tunnel  
✅ `08:01:07` Failed before the tunnel: no host capability  
✅ `08:01:07` Failed before the tunnel: the sync timer removed the agent's plugin config  

## Uninstall

✅ `08:01:08` The plugin is uninstalled  
✅ `08:01:08` Its hook runner is gone  
✅ `08:01:08` Its hook modules are removed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `78` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `78` |

ℹ️ `08:01:08` Cleaning up test resources...  
