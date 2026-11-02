# Lamaste E2E: 36 — App plugin agent half: removal and refusals (Three-VM)

> Started at `2026-11-02 16:09:37 UTC`


## Pre-flight

✅ `16:09:37` Onboarding is complete  
✅ `16:09:37` Agent test-agent is enrolled on the host  
✅ `16:09:37` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `16:09:38` The agent VM's lamaste-agent has the apphost command  
ℹ️ `16:09:38` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install and host the plugin

✅ `16:09:39` Fixtures built: @lamalibre/e2e-apphost-rm-server, @lamalibre/e2e-apphost-deps-server and a tampered @lamalibre/e2e-apphost-rm-agent@1.0.0  
✅ `16:09:42` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-rm-server, @lamalibre/e2e-apphost-rm-agent, @lamalibre/e2e-apphost-deps-server, @lamalibre/e2e-apphost-deps-agent )  
✅ `16:09:43` The agent VM reaches it at http://10.13.37.1:4874  
✅ `16:09:44` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-02T16:09:45.105Z"})  
✅ `16:09:44` …through its own OIDC client  
✅ `16:09:45` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `16:09:48` Installed @lamalibre/e2e-apphost-rm-server@1.0.0 and approved its agent half  
✅ `16:09:48` The relay pinned the integrity the stand-in Feria publishes  
✅ `16:09:59` Hosted on test-agent ()  
✅ `16:09:59` The agent half answers through the tunnel (its data: instance 242f9f524fde8498)  
✅ `16:09:59` Its socket unit holds port 21000  

## Unhosting keeps the agent half's data and account

✅ `16:10:06` The unhosting succeeded ()  
✅ `16:10:06` Step: agent uninstall:pre-teardown  
✅ `16:10:06` Step: remove the tunnel  
✅ `16:10:06` Step: agent uninstall:post-teardown  
✅ `16:10:06` Step: remove the agent half  
✅ `16:10:06` Step: revoke the secret and the capability  
✅ `16:10:06` Audit: plugin.agent-half.removed, data kept  
✅ `16:10:06` Unhosted: no hosting record (no secret)  
✅ `16:10:06` Unhosted: no internal tunnel  
✅ `16:10:06` Unhosted: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `16:10:06` Unhosted: no unit  
✅ `16:10:06` Unhosted: no socket unit  
✅ `16:10:06` Unhosted: no code, no config  
✅ `16:10:06` Unhosted: not in the agent's record  
✅ `16:10:06` Unhosted: nothing listens on port 21000: the socket let go of it  
✅ `16:10:06` Unhosted: the data directory stays, still the account's  
✅ `16:10:06` …with the agent half's data in it  
✅ `16:10:07` Unhosted: the account lamaste-app-e2e-apphost-rm stays  
✅ `16:10:07` Unhosted: the agent dropped its copy of the plugin config  

## A tarball that is not the pinned one is refused

✅ `16:10:07` The published tarball (the pinned bytes) is kept aside  
✅ `16:10:07` The stand-in Feria now serves other bytes as @lamalibre/e2e-apphost-rm-agent@1.0.0  
✅ `16:10:07` …whose integrity is not the pinned one  
✅ `16:10:07` …and its packument says so: npm itself has nothing to object to  
✅ `16:10:14` Hosting failed  
✅ `16:10:14` …at install the agent half  
✅ `16:10:14` …the agent refused the tarball against the pinned integrity  
✅ `16:10:14` The tunnel was never granted  
✅ `16:10:14` agent:test-agent did fetch the republished tarball  
✅ `16:10:15` Refused: no hosting record (no secret)  
✅ `16:10:15` Refused: no internal tunnel  
✅ `16:10:15` Refused: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `16:10:15` Refused: no unit  
✅ `16:10:15` Refused: no socket unit  
✅ `16:10:15` Refused: no code, no config  
✅ `16:10:15` Refused: not in the agent's record  
✅ `16:10:15` Refused: the kept data is untouched  
✅ `16:10:15` Refused: the agent dropped its copy of the plugin config  

## Hosting again finds the kept data; purge removes it

✅ `16:10:15` The stand-in Feria serves the published bytes again  
✅ `16:10:29` Hosted again ()  
✅ `16:10:29` The agent half found the data the unhosting kept  
✅ `16:10:36` Uninstalled with purge ()  
✅ `16:10:36` The plugin is gone from the relay  
✅ `16:10:36` Purged: no hosting record (no secret)  
✅ `16:10:36` Purged: no internal tunnel  
✅ `16:10:37` Purged: no plugin:e2e-apphost-rm:host on the agent's certificate  
✅ `16:10:37` Purged: no unit  
✅ `16:10:37` Purged: no socket unit  
✅ `16:10:37` Purged: no code, no config  
✅ `16:10:37` Purged: not in the agent's record  
✅ `16:10:37` Purged: nothing listens on port 21000: the socket let go of it  
✅ `16:10:37` Purged: no data directory  
✅ `16:10:37` Purged: no lamaste-app-e2e-apphost-rm account or group  

## An agent package that is not bundled is refused

✅ `16:10:39` Installed @lamalibre/e2e-apphost-deps-server; its agent half is @lamalibre/e2e-apphost-deps-agent  
✅ `16:10:46` Hosting failed  
✅ `16:10:46` …at install the agent half  
✅ `16:10:46` …the agent's helper refused a package with dependencies  
✅ `16:10:46` Refused: no hosting record (no secret)  
✅ `16:10:46` Refused: no internal tunnel  
✅ `16:10:46` Refused: no plugin:e2e-apphost-deps:host on the agent's certificate  
✅ `16:10:46` Refused: no unit  
✅ `16:10:46` Refused: no socket unit  
✅ `16:10:46` Refused: no code, no config  
✅ `16:10:46` Refused: not in the agent's record  
✅ `16:10:46` Refused: no data directory, no account  

## With the agent's push-install window closed, hosting is refused

✅ `16:10:46` Hosting is refused (403)  
✅ `16:10:46` …push_install_refused (Push install access not enabled for agent "test-agent")  
✅ `16:10:47` Nothing was started  
✅ `16:10:47` e2e-apphost-deps, never hosted, is uninstalled at once  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `83` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `83` |

ℹ️ `16:10:47` Cleaning up test resources...  
