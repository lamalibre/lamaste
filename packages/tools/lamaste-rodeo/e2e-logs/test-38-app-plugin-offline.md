# Lamaste E2E: 38 — App plugin with its hosting agent offline (Three-VM)

> Started at `2026-11-02 16:18:30 UTC`


## Pre-flight

✅ `16:18:30` Onboarding is complete  
✅ `16:18:30` Agent test-agent is enrolled on the host  
✅ `16:18:30` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `16:18:31` The agent VM's lamaste-agent has the apphost command  
ℹ️ `16:18:31` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Install, host and configure the plugin

✅ `16:18:31` Fixture built: @lamalibre/e2e-apphost-off-server 1.0.0 (settings v1) and its agent package  
✅ `16:18:33` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-off-server, @lamalibre/e2e-apphost-off-agent )  
✅ `16:18:33` The agent VM reaches it at http://10.13.37.1:4874  
✅ `16:18:34` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-02T16:18:35.152Z"})  
✅ `16:18:34` …through its own OIDC client  
✅ `16:18:34` Test secret A, made on the host VM in a 0600 file  
✅ `16:18:35` Test secret C, for a change while the agent is offline  
✅ `16:18:35` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `16:18:39` Installed @lamalibre/e2e-apphost-off-server@1.0.0 and approved its agent half  
✅ `16:18:50` Hosted on test-agent ()  
✅ `16:19:03` The relay's health of the hosting is up  
✅ `16:19:03` Configured: secret A and region us  
✅ `16:19:03` The agent half holds secret A (by digest)…  
✅ `16:19:03` …and region us  

## While the agent runs, the relay sees it sync

✅ `16:19:03` The hosting carries agentLastSeenAt 2026-11-02T16:18:50.481Z: the agent synced within the last two minutes  
✅ `16:19:04` GET /api/certs/agent: test-agent carries lastSeenAt  
✅ `16:19:04` GET settings: live, the hosting up, the agent's last contact shown  
✅ `16:19:07` agentLastSeenAt advances as the agent syncs (2026-11-02T16:19:08.234Z)  

## The agent VM down: offline, read from the cache, writes refused

ℹ️ `16:19:08` Stopping lamaste-agent  
✅ `16:19:08` The agent VM is stopped  
✅ `16:19:09` agentLastSeenAt (2026-11-02T16:19:08.234Z) is from before the agent went down  
✅ `16:19:09` …its last sync, shortly before  
✅ `16:19:35` The health monitor reports the hosting down  
✅ `16:19:35` Hosting view: down, reason tunnel — nothing answers on the relay's end of the tunnel  
✅ `16:19:35` …since the agent went down (2026-11-02T16:19:33.395Z)  
✅ `16:19:35` …its agentLastSeenAt still the last sync  
✅ `16:19:35` The pages answer 502 while the hosting is down…  
✅ `16:19:35` …reason tunnel: the hosting agent is unreachable  
✅ `16:19:35` GET /api/plugins shows the hosting down  
✅ `16:19:35` …and the plugin configured, from the cache  
✅ `16:19:36` GET settings still answers  
✅ `16:19:36` …from the relay's cache  
✅ `16:19:36` …saying the hosting is down (tunnel)  
✅ `16:19:36` …and when the agent was last seen  
✅ `16:19:36` …with what was last synced: configured, region us, apiKey { set: true, setAt }  
✅ `16:19:36` …synced before the agent went down (2026-11-02T16:19:08.440Z; last live read 2026-11-02T16:19:08.440Z)  
✅ `16:19:36` A change is refused while the agent is offline (503)  
✅ `16:19:36` …hosting_offline, with the hosting's state  
✅ `16:19:36` …so is one that carries a new secret, C  
✅ `16:19:36` Secret C (and A) is on no relay file, in no state.db row, journal line or answer: nothing kept to deliver later  
✅ `16:19:36` …searches that find what is there  
✅ `16:20:20` agentLastSeenAt has not moved 71 seconds later  
✅ `16:20:20` …nor the agent's lastSeenAt on GET /api/certs/agent (2026-11-02T16:19:08.234Z)  
✅ `16:20:20` …which is from before the agent went down too  

## The agent VM back: up, live, writes accepted

ℹ️ `16:20:20` Starting lamaste-agent  
✅ `16:20:34` The agent VM is back  
✅ `16:20:54` The health monitor reports the hosting up again  
✅ `16:20:55` The pages answer again  
✅ `16:20:55` GET settings is live again  
✅ `16:20:55` A change is accepted again  
✅ `16:20:55` …and reaches the agent half (region eu, revision 2)  
✅ `16:20:55` The agent half still holds secret A: the offline write with secret C never arrived  
✅ `16:20:55` agentLastSeenAt advances again (2026-11-02T16:20:56.047Z)  
✅ `16:20:56` …and so does lastSeenAt on GET /api/certs/agent (2026-11-02T16:20:56.606Z)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `16:20:56` Cleaning up test resources...  
