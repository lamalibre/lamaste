# Lamaste E2E: 36 — App plugin agent half: removal and refusals (Three-VM)

> Started at `2026-11-10 18:07:36 UTC`


## Pre-flight

✅ `18:07:37` Onboarding is complete  
✅ `18:07:37` Agent test-agent is enrolled on the host  
✅ `18:07:37` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `18:07:37` The agent VM's lamaste-agent has the apphost command  
ℹ️ `18:07:37` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install and host the plugin

✅ `18:07:39` Fixtures built: @lamalibre/e2e-apphost-rm-server, @lamalibre/e2e-apphost-deps-server and a tampered @lamalibre/e2e-apphost-rm-agent@1.0.0  
✅ `18:07:54` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-rm-server, @lamalibre/e2e-apphost-rm-agent, @lamalibre/e2e-apphost-deps-server, @lamalibre/e2e-apphost-deps-agent )  
✅ `18:07:54` The agent VM reaches it at http://10.13.37.1:4874  
✅ `18:07:56` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T18:07:56.064Z"})  
✅ `18:07:56` …through its own OIDC client  
✅ `18:08:00` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `18:08:05` Installed @lamalibre/e2e-apphost-rm-server@1.0.0 and approved its agent half  
✅ `18:08:05` The relay pinned the integrity the stand-in Feria publishes  
✅ `18:08:16` Hosted on test-agent ()  
✅ `18:08:16` The agent half answers through the tunnel (its data: instance 4f1d9d98540c26cb)  
✅ `18:08:16` Its socket unit holds port 21000  

## Unhosting keeps the agent half's data and account

✅ `18:08:27` The unhosting succeeded ()  
✅ `18:08:27` Step: agent uninstall:pre-teardown  
✅ `18:08:27` Step: remove the tunnel  
✅ `18:08:27` Step: agent uninstall:post-teardown  
✅ `18:08:27` Step: remove the agent half  
✅ `18:08:27` Step: revoke the secret and the capability  
✅ `18:08:27` Audit: plugin.agent-half.removed, data kept  
✅ `18:08:27` Unhosted: no hosting record (no secret)  
✅ `18:08:27` Unhosted: no internal tunnel  
✅ `18:08:27` Unhosted: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `18:08:28` Unhosted: no unit  
✅ `18:08:28` Unhosted: no socket unit  
✅ `18:08:28` Unhosted: no code, no config  
✅ `18:08:28` Unhosted: not in the agent's record  
✅ `18:08:28` Unhosted: nothing listens on port 21000: the socket let go of it  
✅ `18:08:28` Unhosted: the data directory stays, still the account's  
✅ `18:08:28` …with the agent half's data in it  
✅ `18:08:28` Unhosted: the account lamaste-app-e2e-apphost-rm stays  
✅ `18:08:28` Unhosted: the agent dropped its copy of the plugin config  

## A tarball that is not the pinned one is refused

✅ `18:08:28` The published tarball (the pinned bytes) is kept aside  
✅ `18:08:28` The stand-in Feria now serves other bytes as @lamalibre/e2e-apphost-rm-agent@1.0.0  
✅ `18:08:28` …whose integrity is not the pinned one  
✅ `18:08:28` …and its packument says so: npm itself has nothing to object to  
✅ `18:08:36` Hosting failed  
✅ `18:08:36` …at install the agent half  
✅ `18:08:36` …the agent refused the tarball against the pinned integrity  
✅ `18:08:36` The tunnel was never granted  
✅ `18:08:36` agent:test-agent did fetch the republished tarball  
✅ `18:08:36` Refused: no hosting record (no secret)  
✅ `18:08:36` Refused: no internal tunnel  
✅ `18:08:36` Refused: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `18:08:37` Refused: no unit  
✅ `18:08:37` Refused: no socket unit  
✅ `18:08:37` Refused: no code, no config  
✅ `18:08:37` Refused: not in the agent's record  
✅ `18:08:37` Refused: the kept data is untouched  
✅ `18:08:37` Refused: the agent dropped its copy of the plugin config  

## Hosting again finds the kept data; purge removes it

✅ `18:08:37` The stand-in Feria serves the published bytes again  
✅ `18:08:47` Hosted again ()  
✅ `18:08:48` The agent half found the data the unhosting kept  
✅ `18:08:59` Uninstalled with purge ()  
✅ `18:08:59` The plugin is gone from the relay  
✅ `18:08:59` Purged: no hosting record (no secret)  
✅ `18:08:59` Purged: no internal tunnel  
✅ `18:08:59` Purged: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `18:08:59` Purged: no unit  
✅ `18:08:59` Purged: no socket unit  
✅ `18:08:59` Purged: no code, no config  
✅ `18:08:59` Purged: not in the agent's record  
✅ `18:08:59` Purged: nothing listens on port 21000: the socket let go of it  
✅ `18:08:59` Purged: no data directory  
✅ `18:08:59` Purged: no lamaste-app-e2e-apphost-rm account or group  

## An agent package that is not bundled is refused

✅ `18:09:04` Installed @lamalibre/e2e-apphost-deps-server; its agent half is @lamalibre/e2e-apphost-deps-agent  
✅ `18:09:11` Hosting failed  
✅ `18:09:11` …at install the agent half  
✅ `18:09:11` …the agent's helper refused a package with dependencies  
✅ `18:09:11` Refused: no hosting record (no secret)  
✅ `18:09:11` Refused: no internal tunnel  
✅ `18:09:11` Refused: no plugin:e2e-apphost-deps:host on the agent's certificate  
✅ `18:09:11` Refused: no unit  
✅ `18:09:11` Refused: no socket unit  
✅ `18:09:11` Refused: no code, no config  
✅ `18:09:11` Refused: not in the agent's record  
✅ `18:09:11` Refused: no data directory, no account  

## With the agent's push-install window closed, hosting is refused

✅ `18:09:11` Hosting is refused (403)  
✅ `18:09:12` …push_install_refused (Push install access not enabled for agent "test-agent")  
✅ `18:09:12` Nothing was started  
✅ `18:09:12` e2e-apphost-deps, never hosted, is uninstalled at once  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `83` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `83` |

ℹ️ `18:09:12` Cleaning up test resources...  
