# Lamaste E2E: 38 — App plugin with its hosting agent offline (Three-VM)

> Started at `2026-11-10 13:35:32 UTC`


## Pre-flight

✅ `13:35:32` Onboarding is complete  
✅ `13:35:33` Agent test-agent is enrolled on the host  
✅ `13:35:33` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:35:33` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:35:33` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install, host and configure the plugin

✅ `13:35:34` Fixture built: @lamalibre/e2e-apphost-off-server 1.0.0 (settings v1) and its agent package  
✅ `13:35:43` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-off-server, @lamalibre/e2e-apphost-off-agent )  
✅ `13:35:43` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:35:44` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T13:35:44.545Z"})  
✅ `13:35:44` …through its own OIDC client  
✅ `13:35:44` Test secret A, made on the host VM in a 0600 file  
✅ `13:35:44` Test secret C, for a change while the agent is offline  
✅ `13:35:46` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:35:51` Installed @lamalibre/e2e-apphost-off-server@1.0.0 and approved its agent half  
✅ `13:36:02` Hosted on test-agent ()  
✅ `13:36:18` The relay's health of the hosting is up  
✅ `13:36:19` Configured: secret A and region us  
✅ `13:36:19` The agent half holds secret A (by digest)…  
✅ `13:36:19` …and region us  

## While the agent runs, the relay sees it sync

✅ `13:36:19` The hosting carries agentLastSeenAt 2026-11-10T13:36:02.095Z: the agent synced within the last two minutes  
✅ `13:36:19` GET /api/certs/agent: test-agent carries lastSeenAt  
✅ `13:36:19` GET settings: live, the hosting up, the agent's last contact shown  
✅ `13:36:23` agentLastSeenAt advances as the agent syncs (2026-11-10T13:36:23.606Z)  

## The agent VM down: offline, read from the cache, writes refused

ℹ️ `13:36:24` Stopping lamaste-agent  
✅ `13:36:25` The agent VM is stopped  
✅ `13:36:25` agentLastSeenAt (2026-11-10T13:36:23.606Z) is from before the agent went down  
✅ `13:36:25` …its last sync, shortly before  
✅ `13:36:49` The health monitor reports the hosting down  
✅ `13:36:49` Hosting view: down, reason tunnel — nothing answers on the relay's end of the tunnel  
✅ `13:36:49` …since the agent went down (2026-11-10T13:36:47.243Z)  
✅ `13:36:49` …its agentLastSeenAt still the last sync  
✅ `13:36:49` The pages answer 502 while the hosting is down…  
✅ `13:36:49` …reason tunnel: the hosting agent is unreachable  
✅ `13:36:49` GET /api/plugins shows the hosting down  
✅ `13:36:49` …and the plugin configured, from the cache  
✅ `13:36:49` GET settings still answers  
✅ `13:36:49` …from the relay's cache  
✅ `13:36:49` …saying the hosting is down (tunnel)  
✅ `13:36:49` …and when the agent was last seen  
✅ `13:36:49` …with what was last synced: configured, region us, apiKey { set: true, setAt }  
✅ `13:36:49` …synced before the agent went down (2026-11-10T13:36:24.031Z; last live read 2026-11-10T13:36:24.031Z)  
✅ `13:36:50` A change is refused while the agent is offline (503)  
✅ `13:36:50` …hosting_offline, with the hosting's state  
✅ `13:36:50` …so is one that carries a new secret, C  
✅ `13:36:50` Secret C (and A) is on no relay file, in no state.db row, journal line or answer: nothing kept to deliver later  
✅ `13:36:50` …searches that find what is there  
✅ `13:37:36` agentLastSeenAt has not moved 71 seconds later  
✅ `13:37:36` …nor the agent's lastSeenAt on GET /api/certs/agent (2026-11-10T13:36:23.606Z)  
✅ `13:37:36` …which is from before the agent went down too  

## The agent VM back: up, live, writes accepted

ℹ️ `13:37:36` Starting lamaste-agent  
✅ `13:37:52` The agent VM is back  
✅ `13:38:10` The health monitor reports the hosting up again  
✅ `13:38:10` The pages answer again  
✅ `13:38:10` GET settings is live again  
✅ `13:38:11` A change is accepted again  
✅ `13:38:11` …and reaches the agent half (region eu, revision 2)  
✅ `13:38:11` The agent half still holds secret A: the offline write with secret C never arrived  
✅ `13:38:11` agentLastSeenAt advances again (2026-11-10T13:38:11.540Z)  
✅ `13:38:12` …and so does lastSeenAt on GET /api/certs/agent (2026-11-10T13:38:11.997Z)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `13:38:12` Cleaning up test resources...  
