# Lamaste E2E: 33 — Lifecycle hooks on both machines (Three-VM)

> Started at `2026-11-09 12:51:39 UTC`


## Pre-flight

✅ `12:51:39` Onboarding is complete  
✅ `12:51:40` Agent test-agent is enrolled on the host  
✅ `12:51:40` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
ℹ️ `12:51:40` Agent VM's @lamalibre/lamaste: /usr/lib/node_modules/@lamalibre/lamaste-agent/node_modules/@lamalibre/lamaste  

## Install and approve the hooks fixture

✅ `12:51:44` Stand-in registry is up on the host VM  
✅ `12:51:48` Fixture installed; its relay hooks wait for approval  
✅ `12:51:48` The install shows the six agent stages  
✅ `12:51:49` Approved: the runner holds the module  

## Host: install pipeline across the machines

✅ `12:51:59` The hosting operation succeeded  
✅ `12:51:59` Step: relay install:pre-tunnel  
✅ `12:51:59` Step: reserve port, secret and capability  
✅ `12:51:59` Step: agent install:pre-tunnel  
✅ `12:51:59` Step: grant the tunnel and wait for the agent half  
✅ `12:51:59` Step: agent install:post-tunnel  
✅ `12:51:59` Step: relay install:post-tunnel  
✅ `12:51:59` Step: activate  
✅ `12:51:59` The agent's pre-tunnel stage finished before the tunnel was granted  
✅ `12:52:00` The agent half ran install:pre-tunnel  
✅ `12:52:00` The agent half ran install:post-tunnel  
✅ `12:52:00` The agent's sync ran the pre-tunnel job (sync.log)  
✅ `12:52:00` The hosting is active  
✅ `12:52:00` Sandbox: a relay hook cannot read Lamaste's files  
✅ `12:52:00` Sandbox: a relay hook cannot spawn a process  
✅ `12:52:00` Sandbox: a relay hook has no network  
✅ `12:52:00` Sandbox: a relay hook sees an empty environment  

## Request hook across the tunnel

✅ `12:52:00` The token planted on the agent VM is redacted by the relay  
✅ `12:52:00` …and never leaves the relay  

## tunnel:down and tunnel:up on both machines

✅ `12:52:16` Health is up  
✅ `12:52:17` The agent's tunnel client is stopped  
✅ `12:52:46` Relay: health down  
✅ `12:52:46` Relay: reason tunnel  
✅ `12:52:46` Relay: tunnel:down ran (reason tunnel)  
✅ `12:52:46` Relay: the plugin's fallback answers while down  
✅ `12:52:46` …with the plugin's body  
✅ `12:52:47` Agent: the sync told the agent half tunnel:down (reason tunnel)  
✅ `12:53:07` Relay: health up again  
✅ `12:53:07` Relay: tunnel:up ran  
✅ `12:53:07` Agent: the sync told the agent half tunnel:up  
✅ `12:53:07` Requests reach the agent half again  
✅ `12:53:07` sync.log records the tunnel hooks  

## Unhost: uninstall pipeline across the machines

✅ `12:53:11` The unhosting operation succeeded  
✅ `12:53:11` Step: relay uninstall:pre-teardown  
✅ `12:53:11` Step: agent uninstall:pre-teardown  
✅ `12:53:11` Step: remove the tunnel  
✅ `12:53:11` Step: agent uninstall:post-teardown  
✅ `12:53:11` Step: revoke the secret and the capability  
✅ `12:53:11` Step: relay uninstall:post-teardown  
✅ `12:53:11` The agent's post-teardown ran after the tunnel went and before the secret was revoked  
✅ `12:53:11` The agent half ran uninstall:pre-teardown  
✅ `12:53:11` The agent half ran uninstall:post-teardown  
✅ `12:53:11` Unhosted: no hosting record  
✅ `12:53:11` Unhosted: no tunnel  
✅ `12:53:11` Unhosted: no host capability  
✅ `12:53:11` Unhosted: the sync timer removed the agent's plugin config  

## A failing agent install:post-tunnel rolls back

✅ `12:53:32` The operation rolled back  
✅ `12:53:32` agent install:post-tunnel failed  
✅ `12:53:32` …with the agent half's reason  
✅ `12:53:32` Rollback: the agent half's uninstall:pre-teardown ran  
✅ `12:53:32` Rollback: the agent half's uninstall:post-teardown ran  
✅ `12:53:32` The agent half saw phase rollback (pre-teardown)  
✅ `12:53:32` The agent half saw phase rollback (post-teardown)  
✅ `12:53:32` The relay's uninstall stages ran with phase rollback  
✅ `12:53:32` Rolled back: no hosting record  
✅ `12:53:33` Rolled back: no tunnel  
✅ `12:53:33` Rolled back: no host capability  
✅ `12:53:33` Rolled back: the sync timer removed the agent's plugin config  

## A failing agent install:pre-tunnel leaves nothing

✅ `12:53:40` The operation failed  
✅ `12:53:40` …at the agent's pre-tunnel stage  
✅ `12:53:40` The tunnel was never granted  
✅ `12:53:40` The agent half was asked (and refused)  
✅ `12:53:40` The agent side, whose own stage failed, is not asked to undo anything  
✅ `12:53:40` The relay's pre stage was rolled back  
✅ `12:53:40` Failed before the tunnel: no hosting record  
✅ `12:53:41` Failed before the tunnel: no tunnel  
✅ `12:53:41` Failed before the tunnel: no host capability  
✅ `12:53:41` Failed before the tunnel: the sync timer removed the agent's plugin config  

## Uninstall

✅ `12:53:42` The plugin is uninstalled  
✅ `12:53:42` Its hook runner is gone  
✅ `12:53:42` Its hook modules are removed  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `78` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `78` |

ℹ️ `12:53:42` Cleaning up test resources...  
