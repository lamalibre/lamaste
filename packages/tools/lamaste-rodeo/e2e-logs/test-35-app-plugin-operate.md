# Lamaste E2E: 35 — App plugin agent half: rotation, reboot, update (Three-VM)

> Started at `2026-11-04 13:51:16 UTC`


## Pre-flight

✅ `13:51:16` Onboarding is complete  
✅ `13:51:17` Agent test-agent is enrolled on the host  
✅ `13:51:17` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:51:17` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:51:17` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install and host the plugin (1.0.0)

✅ `13:51:19` Fixtures built: @lamalibre/e2e-apphost-ops-server 1.0.0, 1.1.0 and 1.2.0 (a bad release) with their agent packages  
✅ `13:51:25` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-ops-server, @lamalibre/e2e-apphost-ops-agent )  
✅ `13:51:25` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:51:27` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T13:51:27.473Z"})  
✅ `13:51:27` …through its own OIDC client  
✅ `13:51:32` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:51:34` Installed @lamalibre/e2e-apphost-ops-server@1.0.0 and approved its agent half  
✅ `13:51:46` Hosted on test-agent ()  
✅ `13:51:46` Agent half 1.0.0 answers through the tunnel as lamaste-app-e2e-apphost-ops  

## A rotation reaches the service's copy before it is acknowledged

✅ `13:51:46` lamalibre-app-e2e-apphost-ops.socket listens on 127.0.0.1:21000 (since Wed 2026-11-04 16:51:38 +03)  
✅ `13:51:47` The service's copy holds the current secret  
✅ `13:51:47` Rotation pending  
✅ `13:51:47` A new secret was issued  
✅ `13:51:47` Calls keep working while the rotation is pending  
✅ `13:51:50` The relay has the new secret acknowledged  
✅ `13:51:50` …and by then the service's copy held it: written before the acknowledgement  
✅ `13:51:51` /etc/lamalibre/apps/e2e-apphost-ops/plugin-config.json carries the new secret  
✅ `13:51:51` …the one the agent holds  
✅ `13:51:51` …still 0600, the account's  
✅ `13:51:51` The service was not restarted: it re-reads its config on a signature it cannot verify  
✅ `13:51:51` The socket unit's file is unchanged: a rotation does not move the port  
✅ `13:51:51` …and the socket kept listening (active since Wed 2026-11-04 16:51:38 +03)  
✅ `13:51:51` The agent's sync delivered it (sync.log)  
✅ `13:51:51` Calls work on the new secret  

## Systemd holds the port: the agent half stopped, restarted or killed

✅ `13:51:51` While the agent half runs, nobody can bind neither 127.0.0.1:21000 nor 0.0.0.0:21000  
✅ `13:51:52` systemctl stop lamalibre-app-e2e-apphost-ops.service: sampled while it stayed stopped  
✅ `13:51:52` lamalibre-app-e2e-apphost-ops.socket stays active, listening on 127.0.0.1:21000  
✅ `13:51:52` ss: systemd (pid 1) alone holds the port  
✅ `13:51:52` …and nobody can bind neither 127.0.0.1:21000 nor 0.0.0.0:21000: no window to take it  
✅ `13:51:52` A connection to the port finds the agent half again: systemd started it for the connection waiting on its socket  
✅ `13:51:53` lamalibre-app-e2e-apphost-ops.service is active again (MainPID 38992)  
✅ `13:51:53` The pages answer through the tunnel  
✅ `13:51:57` systemctl restart: a new agent half (MainPID 38992 → 39316)  
✅ `13:52:06` kill -9: Restart=always brings a new one (MainPID 39316 → 39633)  
✅ `13:52:20` The client made 143 requests across the restart and the kill (longest wait 5188 ms)  
✅ `13:52:20` …none refused: the port was never closed  
✅ `13:52:20` …every answer the agent half's (401 to a bare call)  
✅ `13:52:20` …at most the requests in flight at the two stops cut ({})  
✅ `13:52:20` lamalibre-app-e2e-apphost-ops.socket listened throughout: active since Wed 2026-11-04 16:51:38 +03  
✅ `13:52:20` The new agent half was handed the same listening socket (descriptor 3)  
✅ `13:52:21` The pages answer  

## A reboot of the agent VM brings it all back

ℹ️ `13:52:21` Restarting lamaste-agent  
✅ `13:52:45` The agent VM is back  
✅ `13:52:45` lamalibre-app-e2e-apphost-ops.service started at boot  
✅ `13:52:45` The tunnel is up again: the pages answer  
✅ `13:52:45` Agent half 1.0.0, as lamaste-app-e2e-apphost-ops  
✅ `13:52:45` Its data survived the reboot  
✅ `13:52:45` …and it was started again (start 5)  
✅ `13:52:45` …on systemd's socket, descriptor 3  
✅ `13:52:46` Its process is lamaste-app-e2e-apphost-ops's  
✅ `13:52:46` The service's copy kept the rotated secret  
✅ `13:52:46` lamalibre-app-e2e-apphost-ops.socket came back at boot, listening on 127.0.0.1:21000  
✅ `13:52:46` ss: the listening socket is systemd's and the agent half's (MainPID 644)  
✅ `13:52:47` The agent half's descriptor 3 is that socket  
✅ `13:52:47` The agent's sync timer runs again  
✅ `13:52:47` The relay's health of the hosting is up  

## Update to 1.1.0: approved, the new agent half first

✅ `13:52:48` The update waits for approval: its agent half changed  
✅ `13:52:48` …pinned to the integrity of @lamalibre/e2e-apphost-ops-agent@1.1.0  
✅ `13:52:48` Until it is approved, 1.0.0 stays  
✅ `13:52:53` The update succeeded ()  
✅ `13:52:53` Step: agent install:pre-tunnel  
✅ `13:52:53` Step: install the new agent half  
✅ `13:52:53` Step: install the new version  
✅ `13:52:53` Step: agent install:post-tunnel  
✅ `13:52:53` The agent half was switched before the relay package  
✅ `13:52:53` current → 1.1.0, previous → 1.0.0  
✅ `13:52:53` Both versions are kept  
✅ `13:52:53` lamalibre-app-e2e-apphost-ops.service is active  
✅ `13:52:53` …as a new process (MainPID 644 → 1493)  
✅ `13:52:54` …on the same socket: lamalibre-app-e2e-apphost-ops.socket listened throughout the update (since Wed 2026-11-04 16:52:40 +03)  
✅ `13:52:54` The pages come from 1.1.0  
✅ `13:52:54` …which found the data 1.0.0 left  
✅ `13:52:54` The relay package is 1.1.0  
✅ `13:52:54` The relay records agent half 1.1.0  
✅ `13:52:54` 1.0.0 answered the pre stage  
✅ `13:52:54` 1.1.0 answered the post stage  
✅ `13:52:55` Audit: plugin.agent-half.installed for the upgrade  

## Update to 1.2.0: its post stage fails, 1.1.0 comes back

✅ `13:52:55` 1.2.0 waits for approval  
✅ `13:53:05` The update was rolled back  
✅ `13:53:05` …because the 1.2.0 agent half refused its post stage  
✅ `13:53:05` 1.2.0 had been installed and activated  
✅ `13:53:05` Its post stage failed  
✅ `13:53:05` The relay package was restored  
✅ `13:53:05` The previous agent half was activated  
✅ `13:53:05` current → 1.1.0 again (previous → 1.2.0)  
✅ `13:53:05` Only the current and the previous version are kept  
✅ `13:53:05` lamalibre-app-e2e-apphost-ops.service is active  
✅ `13:53:05` …as a new process again (MainPID 1493 → 2068)  
✅ `13:53:05` …on the socket from boot: it listened through 1.2.0 and the rollback  
✅ `13:53:06` The pages come from 1.1.0  
✅ `13:53:06` …with the data kept throughout  
✅ `13:53:06` The relay package is 1.1.0 again  
✅ `13:53:06` The relay records agent half 1.1.0  
✅ `13:53:06` 1.1.0's approval stands  
✅ `13:53:07` 1.2.0 was asked, and refused  
✅ `13:53:07` Audit: plugin.agent-half.activated 1.1.0  
✅ `13:53:07` Audit: plugin.update.reverted  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `100` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `100` |

ℹ️ `13:53:07` Cleaning up test resources...  
