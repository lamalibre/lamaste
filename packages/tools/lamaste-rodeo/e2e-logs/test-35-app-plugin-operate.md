# Lamaste E2E: 35 — App plugin agent half: rotation, reboot, update (Three-VM)

> Started at `2026-11-10 09:06:44 UTC`


## Pre-flight

✅ `09:06:45` Onboarding is complete  
✅ `09:06:45` Agent test-agent is enrolled on the host  
✅ `09:06:45` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `09:06:45` The agent VM's lamaste-agent has the apphost command  
ℹ️ `09:06:45` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install and host the plugin (1.0.0)

✅ `09:06:46` Fixtures built: @lamalibre/e2e-apphost-ops-server 1.0.0, 1.1.0 and 1.2.0 (a bad release) with their agent packages  
✅ `09:07:08` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-ops-server, @lamalibre/e2e-apphost-ops-agent )  
✅ `09:07:08` The agent VM reaches it at http://10.13.37.1:4874  
✅ `09:07:10` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T09:07:10.085Z"})  
✅ `09:07:10` …through its own OIDC client  
✅ `09:07:14` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `09:07:19` Installed @lamalibre/e2e-apphost-ops-server@1.0.0 and approved its agent half  
✅ `09:07:30` Hosted on test-agent ()  
✅ `09:07:30` Agent half 1.0.0 answers through the tunnel as lamaste-app-e2e-apphost-ops  

## A rotation reaches the service's copy before it is acknowledged

✅ `09:07:31` lamalibre-app-e2e-apphost-ops.socket listens on 127.0.0.1:21000 (since Tue 2026-11-10 12:07:21 +03)  
✅ `09:07:31` The service's copy holds the current secret  
✅ `09:07:31` Rotation pending  
✅ `09:07:31` A new secret was issued  
✅ `09:07:31` Calls keep working while the rotation is pending  
✅ `09:07:34` The relay has the new secret acknowledged  
✅ `09:07:34` …and by then the service's copy held it: written before the acknowledgement  
✅ `09:07:34` /etc/lamalibre/apps/e2e-apphost-ops/plugin-config.json carries the new secret  
✅ `09:07:34` …the one the agent holds  
✅ `09:07:34` …still 0600, the account's  
✅ `09:07:34` The service was not restarted: it re-reads its config on a signature it cannot verify  
✅ `09:07:34` The socket unit's file is unchanged: a rotation does not move the port  
✅ `09:07:34` …and the socket kept listening (active since Tue 2026-11-10 12:07:21 +03)  
✅ `09:07:35` The agent's sync delivered it (sync.log)  
✅ `09:07:35` Calls work on the new secret  

## Systemd holds the port: the agent half stopped, restarted or killed

✅ `09:07:35` While the agent half runs, nobody can bind neither 127.0.0.1:21000 nor 0.0.0.0:21000  
✅ `09:07:35` systemctl stop lamalibre-app-e2e-apphost-ops.service: sampled while it stayed stopped  
✅ `09:07:35` lamalibre-app-e2e-apphost-ops.socket stays active, listening on 127.0.0.1:21000  
✅ `09:07:35` ss: systemd (pid 1) alone holds the port  
✅ `09:07:35` …and nobody can bind neither 127.0.0.1:21000 nor 0.0.0.0:21000: no window to take it  
✅ `09:07:36` A connection to the port finds the agent half again: systemd started it for the connection waiting on its socket  
✅ `09:07:36` lamalibre-app-e2e-apphost-ops.service is active again (MainPID 20370)  
✅ `09:07:36` The pages answer through the tunnel  
✅ `09:07:40` systemctl restart: a new agent half (MainPID 20370 → 20694)  
✅ `09:07:49` kill -9: Restart=always brings a new one (MainPID 20694 → 21018)  
✅ `09:08:03` The client made 138 requests across the restart and the kill (longest wait 5079 ms)  
✅ `09:08:03` …none refused: the port was never closed  
✅ `09:08:03` …every answer the agent half's (401 to a bare call)  
✅ `09:08:03` …at most the requests in flight at the two stops cut ({})  
✅ `09:08:03` lamalibre-app-e2e-apphost-ops.socket listened throughout: active since Tue 2026-11-10 12:07:21 +03  
✅ `09:08:03` The new agent half was handed the same listening socket (descriptor 3)  
✅ `09:08:03` The pages answer  

## A reboot of the agent VM brings it all back

ℹ️ `09:08:03` Restarting lamaste-agent  
✅ `09:08:22` The agent VM is back  
✅ `09:08:22` lamalibre-app-e2e-apphost-ops.service started at boot  
✅ `09:08:22` The tunnel is up again: the pages answer  
✅ `09:08:22` Agent half 1.0.0, as lamaste-app-e2e-apphost-ops  
✅ `09:08:22` Its data survived the reboot  
✅ `09:08:22` …and it was started again (start 5)  
✅ `09:08:22` …on systemd's socket, descriptor 3  
✅ `09:08:23` Its process is lamaste-app-e2e-apphost-ops's  
✅ `09:08:23` The service's copy kept the rotated secret  
✅ `09:08:23` lamalibre-app-e2e-apphost-ops.socket came back at boot, listening on 127.0.0.1:21000  
✅ `09:08:23` ss: the listening socket is systemd's and the agent half's (MainPID 645)  
✅ `09:08:23` The agent half's descriptor 3 is that socket  
✅ `09:08:23` The agent's sync timer runs again  
✅ `09:08:23` The relay's health of the hosting is up  

## Update to 1.1.0: approved, the new agent half first

✅ `09:08:23` The update waits for approval: its agent half changed  
✅ `09:08:24` …pinned to the integrity of @lamalibre/e2e-apphost-ops-agent@1.1.0  
✅ `09:08:24` Until it is approved, 1.0.0 stays  
✅ `09:08:31` The update succeeded ()  
✅ `09:08:31` Step: agent install:pre-tunnel  
✅ `09:08:31` Step: install the new agent half  
✅ `09:08:31` Step: install the new version  
✅ `09:08:31` Step: agent install:post-tunnel  
✅ `09:08:32` The agent half was switched before the relay package  
✅ `09:08:32` current → 1.1.0, previous → 1.0.0  
✅ `09:08:32` Both versions are kept  
✅ `09:08:32` lamalibre-app-e2e-apphost-ops.service is active  
✅ `09:08:32` …as a new process (MainPID 645 → 1477)  
✅ `09:08:32` …on the same socket: lamalibre-app-e2e-apphost-ops.socket listened throughout the update (since Tue 2026-11-10 12:08:18 +03)  
✅ `09:08:32` The pages come from 1.1.0  
✅ `09:08:32` …which found the data 1.0.0 left  
✅ `09:08:32` The relay package is 1.1.0  
✅ `09:08:32` The relay records agent half 1.1.0  
✅ `09:08:32` 1.0.0 answered the pre stage  
✅ `09:08:32` 1.1.0 answered the post stage  
✅ `09:08:32` Audit: plugin.agent-half.installed for the upgrade  

## Update to 1.2.0: its post stage fails, 1.1.0 comes back

✅ `09:08:33` 1.2.0 waits for approval  
✅ `09:08:48` The update was rolled back  
✅ `09:08:48` …because the 1.2.0 agent half refused its post stage  
✅ `09:08:48` 1.2.0 had been installed and activated  
✅ `09:08:48` Its post stage failed  
✅ `09:08:48` The relay package was restored  
✅ `09:08:48` The previous agent half was activated  
✅ `09:08:48` current → 1.1.0 again (previous → 1.2.0)  
✅ `09:08:48` Only the current and the previous version are kept  
✅ `09:08:48` lamalibre-app-e2e-apphost-ops.service is active  
✅ `09:08:48` …as a new process again (MainPID 1477 → 2271)  
✅ `09:08:48` …on the socket from boot: it listened through 1.2.0 and the rollback  
✅ `09:08:49` The pages come from 1.1.0  
✅ `09:08:49` …with the data kept throughout  
✅ `09:08:49` The relay package is 1.1.0 again  
✅ `09:08:49` The relay records agent half 1.1.0  
✅ `09:08:49` 1.1.0's approval stands  
✅ `09:08:49` 1.2.0 was asked, and refused  
✅ `09:08:49` Audit: plugin.agent-half.activated 1.1.0  
✅ `09:08:49` Audit: plugin.update.reverted  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `100` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `100` |

ℹ️ `09:08:49` Cleaning up test resources...  
