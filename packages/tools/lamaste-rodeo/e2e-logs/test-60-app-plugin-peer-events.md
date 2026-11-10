# Lamaste E2E: 60 — Events between app plugins across a consumer restart (Three-VM)

> Started at `2026-11-10 14:51:12 UTC`


## Pre-flight, both plugins hosted, the shelf applied

✅ `14:51:12` Onboarding is complete  
✅ `14:51:12` Agent test-agent is enrolled on the host  
✅ `14:51:13` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:51:13` The agent VM's lamaste-agent has the apphost command  
✅ `14:51:14` Fixtures built: @lamalibre/e2e-pdir-server (provides e2e-pdir:read, e2e-pdir:write) and @lamalibre/e2e-pcons-server (consumes both)  
✅ `14:51:14` The second agent peer-agent2 (visitor VM) is enrolled and syncing  
✅ `14:51:15` The second agent's app host helper is enabled and the relay knows it from its host facts  
✅ `14:51:30` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-pdir-server, @lamalibre/e2e-pdir-agent, @lamalibre/e2e-pcons-server, @lamalibre/e2e-pcons-agent )  
✅ `14:51:30` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:51:31` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T14:51:31.952Z"})  
✅ `14:51:31` …through its own OIDC client  
✅ `14:51:36` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:51:46` e2e-pdir installed and approved (its peers block in the digest)  
✅ `14:51:46` e2e-pcons installed and approved  
✅ `14:51:57` e2e-pdir hosted on test-agent (agent VM) ()  
✅ `14:52:08` e2e-pcons hosted on peer-agent2 (visitor VM) ()  
✅ `14:52:08` Both halves are identity-ready (their feeds at the head)  
✅ `14:52:08` The relay attached its peer channel to e2e-pcons's half on the visitor VM  
✅ `14:52:08` Two events published before the consumer was ever granted anything  
✅ `14:52:09` The shelf grants e2e-pdir:read (and its unit.changed events) to e2e-pcons  
✅ `14:52:09` GET /api/peers: the subscription to unit.changed  

## First contact: an initial gap, then the events in order

✅ `14:52:12` The consumer started with an 'initial' gap: onGap ran (its reconcile)  
✅ `14:52:13` …and was given none of the events from before its starting point  
✅ `14:52:13` Three events delivered in order: a-1,a-2,a-3  

## The consumer's agent half stopped: events wait, then come once

✅ `14:52:43` The relay's health of e2e-pcons is down (app)  
✅ `14:52:44` Four events published while the consumer is stopped  
✅ `14:53:04` Started again: up, and the relay attached its channel anew  
✅ `14:53:04` It caught up from its cursor: b-1..b-4 after a-1..a-3  
✅ `14:53:05` Every event exactly once, in order of the provider's seq  
✅ `14:53:05` No gap across the restart: the cursor was enough  

## The grant removed, events meanwhile, granted again

✅ `14:53:05` The shelf removed  
✅ `14:53:25` Events published without a grant are not delivered  
✅ `14:53:26` The consumer will hold its next reconcile open  
✅ `14:53:26` The shelf applied again  
✅ `14:53:39` Granted again: a 'granted' gap (a new epoch), onGap running  
✅ `14:53:40` The pending gap: granted, resuming from 11 — past c-1 and c-2  
✅ `14:53:40` A pull by hand with the gap's epoch and stream from position 0: answered ()  
✅ `14:53:40` …with a gap and no events: c-1 and c-2, published without a grant, stay out of reach  
✅ `14:53:40` The reconcile released  
✅ `14:53:40` Only what came after the new grant is delivered: d-1, never c-1 or c-2  
✅ `14:53:40` Still each exactly once, in order  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `41` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `41` |

ℹ️ `14:53:40` Cleaning up test resources...  
