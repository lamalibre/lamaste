# Lamaste E2E: 36 — App plugin agent half: removal and refusals (Three-VM)

> Started at `2026-11-09 13:02:36 UTC`


## Pre-flight

✅ `13:02:36` Onboarding is complete  
✅ `13:02:37` Agent test-agent is enrolled on the host  
✅ `13:02:37` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:02:37` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:02:37` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install and host the plugin

✅ `13:02:38` Fixtures built: @lamalibre/e2e-apphost-rm-server, @lamalibre/e2e-apphost-deps-server and a tampered @lamalibre/e2e-apphost-rm-agent@1.0.0  
✅ `13:02:52` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-rm-server, @lamalibre/e2e-apphost-rm-agent, @lamalibre/e2e-apphost-deps-server, @lamalibre/e2e-apphost-deps-agent )  
✅ `13:02:52` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:02:53` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T13:02:53.787Z"})  
✅ `13:02:53` …through its own OIDC client  
✅ `13:02:57` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:03:02` Installed @lamalibre/e2e-apphost-rm-server@1.0.0 and approved its agent half  
✅ `13:03:02` The relay pinned the integrity the stand-in Feria publishes  
✅ `13:03:13` Hosted on test-agent ()  
✅ `13:03:13` The agent half answers through the tunnel (its data: instance 7abfd494fc98f7a6)  
✅ `13:03:13` Its socket unit holds port 21000  

## Unhosting keeps the agent half's data and account

✅ `13:03:20` The unhosting succeeded ()  
✅ `13:03:20` Step: agent uninstall:pre-teardown  
✅ `13:03:20` Step: remove the tunnel  
✅ `13:03:20` Step: agent uninstall:post-teardown  
✅ `13:03:20` Step: remove the agent half  
✅ `13:03:20` Step: revoke the secret and the capability  
✅ `13:03:20` Audit: plugin.agent-half.removed, data kept  
✅ `13:03:20` Unhosted: no hosting record (no secret)  
✅ `13:03:20` Unhosted: no internal tunnel  
✅ `13:03:20` Unhosted: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `13:03:20` Unhosted: no unit  
✅ `13:03:20` Unhosted: no socket unit  
✅ `13:03:20` Unhosted: no code, no config  
✅ `13:03:20` Unhosted: not in the agent's record  
✅ `13:03:20` Unhosted: nothing listens on port 21000: the socket let go of it  
✅ `13:03:20` Unhosted: the data directory stays, still the account's  
✅ `13:03:20` …with the agent half's data in it  
✅ `13:03:20` Unhosted: the account lamaste-app-e2e-apphost-rm stays  
✅ `13:03:20` Unhosted: the agent dropped its copy of the plugin config  

## A tarball that is not the pinned one is refused

✅ `13:03:20` The published tarball (the pinned bytes) is kept aside  
✅ `13:03:21` The stand-in Feria now serves other bytes as @lamalibre/e2e-apphost-rm-agent@1.0.0  
✅ `13:03:21` …whose integrity is not the pinned one  
✅ `13:03:21` …and its packument says so: npm itself has nothing to object to  
✅ `13:03:28` Hosting failed  
✅ `13:03:28` …at install the agent half  
✅ `13:03:28` …the agent refused the tarball against the pinned integrity  
✅ `13:03:28` The tunnel was never granted  
✅ `13:03:28` agent:test-agent did fetch the republished tarball  
✅ `13:03:28` Refused: no hosting record (no secret)  
✅ `13:03:28` Refused: no internal tunnel  
✅ `13:03:28` Refused: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `13:03:28` Refused: no unit  
✅ `13:03:28` Refused: no socket unit  
✅ `13:03:28` Refused: no code, no config  
✅ `13:03:28` Refused: not in the agent's record  
✅ `13:03:28` Refused: the kept data is untouched  
✅ `13:03:28` Refused: the agent dropped its copy of the plugin config  

## Hosting again finds the kept data; purge removes it

✅ `13:03:28` The stand-in Feria serves the published bytes again  
✅ `13:03:39` Hosted again ()  
✅ `13:03:39` The agent half found the data the unhosting kept  
✅ `13:03:46` Uninstalled with purge ()  
✅ `13:03:46` The plugin is gone from the relay  
✅ `13:03:46` Purged: no hosting record (no secret)  
✅ `13:03:46` Purged: no internal tunnel  
✅ `13:03:46` Purged: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `13:03:46` Purged: no unit  
✅ `13:03:47` Purged: no socket unit  
✅ `13:03:47` Purged: no code, no config  
✅ `13:03:47` Purged: not in the agent's record  
✅ `13:03:47` Purged: nothing listens on port 21000: the socket let go of it  
✅ `13:03:47` Purged: no data directory  
✅ `13:03:47` Purged: no lamaste-app-e2e-apphost-rm account or group  

## An agent package that is not bundled is refused

✅ `13:03:51` Installed @lamalibre/e2e-apphost-deps-server; its agent half is @lamalibre/e2e-apphost-deps-agent  
✅ `13:03:58` Hosting failed  
✅ `13:03:58` …at install the agent half  
✅ `13:03:58` …the agent's helper refused a package with dependencies  
✅ `13:03:58` Refused: no hosting record (no secret)  
✅ `13:03:58` Refused: no internal tunnel  
✅ `13:03:58` Refused: no plugin:e2e-apphost-deps:host on the agent's certificate  
✅ `13:03:58` Refused: no unit  
✅ `13:03:58` Refused: no socket unit  
✅ `13:03:58` Refused: no code, no config  
✅ `13:03:58` Refused: not in the agent's record  
✅ `13:03:58` Refused: no data directory, no account  

## With the agent's push-install window closed, hosting is refused

✅ `13:03:58` Hosting is refused (403)  
✅ `13:03:58` …push_install_refused (Push install access not enabled for agent "test-agent")  
✅ `13:03:58` Nothing was started  
✅ `13:03:59` e2e-apphost-deps, never hosted, is uninstalled at once  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `83` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `83` |

ℹ️ `13:03:59` Cleaning up test resources...  
