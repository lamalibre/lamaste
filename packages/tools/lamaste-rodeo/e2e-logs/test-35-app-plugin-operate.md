# Lamaste E2E: 35 — App plugin agent half: rotation, reboot, update (Three-VM)

> Started at `2026-11-10 18:03:20 UTC`


## Pre-flight

✅ `18:03:20` Onboarding is complete  
✅ `18:03:20` Agent test-agent is enrolled on the host  
✅ `18:03:21` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `18:03:21` The agent VM's lamaste-agent has the apphost command  
ℹ️ `18:03:21` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install and host the plugin (1.0.0)

✅ `18:03:21` Fixtures built: @lamalibre/e2e-apphost-ops-server 1.0.0, 1.1.0 and 1.2.0 (a bad release) with their agent packages  
✅ `18:03:43` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-ops-server, @lamalibre/e2e-apphost-ops-agent )  
✅ `18:03:43` The agent VM reaches it at http://10.13.37.1:4874  
✅ `18:03:45` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T18:03:45.064Z"})  
✅ `18:03:45` …through its own OIDC client  
✅ `18:03:49` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `18:03:54` Installed @lamalibre/e2e-apphost-ops-server@1.0.0 and approved its agent half  
✅ `18:04:05` Hosted on test-agent ()  
✅ `18:04:05` Agent half 1.0.0 answers through the tunnel as lamaste-app-e2e-apphost-ops  

## A rotation reaches the service's copy before it is acknowledged

✅ `18:04:06` lamalibre-app-e2e-apphost-ops.socket listens on 127.0.0.1:21000 (since Tue 2026-11-10 21:03:56 +03)  
✅ `18:04:06` The service's copy holds the current secret  
✅ `18:04:06` Rotation pending  
✅ `18:04:06` A new secret was issued  
✅ `18:04:06` Calls keep working while the rotation is pending  
✅ `18:04:09` The relay has the new secret acknowledged  
✅ `18:04:09` …and by then the service's copy held it: written before the acknowledgement  
✅ `18:04:09` /etc/lamalibre/apps/e2e-apphost-ops/plugin-config.json carries the new secret  
✅ `18:04:09` …the one the agent holds  
✅ `18:04:09` …still 0600, the account's  
✅ `18:04:09` The service was not restarted: it re-reads its config on a signature it cannot verify  
✅ `18:04:09` The socket unit's file is unchanged: a rotation does not move the port  
✅ `18:04:09` …and the socket kept listening (active since Tue 2026-11-10 21:03:56 +03)  
✅ `18:04:10` The agent's sync delivered it (sync.log)  
✅ `18:04:10` Calls work on the new secret  

## Systemd holds the port: the agent half stopped, restarted or killed

✅ `18:04:10` While the agent half runs, nobody can bind neither 127.0.0.1:21000 nor 0.0.0.0:21000  
✅ `18:04:10` systemctl stop lamalibre-app-e2e-apphost-ops.service: sampled while it stayed stopped  
✅ `18:04:10` lamalibre-app-e2e-apphost-ops.socket stays active, listening on 127.0.0.1:21000  
✅ `18:04:10` ss: systemd (pid 1) alone holds the port  
✅ `18:04:10` …and nobody can bind neither 127.0.0.1:21000 nor 0.0.0.0:21000: no window to take it  
✅ `18:04:10` A connection to the port finds the agent half again: systemd started it for the connection waiting on its socket  
✅ `18:04:11` lamalibre-app-e2e-apphost-ops.service is active again (MainPID 39104)  
✅ `18:04:11` The pages answer through the tunnel  
✅ `18:04:15` systemctl restart: a new agent half (MainPID 39104 → 39478)  
✅ `18:04:24` kill -9: Restart=always brings a new one (MainPID 39478 → 39826)  
✅ `18:04:38` The client made 116 requests across the restart and the kill (longest wait 5148 ms)  
✅ `18:04:38` …none refused: the port was never closed  
✅ `18:04:38` …every answer the agent half's (401 to a bare call)  
✅ `18:04:38` …at most the requests in flight at the two stops cut ({})  
✅ `18:04:38` lamalibre-app-e2e-apphost-ops.socket listened throughout: active since Tue 2026-11-10 21:03:56 +03  
✅ `18:04:38` The new agent half was handed the same listening socket (descriptor 3)  
✅ `18:04:38` The pages answer  

## A reboot of the agent VM brings it all back

ℹ️ `18:04:38` Restarting lamaste-agent  
✅ `18:04:54` The agent VM is back  
✅ `18:04:54` lamalibre-app-e2e-apphost-ops.service started at boot  
✅ `18:04:54` The tunnel is up again: the pages answer  
✅ `18:04:54` Agent half 1.0.0, as lamaste-app-e2e-apphost-ops  
✅ `18:04:54` Its data survived the reboot  
✅ `18:04:54` …and it was started again (start 5)  
✅ `18:04:54` …on systemd's socket, descriptor 3  
✅ `18:04:54` Its process is lamaste-app-e2e-apphost-ops's  
✅ `18:04:54` The service's copy kept the rotated secret  
✅ `18:04:54` lamalibre-app-e2e-apphost-ops.socket came back at boot, listening on 127.0.0.1:21000  
✅ `18:04:54` ss: the listening socket is systemd's and the agent half's (MainPID 645)  
✅ `18:04:54` The agent half's descriptor 3 is that socket  
✅ `18:04:55` The agent's sync timer runs again  
✅ `18:04:55` The relay's health of the hosting is up  

## Update to 1.1.0: approved, the new agent half first

✅ `18:04:55` The update waits for approval: its agent half changed  
✅ `18:04:55` …pinned to the integrity of @lamalibre/e2e-apphost-ops-agent@1.1.0  
✅ `18:04:55` Until it is approved, 1.0.0 stays  
✅ `18:05:03` The update succeeded ()  
✅ `18:05:03` Step: agent install:pre-tunnel  
✅ `18:05:03` Step: install the new agent half  
✅ `18:05:03` Step: install the new version  
✅ `18:05:03` Step: agent install:post-tunnel  
✅ `18:05:03` The agent half was switched before the relay package  
✅ `18:05:04` current → 1.1.0, previous → 1.0.0  
✅ `18:05:04` Both versions are kept  
✅ `18:05:04` lamalibre-app-e2e-apphost-ops.service is active  
✅ `18:05:04` …as a new process (MainPID 645 → 1425)  
✅ `18:05:04` …on the same socket: lamalibre-app-e2e-apphost-ops.socket listened throughout the update (since Tue 2026-11-10 21:04:53 +03)  
✅ `18:05:04` The pages come from 1.1.0  
✅ `18:05:04` …which found the data 1.0.0 left  
✅ `18:05:04` The relay package is 1.1.0  
✅ `18:05:04` The relay records agent half 1.1.0  
✅ `18:05:04` 1.0.0 answered the pre stage  
✅ `18:05:04` 1.1.0 answered the post stage  
✅ `18:05:04` Audit: plugin.agent-half.installed for the upgrade  

## Update to 1.2.0: its post stage fails, 1.1.0 comes back

✅ `18:05:05` 1.2.0 waits for approval  
✅ `18:05:20` The update was rolled back  
✅ `18:05:20` …because the 1.2.0 agent half refused its post stage  
✅ `18:05:20` 1.2.0 had been installed and activated  
✅ `18:05:20` Its post stage failed  
✅ `18:05:20` The relay package was restored  
✅ `18:05:20` The previous agent half was activated  
✅ `18:05:20` current → 1.1.0 again (previous → 1.2.0)  
✅ `18:05:20` Only the current and the previous version are kept  
✅ `18:05:20` lamalibre-app-e2e-apphost-ops.service is active  
✅ `18:05:20` …as a new process again (MainPID 1425 → 2212)  
✅ `18:05:20` …on the socket from boot: it listened through 1.2.0 and the rollback  
✅ `18:05:20` The pages come from 1.1.0  
✅ `18:05:20` …with the data kept throughout  
✅ `18:05:20` The relay package is 1.1.0 again  
✅ `18:05:20` The relay records agent half 1.1.0  
✅ `18:05:20` 1.1.0's approval stands  
✅ `18:05:21` 1.2.0 was asked, and refused  
✅ `18:05:21` Audit: plugin.agent-half.activated 1.1.0  
✅ `18:05:21` Audit: plugin.update.reverted  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `100` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `100` |

ℹ️ `18:05:21` Cleaning up test resources...  
