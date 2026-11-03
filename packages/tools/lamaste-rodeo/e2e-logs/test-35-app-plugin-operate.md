# Lamaste E2E: 35 — App plugin agent half: rotation, reboot, update (Three-VM)

> Started at `2026-11-03 09:46:42 UTC`


## Pre-flight

✅ `09:46:42` Onboarding is complete  
✅ `09:46:42` Agent test-agent is enrolled on the host  
✅ `09:46:42` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `09:46:42` The agent VM's lamaste-agent has the apphost command  
ℹ️ `09:46:42` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install and host the plugin (1.0.0)

✅ `09:46:43` Fixtures built: @lamalibre/e2e-apphost-ops-server 1.0.0, 1.1.0 and 1.2.0 (a bad release) with their agent packages  
✅ `09:47:04` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-ops-server, @lamalibre/e2e-apphost-ops-agent )  
✅ `09:47:04` The agent VM reaches it at http://10.13.37.1:4874  
✅ `09:47:05` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T09:47:05.806Z"})  
✅ `09:47:05` …through its own OIDC client  
✅ `09:47:10` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `09:47:15` Installed @lamalibre/e2e-apphost-ops-server@1.0.0 and approved its agent half  
✅ `09:47:25` Hosted on test-agent ()  
✅ `09:47:25` Agent half 1.0.0 answers through the tunnel as lamaste-app-e2e-apphost-ops  

## A rotation reaches the service's copy before it is acknowledged

✅ `09:47:26` lamalibre-app-e2e-apphost-ops.socket listens on 127.0.0.1:21000 (since Tue 2026-11-03 12:47:16 +03)  
✅ `09:47:26` The service's copy holds the current secret  
✅ `09:47:26` Rotation pending  
✅ `09:47:26` A new secret was issued  
✅ `09:47:26` Calls keep working while the rotation is pending  
✅ `09:47:29` The relay has the new secret acknowledged  
✅ `09:47:29` …and by then the service's copy held it: written before the acknowledgement  
✅ `09:47:29` /etc/lamalibre/apps/e2e-apphost-ops/plugin-config.json carries the new secret  
✅ `09:47:29` …the one the agent holds  
✅ `09:47:29` …still 0600, the account's  
✅ `09:47:29` The service was not restarted: it re-reads its config on a signature it cannot verify  
✅ `09:47:29` The socket unit's file is unchanged: a rotation does not move the port  
✅ `09:47:29` …and the socket kept listening (active since Tue 2026-11-03 12:47:16 +03)  
✅ `09:47:29` The agent's sync delivered it (sync.log)  
✅ `09:47:29` Calls work on the new secret  

## Systemd holds the port: the agent half stopped, restarted or killed

✅ `09:47:30` While the agent half runs, nobody can bind neither 127.0.0.1:21000 nor 0.0.0.0:21000  
✅ `09:47:30` systemctl stop lamalibre-app-e2e-apphost-ops.service: sampled while it stayed stopped  
✅ `09:47:30` lamalibre-app-e2e-apphost-ops.socket stays active, listening on 127.0.0.1:21000  
✅ `09:47:30` ss: systemd (pid 1) alone holds the port  
✅ `09:47:30` …and nobody can bind neither 127.0.0.1:21000 nor 0.0.0.0:21000: no window to take it  
✅ `09:47:30` A connection to the port finds the agent half again: systemd started it for the connection waiting on its socket  
✅ `09:47:30` lamalibre-app-e2e-apphost-ops.service is active again (MainPID 39734)  
✅ `09:47:30` The pages answer through the tunnel  
✅ `09:47:34` systemctl restart: a new agent half (MainPID 39734 → 40058)  
✅ `09:47:43` kill -9: Restart=always brings a new one (MainPID 40058 → 40375)  
✅ `09:47:56` The client made 102 requests across the restart and the kill (longest wait 5257 ms)  
✅ `09:47:56` …none refused: the port was never closed  
✅ `09:47:56` …every answer the agent half's (401 to a bare call)  
✅ `09:47:56` …at most the requests in flight at the two stops cut ({})  
✅ `09:47:56` lamalibre-app-e2e-apphost-ops.socket listened throughout: active since Tue 2026-11-03 12:47:16 +03  
✅ `09:47:56` The new agent half was handed the same listening socket (descriptor 3)  
✅ `09:47:57` The pages answer  

## A reboot of the agent VM brings it all back

ℹ️ `09:47:57` Restarting lamaste-agent  
✅ `09:48:13` The agent VM is back  
✅ `09:48:14` lamalibre-app-e2e-apphost-ops.service started at boot  
✅ `09:48:14` The tunnel is up again: the pages answer  
✅ `09:48:14` Agent half 1.0.0, as lamaste-app-e2e-apphost-ops  
✅ `09:48:14` Its data survived the reboot  
✅ `09:48:14` …and it was started again (start 5)  
✅ `09:48:14` …on systemd's socket, descriptor 3  
✅ `09:48:14` Its process is lamaste-app-e2e-apphost-ops's  
✅ `09:48:14` The service's copy kept the rotated secret  
✅ `09:48:14` lamalibre-app-e2e-apphost-ops.socket came back at boot, listening on 127.0.0.1:21000  
✅ `09:48:14` ss: the listening socket is systemd's and the agent half's (MainPID 644)  
✅ `09:48:14` The agent half's descriptor 3 is that socket  
✅ `09:48:14` The agent's sync timer runs again  
✅ `09:48:14` The relay's health of the hosting is up  

## Update to 1.1.0: approved, the new agent half first

✅ `09:48:15` The update waits for approval: its agent half changed  
✅ `09:48:15` …pinned to the integrity of @lamalibre/e2e-apphost-ops-agent@1.1.0  
✅ `09:48:15` Until it is approved, 1.0.0 stays  
✅ `09:48:23` The update succeeded ()  
✅ `09:48:23` Step: agent install:pre-tunnel  
✅ `09:48:23` Step: install the new agent half  
✅ `09:48:23` Step: install the new version  
✅ `09:48:23` Step: agent install:post-tunnel  
✅ `09:48:23` The agent half was switched before the relay package  
✅ `09:48:23` current → 1.1.0, previous → 1.0.0  
✅ `09:48:23` Both versions are kept  
✅ `09:48:23` lamalibre-app-e2e-apphost-ops.service is active  
✅ `09:48:23` …as a new process (MainPID 644 → 1477)  
✅ `09:48:23` …on the same socket: lamalibre-app-e2e-apphost-ops.socket listened throughout the update (since Tue 2026-11-03 12:48:10 +03)  
✅ `09:48:23` The pages come from 1.1.0  
✅ `09:48:23` …which found the data 1.0.0 left  
✅ `09:48:23` The relay package is 1.1.0  
✅ `09:48:23` The relay records agent half 1.1.0  
✅ `09:48:23` 1.0.0 answered the pre stage  
✅ `09:48:23` 1.1.0 answered the post stage  
✅ `09:48:24` Audit: plugin.agent-half.installed for the upgrade  

## Update to 1.2.0: its post stage fails, 1.1.0 comes back

✅ `09:48:24` 1.2.0 waits for approval  
✅ `09:48:38` The update was rolled back  
✅ `09:48:38` …because the 1.2.0 agent half refused its post stage  
✅ `09:48:38` 1.2.0 had been installed and activated  
✅ `09:48:38` Its post stage failed  
✅ `09:48:38` The relay package was restored  
✅ `09:48:38` The previous agent half was activated  
✅ `09:48:39` current → 1.1.0 again (previous → 1.2.0)  
✅ `09:48:39` Only the current and the previous version are kept  
✅ `09:48:39` lamalibre-app-e2e-apphost-ops.service is active  
✅ `09:48:39` …as a new process again (MainPID 1477 → 2261)  
✅ `09:48:39` …on the socket from boot: it listened through 1.2.0 and the rollback  
✅ `09:48:39` The pages come from 1.1.0  
✅ `09:48:39` …with the data kept throughout  
✅ `09:48:39` The relay package is 1.1.0 again  
✅ `09:48:39` The relay records agent half 1.1.0  
✅ `09:48:39` 1.1.0's approval stands  
✅ `09:48:39` 1.2.0 was asked, and refused  
✅ `09:48:39` Audit: plugin.agent-half.activated 1.1.0  
✅ `09:48:39` Audit: plugin.update.reverted  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `100` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `100` |

ℹ️ `09:48:39` Cleaning up test resources...  
