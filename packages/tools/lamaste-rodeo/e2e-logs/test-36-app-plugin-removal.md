# Lamaste E2E: 36 — App plugin agent half: removal and refusals (Three-VM)

> Started at `2026-11-11 10:58:55 UTC`


## Pre-flight

✅ `10:58:55` Onboarding is complete  
✅ `10:58:55` Agent test-agent is enrolled on the host  
✅ `10:58:55` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:58:56` The agent VM's lamaste-agent has the apphost command  
ℹ️ `10:58:56` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install and host the plugin

✅ `10:58:57` Fixtures built: @lamalibre/e2e-apphost-rm-server, @lamalibre/e2e-apphost-deps-server and a tampered @lamalibre/e2e-apphost-rm-agent@1.0.0  
✅ `10:59:13` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-rm-server, @lamalibre/e2e-apphost-rm-agent, @lamalibre/e2e-apphost-deps-server, @lamalibre/e2e-apphost-deps-agent )  
✅ `10:59:13` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:59:14` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T10:59:14.497Z"})  
✅ `10:59:14` …through its own OIDC client  
✅ `10:59:15` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:59:20` Installed @lamalibre/e2e-apphost-rm-server@1.0.0 and approved its agent half  
✅ `10:59:20` The relay pinned the integrity the stand-in Feria publishes  
✅ `10:59:31` Hosted on test-agent ()  
✅ `10:59:31` The agent half answers through the tunnel (its data: instance 32124c5a30425d15)  
✅ `10:59:32` Its socket unit holds port 21000  

## Unhosting keeps the agent half's data and account

✅ `10:59:43` The unhosting succeeded ()  
✅ `10:59:43` Step: agent uninstall:pre-teardown  
✅ `10:59:43` Step: remove the tunnel  
✅ `10:59:43` Step: agent uninstall:post-teardown  
✅ `10:59:43` Step: remove the agent half  
✅ `10:59:43` Step: revoke the secret and the capability  
✅ `10:59:43` Audit: plugin.agent-half.removed, data kept  
✅ `10:59:43` Unhosted: no hosting record (no secret)  
✅ `10:59:43` Unhosted: no internal tunnel  
✅ `10:59:43` Unhosted: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `10:59:43` Unhosted: no unit  
✅ `10:59:43` Unhosted: no socket unit  
✅ `10:59:43` Unhosted: no code, no config  
✅ `10:59:43` Unhosted: not in the agent's record  
✅ `10:59:43` Unhosted: nothing listens on port 21000: the socket let go of it  
✅ `10:59:44` Unhosted: the data directory stays, still the account's  
✅ `10:59:44` …with the agent half's data in it  
✅ `10:59:44` Unhosted: the account lamaste-app-e2e-apphost-rm stays  
✅ `10:59:44` Unhosted: the agent dropped its copy of the plugin config  

## A tarball that is not the pinned one is refused

✅ `10:59:44` The published tarball (the pinned bytes) is kept aside  
✅ `10:59:44` The stand-in Feria now serves other bytes as @lamalibre/e2e-apphost-rm-agent@1.0.0  
✅ `10:59:44` …whose integrity is not the pinned one  
✅ `10:59:44` …and its packument says so: npm itself has nothing to object to  
✅ `10:59:52` Hosting failed  
✅ `10:59:52` …at install the agent half  
✅ `10:59:52` …the agent refused the tarball against the pinned integrity  
✅ `10:59:52` The tunnel was never granted  
✅ `10:59:52` agent:test-agent did fetch the republished tarball  
✅ `10:59:52` Refused: no hosting record (no secret)  
✅ `10:59:52` Refused: no internal tunnel  
✅ `10:59:52` Refused: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `10:59:52` Refused: no unit  
✅ `10:59:52` Refused: no socket unit  
✅ `10:59:52` Refused: no code, no config  
✅ `10:59:52` Refused: not in the agent's record  
✅ `10:59:52` Refused: the kept data is untouched  
✅ `10:59:53` Refused: the agent dropped its copy of the plugin config  

## Hosting again finds the kept data; purge removes it

✅ `10:59:53` The stand-in Feria serves the published bytes again  
✅ `11:00:04` Hosted again ()  
✅ `11:00:04` The agent half found the data the unhosting kept  
✅ `11:00:15` Uninstalled with purge ()  
✅ `11:00:15` The plugin is gone from the relay  
✅ `11:00:15` Purged: no hosting record (no secret)  
✅ `11:00:15` Purged: no internal tunnel  
✅ `11:00:15` Purged: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `11:00:15` Purged: no unit  
✅ `11:00:15` Purged: no socket unit  
✅ `11:00:15` Purged: no code, no config  
✅ `11:00:15` Purged: not in the agent's record  
✅ `11:00:15` Purged: nothing listens on port 21000: the socket let go of it  
✅ `11:00:15` Purged: no data directory  
✅ `11:00:15` Purged: no lamaste-app-e2e-apphost-rm account or group  

## An agent package that is not bundled is refused

✅ `11:00:20` Installed @lamalibre/e2e-apphost-deps-server; its agent half is @lamalibre/e2e-apphost-deps-agent  
✅ `11:00:27` Hosting failed  
✅ `11:00:27` …at install the agent half  
✅ `11:00:27` …the agent's helper refused a package with dependencies  
✅ `11:00:27` Refused: no hosting record (no secret)  
✅ `11:00:27` Refused: no internal tunnel  
✅ `11:00:27` Refused: no plugin:e2e-apphost-deps:host on the agent's certificate  
✅ `11:00:27` Refused: no unit  
✅ `11:00:27` Refused: no socket unit  
✅ `11:00:27` Refused: no code, no config  
✅ `11:00:27` Refused: not in the agent's record  
✅ `11:00:27` Refused: no data directory, no account  

## With the agent's push-install window closed, hosting is refused

✅ `11:00:28` Hosting is refused (403)  
✅ `11:00:28` …push_install_refused (Push install access not enabled for agent "test-agent")  
✅ `11:00:28` Nothing was started  
✅ `11:00:28` e2e-apphost-deps, never hosted, is uninstalled at once  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `83` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `83` |

ℹ️ `11:00:28` Cleaning up test resources...  
