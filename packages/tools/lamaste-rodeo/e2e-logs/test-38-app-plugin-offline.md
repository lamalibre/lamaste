# Lamaste E2E: 38 — App plugin with its hosting agent offline (Three-VM)

> Started at `2026-11-10 08:01:09 UTC`


## Pre-flight

✅ `08:01:09` Onboarding is complete  
✅ `08:01:10` Agent test-agent is enrolled on the host  
✅ `08:01:10` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `08:01:10` The agent VM's lamaste-agent has the apphost command  
ℹ️ `08:01:10` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install, host and configure the plugin

✅ `08:01:11` Fixture built: @lamalibre/e2e-apphost-off-server 1.0.0 (settings v1) and its agent package  
✅ `08:01:19` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-off-server, @lamalibre/e2e-apphost-off-agent )  
✅ `08:01:20` The agent VM reaches it at http://10.13.37.1:4874  
✅ `08:01:21` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T08:01:21.289Z"})  
✅ `08:01:21` …through its own OIDC client  
✅ `08:01:21` Test secret A, made on the host VM in a 0600 file  
✅ `08:01:21` Test secret C, for a change while the agent is offline  
✅ `08:01:26` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `08:01:31` Installed @lamalibre/e2e-apphost-off-server@1.0.0 and approved its agent half  
✅ `08:01:42` Hosted on test-agent ()  
✅ `08:02:02` The relay's health of the hosting is up  
✅ `08:02:02` Configured: secret A and region us  
✅ `08:02:02` The agent half holds secret A (by digest)…  
✅ `08:02:02` …and region us  

## While the agent runs, the relay sees it sync

✅ `08:02:03` The hosting carries agentLastSeenAt 2026-11-10T08:01:42.214Z: the agent synced within the last two minutes  
✅ `08:02:03` GET /api/certs/agent: test-agent carries lastSeenAt  
✅ `08:02:03` GET settings: live, the hosting up, the agent's last contact shown  
✅ `08:02:07` agentLastSeenAt advances as the agent syncs (2026-11-10T08:02:07.485Z)  

## The agent VM down: offline, read from the cache, writes refused

ℹ️ `08:02:08` Stopping lamaste-agent  
✅ `08:02:09` The agent VM is stopped  
✅ `08:02:09` agentLastSeenAt (2026-11-10T08:02:07.485Z) is from before the agent went down  
✅ `08:02:09` …its last sync, shortly before  
✅ `08:02:32` The health monitor reports the hosting down  
✅ `08:02:32` Hosting view: down, reason tunnel — nothing answers on the relay's end of the tunnel  
✅ `08:02:32` …since the agent went down (2026-11-10T08:02:30.694Z)  
✅ `08:02:32` …its agentLastSeenAt still the last sync  
✅ `08:02:33` The pages answer 502 while the hosting is down…  
✅ `08:02:33` …reason tunnel: the hosting agent is unreachable  
✅ `08:02:33` GET /api/plugins shows the hosting down  
✅ `08:02:33` …and the plugin configured, from the cache  
✅ `08:02:33` GET settings still answers  
✅ `08:02:33` …from the relay's cache  
✅ `08:02:33` …saying the hosting is down (tunnel)  
✅ `08:02:33` …and when the agent was last seen  
✅ `08:02:33` …with what was last synced: configured, region us, apiKey { set: true, setAt }  
✅ `08:02:33` …synced before the agent went down (2026-11-10T08:02:08.045Z; last live read 2026-11-10T08:02:08.045Z)  
✅ `08:02:33` A change is refused while the agent is offline (503)  
✅ `08:02:33` …hosting_offline, with the hosting's state  
✅ `08:02:34` …so is one that carries a new secret, C  
✅ `08:02:34` Secret C (and A) is on no relay file, in no state.db row, journal line or answer: nothing kept to deliver later  
✅ `08:02:34` …searches that find what is there  
✅ `08:03:20` agentLastSeenAt has not moved 71 seconds later  
✅ `08:03:20` …nor the agent's lastSeenAt on GET /api/certs/agent (2026-11-10T08:02:07.485Z)  
✅ `08:03:20` …which is from before the agent went down too  

## The agent VM back: up, live, writes accepted

ℹ️ `08:03:20` Starting lamaste-agent  
✅ `08:03:35` The agent VM is back  
✅ `08:03:53` The health monitor reports the hosting up again  
✅ `08:03:53` The pages answer again  
✅ `08:03:53` GET settings is live again  
✅ `08:03:53` A change is accepted again  
✅ `08:03:53` …and reaches the agent half (region eu, revision 2)  
✅ `08:03:53` The agent half still holds secret A: the offline write with secret C never arrived  
✅ `08:03:54` agentLastSeenAt advances again (2026-11-10T08:03:54.170Z)  
✅ `08:03:54` …and so does lastSeenAt on GET /api/certs/agent (2026-11-10T08:03:54.661Z)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `08:03:54` Cleaning up test resources...  
