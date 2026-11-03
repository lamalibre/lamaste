# Lamaste E2E: 38 — App plugin with its hosting agent offline (Three-VM)

> Started at `2026-11-03 10:00:38 UTC`


## Pre-flight

✅ `10:00:39` Onboarding is complete  
✅ `10:00:39` Agent test-agent is enrolled on the host  
✅ `10:00:39` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:00:39` The agent VM's lamaste-agent has the apphost command  
ℹ️ `10:00:39` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install, host and configure the plugin

✅ `10:00:39` Fixture built: @lamalibre/e2e-apphost-off-server 1.0.0 (settings v1) and its agent package  
✅ `10:00:48` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-off-server, @lamalibre/e2e-apphost-off-agent )  
✅ `10:00:48` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:00:50` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T10:00:49.917Z"})  
✅ `10:00:50` …through its own OIDC client  
✅ `10:00:50` Test secret A, made on the host VM in a 0600 file  
✅ `10:00:50` Test secret C, for a change while the agent is offline  
✅ `10:00:51` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:00:56` Installed @lamalibre/e2e-apphost-off-server@1.0.0 and approved its agent half  
✅ `10:01:06` Hosted on test-agent ()  
✅ `10:01:19` The relay's health of the hosting is up  
✅ `10:01:20` Configured: secret A and region us  
✅ `10:01:20` The agent half holds secret A (by digest)…  
✅ `10:01:20` …and region us  

## While the agent runs, the relay sees it sync

✅ `10:01:20` The hosting carries agentLastSeenAt 2026-11-03T10:01:06.697Z: the agent synced within the last two minutes  
✅ `10:01:20` GET /api/certs/agent: test-agent carries lastSeenAt  
✅ `10:01:20` GET settings: live, the hosting up, the agent's last contact shown  
✅ `10:01:24` agentLastSeenAt advances as the agent syncs (2026-11-03T10:01:24.360Z)  

## The agent VM down: offline, read from the cache, writes refused

ℹ️ `10:01:24` Stopping lamaste-agent  
✅ `10:01:25` The agent VM is stopped  
✅ `10:01:25` agentLastSeenAt (2026-11-03T10:01:24.360Z) is from before the agent went down  
✅ `10:01:25` …its last sync, shortly before  
✅ `10:01:48` The health monitor reports the hosting down  
✅ `10:01:48` Hosting view: down, reason tunnel — nothing answers on the relay's end of the tunnel  
✅ `10:01:48` …since the agent went down (2026-11-03T10:01:48.071Z)  
✅ `10:01:48` …its agentLastSeenAt still the last sync  
✅ `10:01:48` The pages answer 502 while the hosting is down…  
✅ `10:01:48` …reason tunnel: the hosting agent is unreachable  
✅ `10:01:48` GET /api/plugins shows the hosting down  
✅ `10:01:48` …and the plugin configured, from the cache  
✅ `10:01:49` GET settings still answers  
✅ `10:01:49` …from the relay's cache  
✅ `10:01:49` …saying the hosting is down (tunnel)  
✅ `10:01:49` …and when the agent was last seen  
✅ `10:01:49` …with what was last synced: configured, region us, apiKey { set: true, setAt }  
✅ `10:01:49` …synced before the agent went down (2026-11-03T10:01:24.586Z; last live read 2026-11-03T10:01:24.586Z)  
✅ `10:01:49` A change is refused while the agent is offline (503)  
✅ `10:01:49` …hosting_offline, with the hosting's state  
✅ `10:01:49` …so is one that carries a new secret, C  
✅ `10:01:49` Secret C (and A) is on no relay file, in no state.db row, journal line or answer: nothing kept to deliver later  
✅ `10:01:49` …searches that find what is there  
✅ `10:02:36` agentLastSeenAt has not moved 71 seconds later  
✅ `10:02:36` …nor the agent's lastSeenAt on GET /api/certs/agent (2026-11-03T10:01:24.360Z)  
✅ `10:02:36` …which is from before the agent went down too  

## The agent VM back: up, live, writes accepted

ℹ️ `10:02:36` Starting lamaste-agent  
✅ `10:03:03` The agent VM is back  
✅ `10:03:10` The health monitor reports the hosting up again  
✅ `10:03:10` The pages answer again  
✅ `10:03:11` GET settings is live again  
✅ `10:03:11` A change is accepted again  
✅ `10:03:11` …and reaches the agent half (region eu, revision 2)  
✅ `10:03:11` The agent half still holds secret A: the offline write with secret C never arrived  
✅ `10:03:11` agentLastSeenAt advances again (2026-11-03T10:03:11.606Z)  
✅ `10:03:12` …and so does lastSeenAt on GET /api/certs/agent (2026-11-03T10:03:12.021Z)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `10:03:12` Cleaning up test resources...  
