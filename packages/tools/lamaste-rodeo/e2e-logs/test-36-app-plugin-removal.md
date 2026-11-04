# Lamaste E2E: 36 — App plugin agent half: removal and refusals (Three-VM)

> Started at `2026-11-04 13:55:21 UTC`


## Pre-flight

✅ `13:55:21` Onboarding is complete  
✅ `13:55:22` Agent test-agent is enrolled on the host  
✅ `13:55:22` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:55:23` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:55:23` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install and host the plugin

✅ `13:55:24` Fixtures built: @lamalibre/e2e-apphost-rm-server, @lamalibre/e2e-apphost-deps-server and a tampered @lamalibre/e2e-apphost-rm-agent@1.0.0  
✅ `13:55:29` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-rm-server, @lamalibre/e2e-apphost-rm-agent, @lamalibre/e2e-apphost-deps-server, @lamalibre/e2e-apphost-deps-agent )  
✅ `13:55:29` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:55:31` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T13:55:31.367Z"})  
✅ `13:55:31` …through its own OIDC client  
✅ `13:55:32` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:55:36` Installed @lamalibre/e2e-apphost-rm-server@1.0.0 and approved its agent half  
✅ `13:55:36` The relay pinned the integrity the stand-in Feria publishes  
✅ `13:55:47` Hosted on test-agent ()  
✅ `13:55:47` The agent half answers through the tunnel (its data: instance b73c3abf9520f614)  
✅ `13:55:47` Its socket unit holds port 21000  

## Unhosting keeps the agent half's data and account

✅ `13:55:55` The unhosting succeeded ()  
✅ `13:55:55` Step: agent uninstall:pre-teardown  
✅ `13:55:55` Step: remove the tunnel  
✅ `13:55:55` Step: agent uninstall:post-teardown  
✅ `13:55:55` Step: remove the agent half  
✅ `13:55:55` Step: revoke the secret and the capability  
✅ `13:55:55` Audit: plugin.agent-half.removed, data kept  
✅ `13:55:55` Unhosted: no hosting record (no secret)  
✅ `13:55:55` Unhosted: no internal tunnel  
✅ `13:55:55` Unhosted: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `13:55:55` Unhosted: no unit  
✅ `13:55:55` Unhosted: no socket unit  
✅ `13:55:55` Unhosted: no code, no config  
✅ `13:55:55` Unhosted: not in the agent's record  
✅ `13:55:55` Unhosted: nothing listens on port 21000: the socket let go of it  
✅ `13:55:55` Unhosted: the data directory stays, still the account's  
✅ `13:55:55` …with the agent half's data in it  
✅ `13:55:55` Unhosted: the account lamaste-app-e2e-apphost-rm stays  
✅ `13:55:56` Unhosted: the agent dropped its copy of the plugin config  

## A tarball that is not the pinned one is refused

✅ `13:55:56` The published tarball (the pinned bytes) is kept aside  
✅ `13:55:56` The stand-in Feria now serves other bytes as @lamalibre/e2e-apphost-rm-agent@1.0.0  
✅ `13:55:56` …whose integrity is not the pinned one  
✅ `13:55:56` …and its packument says so: npm itself has nothing to object to  
✅ `13:56:03` Hosting failed  
✅ `13:56:03` …at install the agent half  
✅ `13:56:03` …the agent refused the tarball against the pinned integrity  
✅ `13:56:03` The tunnel was never granted  
✅ `13:56:03` agent:test-agent did fetch the republished tarball  
✅ `13:56:03` Refused: no hosting record (no secret)  
✅ `13:56:03` Refused: no internal tunnel  
✅ `13:56:03` Refused: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `13:56:04` Refused: no unit  
✅ `13:56:04` Refused: no socket unit  
✅ `13:56:04` Refused: no code, no config  
✅ `13:56:04` Refused: not in the agent's record  
✅ `13:56:04` Refused: the kept data is untouched  
✅ `13:56:04` Refused: the agent dropped its copy of the plugin config  

## Hosting again finds the kept data; purge removes it

✅ `13:56:04` The stand-in Feria serves the published bytes again  
✅ `13:56:19` Hosted again ()  
✅ `13:56:19` The agent half found the data the unhosting kept  
✅ `13:56:27` Uninstalled with purge ()  
✅ `13:56:27` The plugin is gone from the relay  
✅ `13:56:28` Purged: no hosting record (no secret)  
✅ `13:56:28` Purged: no internal tunnel  
✅ `13:56:28` Purged: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `13:56:28` Purged: no unit  
✅ `13:56:28` Purged: no socket unit  
✅ `13:56:28` Purged: no code, no config  
✅ `13:56:28` Purged: not in the agent's record  
✅ `13:56:28` Purged: nothing listens on port 21000: the socket let go of it  
✅ `13:56:28` Purged: no data directory  
✅ `13:56:28` Purged: no lamaste-app-e2e-apphost-rm account or group  

## An agent package that is not bundled is refused

✅ `13:56:30` Installed @lamalibre/e2e-apphost-deps-server; its agent half is @lamalibre/e2e-apphost-deps-agent  
✅ `13:56:37` Hosting failed  
✅ `13:56:37` …at install the agent half  
✅ `13:56:38` …the agent's helper refused a package with dependencies  
✅ `13:56:38` Refused: no hosting record (no secret)  
✅ `13:56:38` Refused: no internal tunnel  
✅ `13:56:38` Refused: no plugin:e2e-apphost-deps:host on the agent's certificate  
✅ `13:56:38` Refused: no unit  
✅ `13:56:38` Refused: no socket unit  
✅ `13:56:38` Refused: no code, no config  
✅ `13:56:38` Refused: not in the agent's record  
✅ `13:56:38` Refused: no data directory, no account  

## With the agent's push-install window closed, hosting is refused

✅ `13:56:39` Hosting is refused (403)  
✅ `13:56:39` …push_install_refused (Push install access not enabled for agent "test-agent")  
✅ `13:56:39` Nothing was started  
✅ `13:56:40` e2e-apphost-deps, never hosted, is uninstalled at once  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `83` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `83` |

ℹ️ `13:56:40` Cleaning up test resources...  
