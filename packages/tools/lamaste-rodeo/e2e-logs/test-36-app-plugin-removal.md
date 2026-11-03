# Lamaste E2E: 36 — App plugin agent half: removal and refusals (Three-VM)

> Started at `2026-11-03 09:50:50 UTC`


## Pre-flight

✅ `09:50:50` Onboarding is complete  
✅ `09:50:50` Agent test-agent is enrolled on the host  
✅ `09:50:50` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `09:50:50` The agent VM's lamaste-agent has the apphost command  
ℹ️ `09:50:50` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install and host the plugin

✅ `09:50:51` Fixtures built: @lamalibre/e2e-apphost-rm-server, @lamalibre/e2e-apphost-deps-server and a tampered @lamalibre/e2e-apphost-rm-agent@1.0.0  
✅ `09:51:09` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-rm-server, @lamalibre/e2e-apphost-rm-agent, @lamalibre/e2e-apphost-deps-server, @lamalibre/e2e-apphost-deps-agent )  
✅ `09:51:09` The agent VM reaches it at http://10.13.37.1:4874  
✅ `09:51:10` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T09:51:10.947Z"})  
✅ `09:51:10` …through its own OIDC client  
✅ `09:51:14` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `09:51:19` Installed @lamalibre/e2e-apphost-rm-server@1.0.0 and approved its agent half  
✅ `09:51:19` The relay pinned the integrity the stand-in Feria publishes  
✅ `09:51:30` Hosted on test-agent ()  
✅ `09:51:30` The agent half answers through the tunnel (its data: instance 27d6307f2fad6fc2)  
✅ `09:51:30` Its socket unit holds port 21000  

## Unhosting keeps the agent half's data and account

✅ `09:51:37` The unhosting succeeded ()  
✅ `09:51:37` Step: agent uninstall:pre-teardown  
✅ `09:51:37` Step: remove the tunnel  
✅ `09:51:37` Step: agent uninstall:post-teardown  
✅ `09:51:37` Step: remove the agent half  
✅ `09:51:37` Step: revoke the secret and the capability  
✅ `09:51:37` Audit: plugin.agent-half.removed, data kept  
✅ `09:51:37` Unhosted: no hosting record (no secret)  
✅ `09:51:37` Unhosted: no internal tunnel  
✅ `09:51:37` Unhosted: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `09:51:37` Unhosted: no unit  
✅ `09:51:38` Unhosted: no socket unit  
✅ `09:51:38` Unhosted: no code, no config  
✅ `09:51:38` Unhosted: not in the agent's record  
✅ `09:51:38` Unhosted: nothing listens on port 21000: the socket let go of it  
✅ `09:51:38` Unhosted: the data directory stays, still the account's  
✅ `09:51:38` …with the agent half's data in it  
✅ `09:51:38` Unhosted: the account lamaste-app-e2e-apphost-rm stays  
✅ `09:51:38` Unhosted: the agent dropped its copy of the plugin config  

## A tarball that is not the pinned one is refused

✅ `09:51:38` The published tarball (the pinned bytes) is kept aside  
✅ `09:51:38` The stand-in Feria now serves other bytes as @lamalibre/e2e-apphost-rm-agent@1.0.0  
✅ `09:51:38` …whose integrity is not the pinned one  
✅ `09:51:38` …and its packument says so: npm itself has nothing to object to  
✅ `09:51:49` Hosting failed  
✅ `09:51:49` …at install the agent half  
✅ `09:51:49` …the agent refused the tarball against the pinned integrity  
✅ `09:51:49` The tunnel was never granted  
✅ `09:51:49` agent:test-agent did fetch the republished tarball  
✅ `09:51:49` Refused: no hosting record (no secret)  
✅ `09:51:49` Refused: no internal tunnel  
✅ `09:51:49` Refused: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `09:51:49` Refused: no unit  
✅ `09:51:49` Refused: no socket unit  
✅ `09:51:49` Refused: no code, no config  
✅ `09:51:49` Refused: not in the agent's record  
✅ `09:51:49` Refused: the kept data is untouched  
✅ `09:51:49` Refused: the agent dropped its copy of the plugin config  

## Hosting again finds the kept data; purge removes it

✅ `09:51:49` The stand-in Feria serves the published bytes again  
✅ `09:52:00` Hosted again ()  
✅ `09:52:00` The agent half found the data the unhosting kept  
✅ `09:52:07` Uninstalled with purge ()  
✅ `09:52:07` The plugin is gone from the relay  
✅ `09:52:07` Purged: no hosting record (no secret)  
✅ `09:52:07` Purged: no internal tunnel  
✅ `09:52:07` Purged: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `09:52:08` Purged: no unit  
✅ `09:52:08` Purged: no socket unit  
✅ `09:52:08` Purged: no code, no config  
✅ `09:52:08` Purged: not in the agent's record  
✅ `09:52:08` Purged: nothing listens on port 21000: the socket let go of it  
✅ `09:52:08` Purged: no data directory  
✅ `09:52:08` Purged: no lamaste-app-e2e-apphost-rm account or group  

## An agent package that is not bundled is refused

✅ `09:52:12` Installed @lamalibre/e2e-apphost-deps-server; its agent half is @lamalibre/e2e-apphost-deps-agent  
✅ `09:52:19` Hosting failed  
✅ `09:52:19` …at install the agent half  
✅ `09:52:19` …the agent's helper refused a package with dependencies  
✅ `09:52:19` Refused: no hosting record (no secret)  
✅ `09:52:19` Refused: no internal tunnel  
✅ `09:52:19` Refused: no plugin:e2e-apphost-deps:host on the agent's certificate  
✅ `09:52:19` Refused: no unit  
✅ `09:52:19` Refused: no socket unit  
✅ `09:52:19` Refused: no code, no config  
✅ `09:52:19` Refused: not in the agent's record  
✅ `09:52:19` Refused: no data directory, no account  

## With the agent's push-install window closed, hosting is refused

✅ `09:52:20` Hosting is refused (403)  
✅ `09:52:20` …push_install_refused (Push install access not enabled for agent "test-agent")  
✅ `09:52:20` Nothing was started  
✅ `09:52:20` e2e-apphost-deps, never hosted, is uninstalled at once  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `83` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `83` |

ℹ️ `09:52:20` Cleaning up test resources...  
