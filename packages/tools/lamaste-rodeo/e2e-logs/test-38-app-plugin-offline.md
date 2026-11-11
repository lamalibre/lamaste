# Lamaste E2E: 38 — App plugin with its hosting agent offline (Three-VM)

> Started at `2026-11-10 18:17:42 UTC`


## Pre-flight

✅ `18:17:43` Onboarding is complete  
✅ `18:17:43` Agent test-agent is enrolled on the host  
✅ `18:17:43` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `18:17:43` The agent VM's lamaste-agent has the apphost command  
ℹ️ `18:17:43` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install, host and configure the plugin

✅ `18:17:44` Fixture built: @lamalibre/e2e-apphost-off-server 1.0.0 (settings v1) and its agent package  
✅ `18:17:52` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-off-server, @lamalibre/e2e-apphost-off-agent )  
✅ `18:17:52` The agent VM reaches it at http://10.13.37.1:4874  
✅ `18:17:53` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T18:17:53.497Z"})  
✅ `18:17:53` …through its own OIDC client  
✅ `18:17:53` Test secret A, made on the host VM in a 0600 file  
✅ `18:17:53` Test secret C, for a change while the agent is offline  
✅ `18:17:54` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `18:18:00` Installed @lamalibre/e2e-apphost-off-server@1.0.0 and approved its agent half  
✅ `18:18:10` Hosted on test-agent ()  
✅ `18:18:27` The relay's health of the hosting is up  
✅ `18:18:28` Configured: secret A and region us  
✅ `18:18:28` The agent half holds secret A (by digest)…  
✅ `18:18:28` …and region us  

## While the agent runs, the relay sees it sync

✅ `18:18:28` The hosting carries agentLastSeenAt 2026-11-10T18:18:10.859Z: the agent synced within the last two minutes  
✅ `18:18:28` GET /api/certs/agent: test-agent carries lastSeenAt  
✅ `18:18:28` GET settings: live, the hosting up, the agent's last contact shown  
✅ `18:18:32` agentLastSeenAt advances as the agent syncs (2026-11-10T18:18:32.396Z)  

## The agent VM down: offline, read from the cache, writes refused

ℹ️ `18:18:32` Stopping lamaste-agent  
✅ `18:18:33` The agent VM is stopped  
✅ `18:18:34` agentLastSeenAt (2026-11-10T18:18:32.396Z) is from before the agent went down  
✅ `18:18:34` …its last sync, shortly before  
✅ `18:18:57` The health monitor reports the hosting down  
✅ `18:18:57` Hosting view: down, reason tunnel — nothing answers on the relay's end of the tunnel  
✅ `18:18:57` …since the agent went down (2026-11-10T18:18:56.357Z)  
✅ `18:18:57` …its agentLastSeenAt still the last sync  
✅ `18:18:57` The pages answer 502 while the hosting is down…  
✅ `18:18:57` …reason tunnel: the hosting agent is unreachable  
✅ `18:18:57` GET /api/plugins shows the hosting down  
✅ `18:18:57` …and the plugin configured, from the cache  
✅ `18:18:57` GET settings still answers  
✅ `18:18:57` …from the relay's cache  
✅ `18:18:57` …saying the hosting is down (tunnel)  
✅ `18:18:57` …and when the agent was last seen  
✅ `18:18:57` …with what was last synced: configured, region us, apiKey { set: true, setAt }  
✅ `18:18:57` …synced before the agent went down (2026-11-10T18:18:32.756Z; last live read 2026-11-10T18:18:32.756Z)  
✅ `18:18:58` A change is refused while the agent is offline (503)  
✅ `18:18:58` …hosting_offline, with the hosting's state  
✅ `18:18:58` …so is one that carries a new secret, C  
✅ `18:18:58` Secret C (and A) is on no relay file, in no state.db row, journal line or answer: nothing kept to deliver later  
✅ `18:18:58` …searches that find what is there  
✅ `18:19:45` agentLastSeenAt has not moved 71 seconds later  
✅ `18:19:45` …nor the agent's lastSeenAt on GET /api/certs/agent (2026-11-10T18:18:32.396Z)  
✅ `18:19:45` …which is from before the agent went down too  

## The agent VM back: up, live, writes accepted

ℹ️ `18:19:45` Starting lamaste-agent  
✅ `18:20:00` The agent VM is back  
✅ `18:20:17` The health monitor reports the hosting up again  
✅ `18:20:17` The pages answer again  
✅ `18:20:17` GET settings is live again  
✅ `18:20:18` A change is accepted again  
✅ `18:20:18` …and reaches the agent half (region eu, revision 2)  
✅ `18:20:18` The agent half still holds secret A: the offline write with secret C never arrived  
✅ `18:20:18` agentLastSeenAt advances again (2026-11-10T18:20:18.690Z)  
✅ `18:20:19` …and so does lastSeenAt on GET /api/certs/agent (2026-11-10T18:20:19.126Z)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `18:20:19` Cleaning up test resources...  
