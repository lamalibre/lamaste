# Lamaste E2E: 35 — App plugin agent half: rotation, reboot, update (Three-VM)

> Started at `2026-11-10 13:21:12 UTC`


## Pre-flight

✅ `13:21:12` Onboarding is complete  
✅ `13:21:13` Agent test-agent is enrolled on the host  
✅ `13:21:13` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:21:13` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:21:13` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install and host the plugin (1.0.0)

✅ `13:21:14` Fixtures built: @lamalibre/e2e-apphost-ops-server 1.0.0, 1.1.0 and 1.2.0 (a bad release) with their agent packages  
✅ `13:21:36` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-ops-server, @lamalibre/e2e-apphost-ops-agent )  
✅ `13:21:36` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:21:37` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T13:21:37.582Z"})  
✅ `13:21:37` …through its own OIDC client  
✅ `13:21:41` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:21:47` Installed @lamalibre/e2e-apphost-ops-server@1.0.0 and approved its agent half  
✅ `13:21:57` Hosted on test-agent ()  
✅ `13:21:57` Agent half 1.0.0 answers through the tunnel as lamaste-app-e2e-apphost-ops  

## A rotation reaches the service's copy before it is acknowledged

✅ `13:21:58` lamalibre-app-e2e-apphost-ops.socket listens on 127.0.0.1:21000 (since Tue 2026-11-10 16:21:48 +03)  
✅ `13:21:58` The service's copy holds the current secret  
✅ `13:21:58` Rotation pending  
✅ `13:21:58` A new secret was issued  
✅ `13:21:59` Calls keep working while the rotation is pending  
✅ `13:22:02` The relay has the new secret acknowledged  
✅ `13:22:02` …and by then the service's copy held it: written before the acknowledgement  
✅ `13:22:02` /etc/lamalibre/apps/e2e-apphost-ops/plugin-config.json carries the new secret  
✅ `13:22:02` …the one the agent holds  
✅ `13:22:02` …still 0600, the account's  
✅ `13:22:02` The service was not restarted: it re-reads its config on a signature it cannot verify  
✅ `13:22:02` The socket unit's file is unchanged: a rotation does not move the port  
✅ `13:22:02` …and the socket kept listening (active since Tue 2026-11-10 16:21:48 +03)  
✅ `13:22:02` The agent's sync delivered it (sync.log)  
✅ `13:22:02` Calls work on the new secret  

## Systemd holds the port: the agent half stopped, restarted or killed

✅ `13:22:02` While the agent half runs, nobody can bind neither 127.0.0.1:21000 nor 0.0.0.0:21000  
✅ `13:22:03` systemctl stop lamalibre-app-e2e-apphost-ops.service: sampled while it stayed stopped  
✅ `13:22:03` lamalibre-app-e2e-apphost-ops.socket stays active, listening on 127.0.0.1:21000  
✅ `13:22:03` ss: systemd (pid 1) alone holds the port  
✅ `13:22:03` …and nobody can bind neither 127.0.0.1:21000 nor 0.0.0.0:21000: no window to take it  
✅ `13:22:03` A connection to the port finds the agent half again: systemd started it for the connection waiting on its socket  
✅ `13:22:03` lamalibre-app-e2e-apphost-ops.service is active again (MainPID 39385)  
✅ `13:22:04` The pages answer through the tunnel  
✅ `13:22:07` systemctl restart: a new agent half (MainPID 39385 → 39715)  
✅ `13:22:17` kill -9: Restart=always brings a new one (MainPID 39715 → 40046)  
✅ `13:22:30` The client made 113 requests across the restart and the kill (longest wait 5252 ms)  
✅ `13:22:30` …none refused: the port was never closed  
✅ `13:22:30` …every answer the agent half's (401 to a bare call)  
✅ `13:22:30` …at most the requests in flight at the two stops cut ({})  
✅ `13:22:30` lamalibre-app-e2e-apphost-ops.socket listened throughout: active since Tue 2026-11-10 16:21:48 +03  
✅ `13:22:31` The new agent half was handed the same listening socket (descriptor 3)  
✅ `13:22:31` The pages answer  

## A reboot of the agent VM brings it all back

ℹ️ `13:22:31` Restarting lamaste-agent  
✅ `13:22:47` The agent VM is back  
✅ `13:22:47` lamalibre-app-e2e-apphost-ops.service started at boot  
✅ `13:22:47` The tunnel is up again: the pages answer  
✅ `13:22:47` Agent half 1.0.0, as lamaste-app-e2e-apphost-ops  
✅ `13:22:47` Its data survived the reboot  
✅ `13:22:47` …and it was started again (start 5)  
✅ `13:22:47` …on systemd's socket, descriptor 3  
✅ `13:22:48` Its process is lamaste-app-e2e-apphost-ops's  
✅ `13:22:48` The service's copy kept the rotated secret  
✅ `13:22:48` lamalibre-app-e2e-apphost-ops.socket came back at boot, listening on 127.0.0.1:21000  
✅ `13:22:48` ss: the listening socket is systemd's and the agent half's (MainPID 646)  
✅ `13:22:48` The agent half's descriptor 3 is that socket  
✅ `13:22:48` The agent's sync timer runs again  
✅ `13:22:48` The relay's health of the hosting is up  

## Update to 1.1.0: approved, the new agent half first

✅ `13:22:48` The update waits for approval: its agent half changed  
✅ `13:22:49` …pinned to the integrity of @lamalibre/e2e-apphost-ops-agent@1.1.0  
✅ `13:22:49` Until it is approved, 1.0.0 stays  
✅ `13:22:56` The update succeeded ()  
✅ `13:22:56` Step: agent install:pre-tunnel  
✅ `13:22:56` Step: install the new agent half  
✅ `13:22:56` Step: install the new version  
✅ `13:22:56` Step: agent install:post-tunnel  
✅ `13:22:56` The agent half was switched before the relay package  
✅ `13:22:57` current → 1.1.0, previous → 1.0.0  
✅ `13:22:57` Both versions are kept  
✅ `13:22:57` lamalibre-app-e2e-apphost-ops.service is active  
✅ `13:22:57` …as a new process (MainPID 646 → 1427)  
✅ `13:22:57` …on the same socket: lamalibre-app-e2e-apphost-ops.socket listened throughout the update (since Tue 2026-11-10 16:22:47 +03)  
✅ `13:22:57` The pages come from 1.1.0  
✅ `13:22:57` …which found the data 1.0.0 left  
✅ `13:22:57` The relay package is 1.1.0  
✅ `13:22:57` The relay records agent half 1.1.0  
✅ `13:22:57` 1.0.0 answered the pre stage  
✅ `13:22:57` 1.1.0 answered the post stage  
✅ `13:22:57` Audit: plugin.agent-half.installed for the upgrade  

## Update to 1.2.0: its post stage fails, 1.1.0 comes back

✅ `13:22:58` 1.2.0 waits for approval  
✅ `13:23:17` The update was rolled back  
✅ `13:23:17` …because the 1.2.0 agent half refused its post stage  
✅ `13:23:17` 1.2.0 had been installed and activated  
✅ `13:23:17` Its post stage failed  
✅ `13:23:17` The relay package was restored  
✅ `13:23:17` The previous agent half was activated  
✅ `13:23:17` current → 1.1.0 again (previous → 1.2.0)  
✅ `13:23:17` Only the current and the previous version are kept  
✅ `13:23:17` lamalibre-app-e2e-apphost-ops.service is active  
✅ `13:23:17` …as a new process again (MainPID 1427 → 2289)  
✅ `13:23:17` …on the socket from boot: it listened through 1.2.0 and the rollback  
✅ `13:23:17` The pages come from 1.1.0  
✅ `13:23:17` …with the data kept throughout  
✅ `13:23:17` The relay package is 1.1.0 again  
✅ `13:23:17` The relay records agent half 1.1.0  
✅ `13:23:18` 1.1.0's approval stands  
✅ `13:23:18` 1.2.0 was asked, and refused  
✅ `13:23:18` Audit: plugin.agent-half.activated 1.1.0  
✅ `13:23:18` Audit: plugin.update.reverted  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `100` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `100` |

ℹ️ `13:23:18` Cleaning up test resources...  
