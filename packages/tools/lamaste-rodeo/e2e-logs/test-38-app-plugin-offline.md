# Lamaste E2E: 38 — App plugin with its hosting agent offline (Three-VM)

> Started at `2026-11-04 14:04:50 UTC`


## Pre-flight

✅ `14:04:51` Onboarding is complete  
✅ `14:04:51` Agent test-agent is enrolled on the host  
✅ `14:04:51` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:04:52` The agent VM's lamaste-agent has the apphost command  
ℹ️ `14:04:52` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install, host and configure the plugin

✅ `14:04:52` Fixture built: @lamalibre/e2e-apphost-off-server 1.0.0 (settings v1) and its agent package  
✅ `14:04:55` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-off-server, @lamalibre/e2e-apphost-off-agent )  
✅ `14:04:55` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:04:56` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T14:04:57.023Z"})  
✅ `14:04:56` …through its own OIDC client  
✅ `14:04:57` Test secret A, made on the host VM in a 0600 file  
✅ `14:04:57` Test secret C, for a change while the agent is offline  
✅ `14:04:58` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:05:01` Installed @lamalibre/e2e-apphost-off-server@1.0.0 and approved its agent half  
✅ `14:05:12` Hosted on test-agent ()  
✅ `14:05:22` The relay's health of the hosting is up  
✅ `14:05:23` Configured: secret A and region us  
✅ `14:05:23` The agent half holds secret A (by digest)…  
✅ `14:05:23` …and region us  

## While the agent runs, the relay sees it sync

✅ `14:05:24` The hosting carries agentLastSeenAt 2026-11-04T14:05:13.117Z: the agent synced within the last two minutes  
✅ `14:05:24` GET /api/certs/agent: test-agent carries lastSeenAt  
✅ `14:05:24` GET settings: live, the hosting up, the agent's last contact shown  
✅ `14:05:28` agentLastSeenAt advances as the agent syncs (2026-11-04T14:05:28.467Z)  

## The agent VM down: offline, read from the cache, writes refused

ℹ️ `14:05:28` Stopping lamaste-agent  
✅ `14:05:30` The agent VM is stopped  
✅ `14:05:30` agentLastSeenAt (2026-11-04T14:05:28.467Z) is from before the agent went down  
✅ `14:05:30` …its last sync, shortly before  
✅ `14:05:53` The health monitor reports the hosting down  
✅ `14:05:54` Hosting view: down, reason tunnel — nothing answers on the relay's end of the tunnel  
✅ `14:05:54` …since the agent went down (2026-11-04T14:05:52.710Z)  
✅ `14:05:54` …its agentLastSeenAt still the last sync  
✅ `14:05:54` The pages answer 502 while the hosting is down…  
✅ `14:05:54` …reason tunnel: the hosting agent is unreachable  
✅ `14:05:54` GET /api/plugins shows the hosting down  
✅ `14:05:54` …and the plugin configured, from the cache  
✅ `14:05:55` GET settings still answers  
✅ `14:05:55` …from the relay's cache  
✅ `14:05:55` …saying the hosting is down (tunnel)  
✅ `14:05:55` …and when the agent was last seen  
✅ `14:05:55` …with what was last synced: configured, region us, apiKey { set: true, setAt }  
✅ `14:05:55` …synced before the agent went down (2026-11-04T14:05:28.828Z; last live read 2026-11-04T14:05:28.828Z)  
✅ `14:05:55` A change is refused while the agent is offline (503)  
✅ `14:05:55` …hosting_offline, with the hosting's state  
✅ `14:05:56` …so is one that carries a new secret, C  
✅ `14:05:57` Secret C (and A) is on no relay file, in no state.db row, journal line or answer: nothing kept to deliver later  
✅ `14:05:57` …searches that find what is there  
✅ `14:06:40` agentLastSeenAt has not moved 70 seconds later  
✅ `14:06:40` …nor the agent's lastSeenAt on GET /api/certs/agent (2026-11-04T14:05:28.467Z)  
✅ `14:06:40` …which is from before the agent went down too  

## The agent VM back: up, live, writes accepted

ℹ️ `14:06:40` Starting lamaste-agent  
✅ `14:07:02` The agent VM is back  
✅ `14:07:24` The health monitor reports the hosting up again  
✅ `14:07:24` The pages answer again  
✅ `14:07:25` GET settings is live again  
✅ `14:07:25` A change is accepted again  
✅ `14:07:26` …and reaches the agent half (region eu, revision 2)  
✅ `14:07:26` The agent half still holds secret A: the offline write with secret C never arrived  
✅ `14:07:26` agentLastSeenAt advances again (2026-11-04T14:07:26.522Z)  
✅ `14:07:27` …and so does lastSeenAt on GET /api/certs/agent (2026-11-04T14:07:27.116Z)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `14:07:27` Cleaning up test resources...  
