# Lamaste E2E: 35 — App plugin agent half: rotation, reboot, update (Three-VM)

> Started at `2026-11-09 12:58:32 UTC`


## Pre-flight

✅ `12:58:32` Onboarding is complete  
✅ `12:58:32` Agent test-agent is enrolled on the host  
✅ `12:58:32` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `12:58:32` The agent VM's lamaste-agent has the apphost command  
ℹ️ `12:58:32` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install and host the plugin (1.0.0)

✅ `12:58:33` Fixtures built: @lamalibre/e2e-apphost-ops-server 1.0.0, 1.1.0 and 1.2.0 (a bad release) with their agent packages  
✅ `12:58:54` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-ops-server, @lamalibre/e2e-apphost-ops-agent )  
✅ `12:58:54` The agent VM reaches it at http://10.13.37.1:4874  
✅ `12:58:55` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T12:58:55.485Z"})  
✅ `12:58:55` …through its own OIDC client  
✅ `12:58:59` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `12:59:04` Installed @lamalibre/e2e-apphost-ops-server@1.0.0 and approved its agent half  
✅ `12:59:14` Hosted on test-agent ()  
✅ `12:59:14` Agent half 1.0.0 answers through the tunnel as lamaste-app-e2e-apphost-ops  

## A rotation reaches the service's copy before it is acknowledged

✅ `12:59:14` lamalibre-app-e2e-apphost-ops.socket listens on 127.0.0.1:21000 (since Mon 2026-11-09 15:59:05 +03)  
✅ `12:59:15` The service's copy holds the current secret  
✅ `12:59:15` Rotation pending  
✅ `12:59:15` A new secret was issued  
✅ `12:59:15` Calls keep working while the rotation is pending  
✅ `12:59:18` The relay has the new secret acknowledged  
✅ `12:59:18` …and by then the service's copy held it: written before the acknowledgement  
✅ `12:59:18` /etc/lamalibre/apps/e2e-apphost-ops/plugin-config.json carries the new secret  
✅ `12:59:18` …the one the agent holds  
✅ `12:59:18` …still 0600, the account's  
✅ `12:59:18` The service was not restarted: it re-reads its config on a signature it cannot verify  
✅ `12:59:18` The socket unit's file is unchanged: a rotation does not move the port  
✅ `12:59:18` …and the socket kept listening (active since Mon 2026-11-09 15:59:05 +03)  
✅ `12:59:18` The agent's sync delivered it (sync.log)  
✅ `12:59:18` Calls work on the new secret  

## Systemd holds the port: the agent half stopped, restarted or killed

✅ `12:59:18` While the agent half runs, nobody can bind neither 127.0.0.1:21000 nor 0.0.0.0:21000  
✅ `12:59:18` systemctl stop lamalibre-app-e2e-apphost-ops.service: sampled while it stayed stopped  
✅ `12:59:18` lamalibre-app-e2e-apphost-ops.socket stays active, listening on 127.0.0.1:21000  
✅ `12:59:18` ss: systemd (pid 1) alone holds the port  
✅ `12:59:18` …and nobody can bind neither 127.0.0.1:21000 nor 0.0.0.0:21000: no window to take it  
✅ `12:59:19` A connection to the port finds the agent half again: systemd started it for the connection waiting on its socket  
✅ `12:59:19` lamalibre-app-e2e-apphost-ops.service is active again (MainPID 39374)  
✅ `12:59:19` The pages answer through the tunnel  
✅ `12:59:23` systemctl restart: a new agent half (MainPID 39374 → 39698)  
✅ `12:59:32` kill -9: Restart=always brings a new one (MainPID 39698 → 40014)  
✅ `12:59:45` The client made 140 requests across the restart and the kill (longest wait 5144 ms)  
✅ `12:59:45` …none refused: the port was never closed  
✅ `12:59:45` …every answer the agent half's (401 to a bare call)  
✅ `12:59:45` …at most the requests in flight at the two stops cut ({})  
✅ `12:59:45` lamalibre-app-e2e-apphost-ops.socket listened throughout: active since Mon 2026-11-09 15:59:05 +03  
✅ `12:59:45` The new agent half was handed the same listening socket (descriptor 3)  
✅ `12:59:45` The pages answer  

## A reboot of the agent VM brings it all back

ℹ️ `12:59:45` Restarting lamaste-agent  
✅ `13:00:02` The agent VM is back  
✅ `13:00:02` lamalibre-app-e2e-apphost-ops.service started at boot  
✅ `13:00:02` The tunnel is up again: the pages answer  
✅ `13:00:02` Agent half 1.0.0, as lamaste-app-e2e-apphost-ops  
✅ `13:00:02` Its data survived the reboot  
✅ `13:00:02` …and it was started again (start 5)  
✅ `13:00:02` …on systemd's socket, descriptor 3  
✅ `13:00:02` Its process is lamaste-app-e2e-apphost-ops's  
✅ `13:00:02` The service's copy kept the rotated secret  
✅ `13:00:02` lamalibre-app-e2e-apphost-ops.socket came back at boot, listening on 127.0.0.1:21000  
✅ `13:00:02` ss: the listening socket is systemd's and the agent half's (MainPID 644)  
✅ `13:00:02` The agent half's descriptor 3 is that socket  
✅ `13:00:02` The agent's sync timer runs again  
✅ `13:00:02` The relay's health of the hosting is up  

## Update to 1.1.0: approved, the new agent half first

✅ `13:00:03` The update waits for approval: its agent half changed  
✅ `13:00:03` …pinned to the integrity of @lamalibre/e2e-apphost-ops-agent@1.1.0  
✅ `13:00:03` Until it is approved, 1.0.0 stays  
✅ `13:00:10` The update succeeded ()  
✅ `13:00:10` Step: agent install:pre-tunnel  
✅ `13:00:10` Step: install the new agent half  
✅ `13:00:10` Step: install the new version  
✅ `13:00:10` Step: agent install:post-tunnel  
✅ `13:00:10` The agent half was switched before the relay package  
✅ `13:00:10` current → 1.1.0, previous → 1.0.0  
✅ `13:00:10` Both versions are kept  
✅ `13:00:10` lamalibre-app-e2e-apphost-ops.service is active  
✅ `13:00:10` …as a new process (MainPID 644 → 1497)  
✅ `13:00:10` …on the same socket: lamalibre-app-e2e-apphost-ops.socket listened throughout the update (since Mon 2026-11-09 15:59:57 +03)  
✅ `13:00:11` The pages come from 1.1.0  
✅ `13:00:11` …which found the data 1.0.0 left  
✅ `13:00:11` The relay package is 1.1.0  
✅ `13:00:11` The relay records agent half 1.1.0  
✅ `13:00:11` 1.0.0 answered the pre stage  
✅ `13:00:11` 1.1.0 answered the post stage  
✅ `13:00:11` Audit: plugin.agent-half.installed for the upgrade  

## Update to 1.2.0: its post stage fails, 1.1.0 comes back

✅ `13:00:11` 1.2.0 waits for approval  
✅ `13:00:25` The update was rolled back  
✅ `13:00:25` …because the 1.2.0 agent half refused its post stage  
✅ `13:00:25` 1.2.0 had been installed and activated  
✅ `13:00:25` Its post stage failed  
✅ `13:00:25` The relay package was restored  
✅ `13:00:25` The previous agent half was activated  
✅ `13:00:26` current → 1.1.0 again (previous → 1.2.0)  
✅ `13:00:26` Only the current and the previous version are kept  
✅ `13:00:26` lamalibre-app-e2e-apphost-ops.service is active  
✅ `13:00:26` …as a new process again (MainPID 1497 → 2281)  
✅ `13:00:26` …on the socket from boot: it listened through 1.2.0 and the rollback  
✅ `13:00:26` The pages come from 1.1.0  
✅ `13:00:26` …with the data kept throughout  
✅ `13:00:26` The relay package is 1.1.0 again  
✅ `13:00:26` The relay records agent half 1.1.0  
✅ `13:00:26` 1.1.0's approval stands  
✅ `13:00:26` 1.2.0 was asked, and refused  
✅ `13:00:26` Audit: plugin.agent-half.activated 1.1.0  
✅ `13:00:26` Audit: plugin.update.reverted  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `100` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `100` |

ℹ️ `13:00:26` Cleaning up test resources...  
