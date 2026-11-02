# Lamaste E2E: 35 — App plugin agent half: rotation, reboot, update (Three-VM)

> Started at `2026-11-02 16:06:02 UTC`


## Pre-flight

✅ `16:06:02` Onboarding is complete  
✅ `16:06:02` Agent test-agent is enrolled on the host  
✅ `16:06:03` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `16:06:03` The agent VM's lamaste-agent has the apphost command  
ℹ️ `16:06:03` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install and host the plugin (1.0.0)

✅ `16:06:03` Fixtures built: @lamalibre/e2e-apphost-ops-server 1.0.0, 1.1.0 and 1.2.0 (a bad release) with their agent packages  
✅ `16:06:07` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-ops-server, @lamalibre/e2e-apphost-ops-agent )  
✅ `16:06:07` The agent VM reaches it at http://10.13.37.1:4874  
✅ `16:06:09` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-02T16:06:09.532Z"})  
✅ `16:06:09` …through its own OIDC client  
✅ `16:06:09` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `16:06:12` Installed @lamalibre/e2e-apphost-ops-server@1.0.0 and approved its agent half  
✅ `16:06:23` Hosted on test-agent ()  
✅ `16:06:23` Agent half 1.0.0 answers through the tunnel as lamaste-app-e2e-apphost-ops  

## A rotation reaches the service's copy before it is acknowledged

✅ `16:06:23` lamalibre-app-e2e-apphost-ops.socket listens on 127.0.0.1:21000 (since Mon 2026-11-02 19:06:14 +03)  
✅ `16:06:23` The service's copy holds the current secret  
✅ `16:06:23` Rotation pending  
✅ `16:06:23` A new secret was issued  
✅ `16:06:23` Calls keep working while the rotation is pending  
✅ `16:06:26` The relay has the new secret acknowledged  
✅ `16:06:26` …and by then the service's copy held it: written before the acknowledgement  
✅ `16:06:26` /etc/lamalibre/apps/e2e-apphost-ops/plugin-config.json carries the new secret  
✅ `16:06:26` …the one the agent holds  
✅ `16:06:26` …still 0600, the account's  
✅ `16:06:26` The service was not restarted: it re-reads its config on a signature it cannot verify  
✅ `16:06:26` The socket unit's file is unchanged: a rotation does not move the port  
✅ `16:06:26` …and the socket kept listening (active since Mon 2026-11-02 19:06:14 +03)  
✅ `16:06:26` The agent's sync delivered it (sync.log)  
✅ `16:06:26` Calls work on the new secret  

## Systemd holds the port: the agent half stopped, restarted or killed

✅ `16:06:26` While the agent half runs, nobody can bind neither 127.0.0.1:21000 nor 0.0.0.0:21000  
✅ `16:06:27` systemctl stop lamalibre-app-e2e-apphost-ops.service: sampled while it stayed stopped  
✅ `16:06:27` lamalibre-app-e2e-apphost-ops.socket stays active, listening on 127.0.0.1:21000  
✅ `16:06:27` ss: systemd (pid 1) alone holds the port  
✅ `16:06:27` …and nobody can bind neither 127.0.0.1:21000 nor 0.0.0.0:21000: no window to take it  
✅ `16:06:27` A connection to the port finds the agent half again: systemd started it for the connection waiting on its socket  
✅ `16:06:27` lamalibre-app-e2e-apphost-ops.service is active again (MainPID 39314)  
✅ `16:06:27` The pages answer through the tunnel  
✅ `16:06:31` systemctl restart: a new agent half (MainPID 39314 → 39644)  
✅ `16:06:40` kill -9: Restart=always brings a new one (MainPID 39644 → 39966)  
✅ `16:06:53` The client made 120 requests across the restart and the kill (longest wait 5407 ms)  
✅ `16:06:53` …none refused: the port was never closed  
✅ `16:06:53` …every answer the agent half's (401 to a bare call)  
✅ `16:06:53` …at most the requests in flight at the two stops cut ({})  
✅ `16:06:54` lamalibre-app-e2e-apphost-ops.socket listened throughout: active since Mon 2026-11-02 19:06:14 +03  
✅ `16:06:54` The new agent half was handed the same listening socket (descriptor 3)  
✅ `16:06:54` The pages answer  

## A reboot of the agent VM brings it all back

ℹ️ `16:06:54` Restarting lamaste-agent  
✅ `16:07:08` The agent VM is back  
✅ `16:07:08` lamalibre-app-e2e-apphost-ops.service started at boot  
✅ `16:07:08` The tunnel is up again: the pages answer  
✅ `16:07:08` Agent half 1.0.0, as lamaste-app-e2e-apphost-ops  
✅ `16:07:08` Its data survived the reboot  
✅ `16:07:08` …and it was started again (start 5)  
✅ `16:07:08` …on systemd's socket, descriptor 3  
✅ `16:07:08` Its process is lamaste-app-e2e-apphost-ops's  
✅ `16:07:08` The service's copy kept the rotated secret  
✅ `16:07:08` lamalibre-app-e2e-apphost-ops.socket came back at boot, listening on 127.0.0.1:21000  
✅ `16:07:08` ss: the listening socket is systemd's and the agent half's (MainPID 647)  
✅ `16:07:08` The agent half's descriptor 3 is that socket  
✅ `16:07:08` The agent's sync timer runs again  
✅ `16:07:08` The relay's health of the hosting is up  

## Update to 1.1.0: approved, the new agent half first

✅ `16:07:09` The update waits for approval: its agent half changed  
✅ `16:07:09` …pinned to the integrity of @lamalibre/e2e-apphost-ops-agent@1.1.0  
✅ `16:07:09` Until it is approved, 1.0.0 stays  
✅ `16:07:13` The update succeeded ()  
✅ `16:07:13` Step: agent install:pre-tunnel  
✅ `16:07:13` Step: install the new agent half  
✅ `16:07:13` Step: install the new version  
✅ `16:07:13` Step: agent install:post-tunnel  
✅ `16:07:13` The agent half was switched before the relay package  
✅ `16:07:13` current → 1.1.0, previous → 1.0.0  
✅ `16:07:13` Both versions are kept  
✅ `16:07:13` lamalibre-app-e2e-apphost-ops.service is active  
✅ `16:07:13` …as a new process (MainPID 647 → 1443)  
✅ `16:07:13` …on the same socket: lamalibre-app-e2e-apphost-ops.socket listened throughout the update (since Mon 2026-11-02 19:07:07 +03)  
✅ `16:07:13` The pages come from 1.1.0  
✅ `16:07:13` …which found the data 1.0.0 left  
✅ `16:07:13` The relay package is 1.1.0  
✅ `16:07:14` The relay records agent half 1.1.0  
✅ `16:07:14` 1.0.0 answered the pre stage  
✅ `16:07:14` 1.1.0 answered the post stage  
✅ `16:07:14` Audit: plugin.agent-half.installed for the upgrade  

## Update to 1.2.0: its post stage fails, 1.1.0 comes back

✅ `16:07:14` 1.2.0 waits for approval  
✅ `16:07:25` The update was rolled back  
✅ `16:07:25` …because the 1.2.0 agent half refused its post stage  
✅ `16:07:25` 1.2.0 had been installed and activated  
✅ `16:07:25` Its post stage failed  
✅ `16:07:25` The relay package was restored  
✅ `16:07:25` The previous agent half was activated  
✅ `16:07:25` current → 1.1.0 again (previous → 1.2.0)  
✅ `16:07:25` Only the current and the previous version are kept  
✅ `16:07:25` lamalibre-app-e2e-apphost-ops.service is active  
✅ `16:07:25` …as a new process again (MainPID 1443 → 2089)  
✅ `16:07:25` …on the socket from boot: it listened through 1.2.0 and the rollback  
✅ `16:07:25` The pages come from 1.1.0  
✅ `16:07:25` …with the data kept throughout  
✅ `16:07:25` The relay package is 1.1.0 again  
✅ `16:07:26` The relay records agent half 1.1.0  
✅ `16:07:26` 1.1.0's approval stands  
✅ `16:07:26` 1.2.0 was asked, and refused  
✅ `16:07:26` Audit: plugin.agent-half.activated 1.1.0  
✅ `16:07:26` Audit: plugin.update.reverted  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `100` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `100` |

ℹ️ `16:07:26` Cleaning up test resources...  
