# Lamaste E2E: 38 — App plugin with its hosting agent offline (Three-VM)

> Started at `2026-11-11 11:03:00 UTC`


## Pre-flight

✅ `11:03:00` Onboarding is complete  
✅ `11:03:01` Agent test-agent is enrolled on the host  
✅ `11:03:01` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `11:03:01` The agent VM's lamaste-agent has the apphost command  
ℹ️ `11:03:01` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install, host and configure the plugin

✅ `11:03:01` Fixture built: @lamalibre/e2e-apphost-off-server 1.0.0 (settings v1) and its agent package  
✅ `11:03:11` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-off-server, @lamalibre/e2e-apphost-off-agent )  
✅ `11:03:11` The agent VM reaches it at http://10.13.37.1:4874  
✅ `11:03:12` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T11:03:12.531Z"})  
✅ `11:03:12` …through its own OIDC client  
✅ `11:03:12` Test secret A, made on the host VM in a 0600 file  
✅ `11:03:12` Test secret C, for a change while the agent is offline  
✅ `11:03:13` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `11:03:19` Installed @lamalibre/e2e-apphost-off-server@1.0.0 and approved its agent half  
✅ `11:03:30` Hosted on test-agent ()  
✅ `11:03:43` The relay's health of the hosting is up  
✅ `11:03:43` Configured: secret A and region us  
✅ `11:03:43` The agent half holds secret A (by digest)…  
✅ `11:03:44` …and region us  

## While the agent runs, the relay sees it sync

✅ `11:03:44` The hosting carries agentLastSeenAt 2026-11-11T11:03:30.078Z: the agent synced within the last two minutes  
✅ `11:03:44` GET /api/certs/agent: test-agent carries lastSeenAt  
✅ `11:03:44` GET settings: live, the hosting up, the agent's last contact shown  
✅ `11:03:48` agentLastSeenAt advances as the agent syncs (2026-11-11T11:03:48.231Z)  

## The agent VM down: offline, read from the cache, writes refused

ℹ️ `11:03:48` Stopping lamaste-agent  
✅ `11:03:49` The agent VM is stopped  
✅ `11:03:50` agentLastSeenAt (2026-11-11T11:03:48.231Z) is from before the agent went down  
✅ `11:03:50` …its last sync, shortly before  
✅ `11:04:13` The health monitor reports the hosting down  
✅ `11:04:13` Hosting view: down, reason tunnel — nothing answers on the relay's end of the tunnel  
✅ `11:04:13` …since the agent went down (2026-11-11T11:04:10.864Z)  
✅ `11:04:13` …its agentLastSeenAt still the last sync  
✅ `11:04:14` The pages answer 502 while the hosting is down…  
✅ `11:04:14` …reason tunnel: the hosting agent is unreachable  
✅ `11:04:14` GET /api/plugins shows the hosting down  
✅ `11:04:14` …and the plugin configured, from the cache  
✅ `11:04:14` GET settings still answers  
✅ `11:04:14` …from the relay's cache  
✅ `11:04:14` …saying the hosting is down (tunnel)  
✅ `11:04:14` …and when the agent was last seen  
✅ `11:04:14` …with what was last synced: configured, region us, apiKey { set: true, setAt }  
✅ `11:04:14` …synced before the agent went down (2026-11-11T11:03:48.531Z; last live read 2026-11-11T11:03:48.531Z)  
✅ `11:04:14` A change is refused while the agent is offline (503)  
✅ `11:04:14` …hosting_offline, with the hosting's state  
✅ `11:04:15` …so is one that carries a new secret, C  
✅ `11:04:15` Secret C (and A) is on no relay file, in no state.db row, journal line or answer: nothing kept to deliver later  
✅ `11:04:15` …searches that find what is there  
✅ `11:05:00` agentLastSeenAt has not moved 70 seconds later  
✅ `11:05:01` …nor the agent's lastSeenAt on GET /api/certs/agent (2026-11-11T11:03:48.231Z)  
✅ `11:05:01` …which is from before the agent went down too  

## The agent VM back: up, live, writes accepted

ℹ️ `11:05:01` Starting lamaste-agent  
✅ `11:05:16` The agent VM is back  
✅ `11:05:34` The health monitor reports the hosting up again  
✅ `11:05:34` The pages answer again  
✅ `11:05:34` GET settings is live again  
✅ `11:05:34` A change is accepted again  
✅ `11:05:34` …and reaches the agent half (region eu, revision 2)  
✅ `11:05:34` The agent half still holds secret A: the offline write with secret C never arrived  
✅ `11:05:35` agentLastSeenAt advances again (2026-11-11T11:05:35.122Z)  
✅ `11:05:35` …and so does lastSeenAt on GET /api/certs/agent (2026-11-11T11:05:35.558Z)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `11:05:35` Cleaning up test resources...  
