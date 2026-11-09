# Lamaste E2E: 38 — App plugin with its hosting agent offline (Three-VM)

> Started at `2026-11-09 13:12:13 UTC`


## Pre-flight

✅ `13:12:14` Onboarding is complete  
✅ `13:12:14` Agent test-agent is enrolled on the host  
✅ `13:12:14` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:12:14` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:12:14` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install, host and configure the plugin

✅ `13:12:15` Fixture built: @lamalibre/e2e-apphost-off-server 1.0.0 (settings v1) and its agent package  
✅ `13:12:23` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-off-server, @lamalibre/e2e-apphost-off-agent )  
✅ `13:12:23` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:12:24` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T13:12:24.577Z"})  
✅ `13:12:24` …through its own OIDC client  
✅ `13:12:24` Test secret A, made on the host VM in a 0600 file  
✅ `13:12:24` Test secret C, for a change while the agent is offline  
✅ `13:12:25` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:12:30` Installed @lamalibre/e2e-apphost-off-server@1.0.0 and approved its agent half  
✅ `13:12:40` Hosted on test-agent ()  
✅ `13:13:03` The relay's health of the hosting is up  
✅ `13:13:03` Configured: secret A and region us  
✅ `13:13:03` The agent half holds secret A (by digest)…  
✅ `13:13:03` …and region us  

## While the agent runs, the relay sees it sync

✅ `13:13:04` The hosting carries agentLastSeenAt 2026-11-09T13:12:40.968Z: the agent synced within the last two minutes  
✅ `13:13:04` GET /api/certs/agent: test-agent carries lastSeenAt  
✅ `13:13:04` GET settings: live, the hosting up, the agent's last contact shown  
✅ `13:13:08` agentLastSeenAt advances as the agent syncs (2026-11-09T13:13:08.010Z)  

## The agent VM down: offline, read from the cache, writes refused

ℹ️ `13:13:08` Stopping lamaste-agent  
✅ `13:13:09` The agent VM is stopped  
✅ `13:13:09` agentLastSeenAt (2026-11-09T13:13:08.010Z) is from before the agent went down  
✅ `13:13:09` …its last sync, shortly before  
✅ `13:13:31` The health monitor reports the hosting down  
✅ `13:13:32` Hosting view: down, reason tunnel — nothing answers on the relay's end of the tunnel  
✅ `13:13:32` …since the agent went down (2026-11-09T13:13:30.725Z)  
✅ `13:13:32` …its agentLastSeenAt still the last sync  
✅ `13:13:32` The pages answer 502 while the hosting is down…  
✅ `13:13:32` …reason tunnel: the hosting agent is unreachable  
✅ `13:13:32` GET /api/plugins shows the hosting down  
✅ `13:13:32` …and the plugin configured, from the cache  
✅ `13:13:32` GET settings still answers  
✅ `13:13:32` …from the relay's cache  
✅ `13:13:32` …saying the hosting is down (tunnel)  
✅ `13:13:32` …and when the agent was last seen  
✅ `13:13:32` …with what was last synced: configured, region us, apiKey { set: true, setAt }  
✅ `13:13:32` …synced before the agent went down (2026-11-09T13:13:08.360Z; last live read 2026-11-09T13:13:08.360Z)  
✅ `13:13:32` A change is refused while the agent is offline (503)  
✅ `13:13:32` …hosting_offline, with the hosting's state  
✅ `13:13:32` …so is one that carries a new secret, C  
✅ `13:13:33` Secret C (and A) is on no relay file, in no state.db row, journal line or answer: nothing kept to deliver later  
✅ `13:13:33` …searches that find what is there  
✅ `13:14:19` agentLastSeenAt has not moved 70 seconds later  
✅ `13:14:19` …nor the agent's lastSeenAt on GET /api/certs/agent (2026-11-09T13:13:08.010Z)  
✅ `13:14:19` …which is from before the agent went down too  

## The agent VM back: up, live, writes accepted

ℹ️ `13:14:19` Starting lamaste-agent  
✅ `13:14:33` The agent VM is back  
✅ `13:14:53` The health monitor reports the hosting up again  
✅ `13:14:53` The pages answer again  
✅ `13:14:53` GET settings is live again  
✅ `13:14:54` A change is accepted again  
✅ `13:14:54` …and reaches the agent half (region eu, revision 2)  
✅ `13:14:54` The agent half still holds secret A: the offline write with secret C never arrived  
✅ `13:14:54` agentLastSeenAt advances again (2026-11-09T13:14:54.462Z)  
✅ `13:14:54` …and so does lastSeenAt on GET /api/certs/agent (2026-11-09T13:14:54.774Z)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `13:14:54` Cleaning up test resources...  
