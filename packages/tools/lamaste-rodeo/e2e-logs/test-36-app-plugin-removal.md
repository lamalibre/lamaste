# Lamaste E2E: 36 — App plugin agent half: removal and refusals (Three-VM)

> Started at `2026-11-10 13:25:30 UTC`


## Pre-flight

✅ `13:25:30` Onboarding is complete  
✅ `13:25:30` Agent test-agent is enrolled on the host  
✅ `13:25:30` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:25:31` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:25:31` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install and host the plugin

✅ `13:25:32` Fixtures built: @lamalibre/e2e-apphost-rm-server, @lamalibre/e2e-apphost-deps-server and a tampered @lamalibre/e2e-apphost-rm-agent@1.0.0  
✅ `13:25:47` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-rm-server, @lamalibre/e2e-apphost-rm-agent, @lamalibre/e2e-apphost-deps-server, @lamalibre/e2e-apphost-deps-agent )  
✅ `13:25:48` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:25:49` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T13:25:49.192Z"})  
✅ `13:25:49` …through its own OIDC client  
✅ `13:25:53` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:25:58` Installed @lamalibre/e2e-apphost-rm-server@1.0.0 and approved its agent half  
✅ `13:25:59` The relay pinned the integrity the stand-in Feria publishes  
✅ `13:26:09` Hosted on test-agent ()  
✅ `13:26:09` The agent half answers through the tunnel (its data: instance eab4ed6a5cfe1557)  
✅ `13:26:09` Its socket unit holds port 21000  

## Unhosting keeps the agent half's data and account

✅ `13:26:17` The unhosting succeeded ()  
✅ `13:26:17` Step: agent uninstall:pre-teardown  
✅ `13:26:17` Step: remove the tunnel  
✅ `13:26:17` Step: agent uninstall:post-teardown  
✅ `13:26:17` Step: remove the agent half  
✅ `13:26:17` Step: revoke the secret and the capability  
✅ `13:26:17` Audit: plugin.agent-half.removed, data kept  
✅ `13:26:17` Unhosted: no hosting record (no secret)  
✅ `13:26:17` Unhosted: no internal tunnel  
✅ `13:26:17` Unhosted: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `13:26:17` Unhosted: no unit  
✅ `13:26:17` Unhosted: no socket unit  
✅ `13:26:17` Unhosted: no code, no config  
✅ `13:26:17` Unhosted: not in the agent's record  
✅ `13:26:17` Unhosted: nothing listens on port 21000: the socket let go of it  
✅ `13:26:17` Unhosted: the data directory stays, still the account's  
✅ `13:26:17` …with the agent half's data in it  
✅ `13:26:17` Unhosted: the account lamaste-app-e2e-apphost-rm stays  
✅ `13:26:18` Unhosted: the agent dropped its copy of the plugin config  

## A tarball that is not the pinned one is refused

✅ `13:26:18` The published tarball (the pinned bytes) is kept aside  
✅ `13:26:18` The stand-in Feria now serves other bytes as @lamalibre/e2e-apphost-rm-agent@1.0.0  
✅ `13:26:18` …whose integrity is not the pinned one  
✅ `13:26:18` …and its packument says so: npm itself has nothing to object to  
✅ `13:26:26` Hosting failed  
✅ `13:26:26` …at install the agent half  
✅ `13:26:26` …the agent refused the tarball against the pinned integrity  
✅ `13:26:26` The tunnel was never granted  
✅ `13:26:26` agent:test-agent did fetch the republished tarball  
✅ `13:26:26` Refused: no hosting record (no secret)  
✅ `13:26:26` Refused: no internal tunnel  
✅ `13:26:26` Refused: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `13:26:26` Refused: no unit  
✅ `13:26:26` Refused: no socket unit  
✅ `13:26:26` Refused: no code, no config  
✅ `13:26:26` Refused: not in the agent's record  
✅ `13:26:26` Refused: the kept data is untouched  
✅ `13:26:27` Refused: the agent dropped its copy of the plugin config  

## Hosting again finds the kept data; purge removes it

✅ `13:26:27` The stand-in Feria serves the published bytes again  
✅ `13:26:38` Hosted again ()  
✅ `13:26:38` The agent half found the data the unhosting kept  
✅ `13:26:45` Uninstalled with purge ()  
✅ `13:26:46` The plugin is gone from the relay  
✅ `13:26:46` Purged: no hosting record (no secret)  
✅ `13:26:46` Purged: no internal tunnel  
✅ `13:26:46` Purged: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `13:26:46` Purged: no unit  
✅ `13:26:46` Purged: no socket unit  
✅ `13:26:46` Purged: no code, no config  
✅ `13:26:46` Purged: not in the agent's record  
✅ `13:26:46` Purged: nothing listens on port 21000: the socket let go of it  
✅ `13:26:46` Purged: no data directory  
✅ `13:26:46` Purged: no lamaste-app-e2e-apphost-rm account or group  

## An agent package that is not bundled is refused

✅ `13:26:50` Installed @lamalibre/e2e-apphost-deps-server; its agent half is @lamalibre/e2e-apphost-deps-agent  
✅ `13:26:58` Hosting failed  
✅ `13:26:58` …at install the agent half  
✅ `13:26:58` …the agent's helper refused a package with dependencies  
✅ `13:26:58` Refused: no hosting record (no secret)  
✅ `13:26:58` Refused: no internal tunnel  
✅ `13:26:58` Refused: no plugin:e2e-apphost-deps:host on the agent's certificate  
✅ `13:26:58` Refused: no unit  
✅ `13:26:58` Refused: no socket unit  
✅ `13:26:58` Refused: no code, no config  
✅ `13:26:58` Refused: not in the agent's record  
✅ `13:26:58` Refused: no data directory, no account  

## With the agent's push-install window closed, hosting is refused

✅ `13:26:59` Hosting is refused (403)  
✅ `13:26:59` …push_install_refused (Push install access not enabled for agent "test-agent")  
✅ `13:26:59` Nothing was started  
✅ `13:26:59` e2e-apphost-deps, never hosted, is uninstalled at once  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `83` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `83` |

ℹ️ `13:26:59` Cleaning up test resources...  
