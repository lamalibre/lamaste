# Lamaste E2E: 35 — App plugin agent half: rotation, reboot, update (Three-VM)

> Started at `2026-11-11 10:56:38 UTC`


## Pre-flight

✅ `10:56:38` Onboarding is complete  
✅ `10:56:38` Agent test-agent is enrolled on the host  
✅ `10:56:38` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:56:39` The agent VM's lamaste-agent has the apphost command  
ℹ️ `10:56:39` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install and host the plugin (1.0.0)

✅ `10:56:39` Fixtures built: @lamalibre/e2e-apphost-ops-server 1.0.0, 1.1.0 and 1.2.0 (a bad release) with their agent packages  
✅ `10:57:01` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-ops-server, @lamalibre/e2e-apphost-ops-agent )  
✅ `10:57:01` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:57:03` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T10:57:03.198Z"})  
✅ `10:57:03` …through its own OIDC client  
✅ `10:57:03` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:57:09` Installed @lamalibre/e2e-apphost-ops-server@1.0.0 and approved its agent half  
✅ `10:57:20` Hosted on test-agent ()  
✅ `10:57:20` Agent half 1.0.0 answers through the tunnel as lamaste-app-e2e-apphost-ops  

## A rotation reaches the service's copy before it is acknowledged

✅ `10:57:20` lamalibre-app-e2e-apphost-ops.socket listens on 127.0.0.1:21000 (since Wed 2026-11-11 13:57:10 +03)  
✅ `10:57:20` The service's copy holds the current secret  
✅ `10:57:21` Rotation pending  
✅ `10:57:21` A new secret was issued  
✅ `10:57:21` Calls keep working while the rotation is pending  
✅ `10:57:24` The relay has the new secret acknowledged  
✅ `10:57:24` …and by then the service's copy held it: written before the acknowledgement  
✅ `10:57:24` /etc/lamalibre/apps/e2e-apphost-ops/plugin-config.json carries the new secret  
✅ `10:57:24` …the one the agent holds  
✅ `10:57:24` …still 0600, the account's  
✅ `10:57:24` The service was not restarted: it re-reads its config on a signature it cannot verify  
✅ `10:57:24` The socket unit's file is unchanged: a rotation does not move the port  
✅ `10:57:24` …and the socket kept listening (active since Wed 2026-11-11 13:57:10 +03)  
✅ `10:57:24` The agent's sync delivered it (sync.log)  
✅ `10:57:24` Calls work on the new secret  

## Systemd holds the port: the agent half stopped, restarted or killed

✅ `10:57:24` While the agent half runs, nobody can bind neither 127.0.0.1:21000 nor 0.0.0.0:21000  
✅ `10:57:25` systemctl stop lamalibre-app-e2e-apphost-ops.service: sampled while it stayed stopped  
✅ `10:57:25` lamalibre-app-e2e-apphost-ops.socket stays active, listening on 127.0.0.1:21000  
✅ `10:57:25` ss: systemd (pid 1) alone holds the port  
✅ `10:57:25` …and nobody can bind neither 127.0.0.1:21000 nor 0.0.0.0:21000: no window to take it  
✅ `10:57:25` A connection to the port finds the agent half again: systemd started it for the connection waiting on its socket  
✅ `10:57:25` lamalibre-app-e2e-apphost-ops.service is active again (MainPID 36417)  
✅ `10:57:25` The pages answer through the tunnel  
✅ `10:57:30` systemctl restart: a new agent half (MainPID 36417 → 36749)  
✅ `10:57:39` kill -9: Restart=always brings a new one (MainPID 36749 → 37079)  
✅ `10:57:52` The client made 119 requests across the restart and the kill (longest wait 5251 ms)  
✅ `10:57:52` …none refused: the port was never closed  
✅ `10:57:52` …every answer the agent half's (401 to a bare call)  
✅ `10:57:52` …at most the requests in flight at the two stops cut ({})  
✅ `10:57:52` lamalibre-app-e2e-apphost-ops.socket listened throughout: active since Wed 2026-11-11 13:57:10 +03  
✅ `10:57:52` The new agent half was handed the same listening socket (descriptor 3)  
✅ `10:57:53` The pages answer  

## A reboot of the agent VM brings it all back

ℹ️ `10:57:53` Restarting lamaste-agent  
✅ `10:58:12` The agent VM is back  
✅ `10:58:12` lamalibre-app-e2e-apphost-ops.service started at boot  
✅ `10:58:12` The tunnel is up again: the pages answer  
✅ `10:58:12` Agent half 1.0.0, as lamaste-app-e2e-apphost-ops  
✅ `10:58:12` Its data survived the reboot  
✅ `10:58:12` …and it was started again (start 5)  
✅ `10:58:12` …on systemd's socket, descriptor 3  
✅ `10:58:13` Its process is lamaste-app-e2e-apphost-ops's  
✅ `10:58:13` The service's copy kept the rotated secret  
✅ `10:58:13` lamalibre-app-e2e-apphost-ops.socket came back at boot, listening on 127.0.0.1:21000  
✅ `10:58:13` ss: the listening socket is systemd's and the agent half's (MainPID 646)  
✅ `10:58:13` The agent half's descriptor 3 is that socket  
✅ `10:58:13` The agent's sync timer runs again  
✅ `10:58:13` The relay's health of the hosting is up  

## Update to 1.1.0: approved, the new agent half first

✅ `10:58:14` The update waits for approval: its agent half changed  
✅ `10:58:14` …pinned to the integrity of @lamalibre/e2e-apphost-ops-agent@1.1.0  
✅ `10:58:14` Until it is approved, 1.0.0 stays  
✅ `10:58:22` The update succeeded ()  
✅ `10:58:22` Step: agent install:pre-tunnel  
✅ `10:58:22` Step: install the new agent half  
✅ `10:58:22` Step: install the new version  
✅ `10:58:22` Step: agent install:post-tunnel  
✅ `10:58:22` The agent half was switched before the relay package  
✅ `10:58:22` current → 1.1.0, previous → 1.0.0  
✅ `10:58:22` Both versions are kept  
✅ `10:58:22` lamalibre-app-e2e-apphost-ops.service is active  
✅ `10:58:22` …as a new process (MainPID 646 → 1480)  
✅ `10:58:22` …on the same socket: lamalibre-app-e2e-apphost-ops.socket listened throughout the update (since Wed 2026-11-11 13:58:08 +03)  
✅ `10:58:22` The pages come from 1.1.0  
✅ `10:58:22` …which found the data 1.0.0 left  
✅ `10:58:22` The relay package is 1.1.0  
✅ `10:58:23` The relay records agent half 1.1.0  
✅ `10:58:23` 1.0.0 answered the pre stage  
✅ `10:58:23` 1.1.0 answered the post stage  
✅ `10:58:23` Audit: plugin.agent-half.installed for the upgrade  

## Update to 1.2.0: its post stage fails, 1.1.0 comes back

✅ `10:58:23` 1.2.0 waits for approval  
✅ `10:58:39` The update was rolled back  
✅ `10:58:39` …because the 1.2.0 agent half refused its post stage  
✅ `10:58:39` 1.2.0 had been installed and activated  
✅ `10:58:39` Its post stage failed  
✅ `10:58:39` The relay package was restored  
✅ `10:58:39` The previous agent half was activated  
✅ `10:58:39` current → 1.1.0 again (previous → 1.2.0)  
✅ `10:58:39` Only the current and the previous version are kept  
✅ `10:58:39` lamalibre-app-e2e-apphost-ops.service is active  
✅ `10:58:39` …as a new process again (MainPID 1480 → 2274)  
✅ `10:58:39` …on the socket from boot: it listened through 1.2.0 and the rollback  
✅ `10:58:39` The pages come from 1.1.0  
✅ `10:58:39` …with the data kept throughout  
✅ `10:58:39` The relay package is 1.1.0 again  
✅ `10:58:39` The relay records agent half 1.1.0  
✅ `10:58:40` 1.1.0's approval stands  
✅ `10:58:40` 1.2.0 was asked, and refused  
✅ `10:58:40` Audit: plugin.agent-half.activated 1.1.0  
✅ `10:58:40` Audit: plugin.update.reverted  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `100` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `100` |

ℹ️ `10:58:40` Cleaning up test resources...  
