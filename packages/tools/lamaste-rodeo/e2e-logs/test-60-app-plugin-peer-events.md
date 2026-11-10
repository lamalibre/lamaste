# Lamaste E2E: 60 — Events between app plugins across a consumer restart (Three-VM)

> Started at `2026-11-10 08:26:33 UTC`


## Pre-flight, both plugins hosted, the shelf applied

✅ `08:26:33` Onboarding is complete  
✅ `08:26:33` Agent test-agent is enrolled on the host  
✅ `08:26:33` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `08:26:34` The agent VM's lamaste-agent has the apphost command  
✅ `08:26:35` Fixtures built: @lamalibre/e2e-pdir-server (provides e2e-pdir:read, e2e-pdir:write) and @lamalibre/e2e-pcons-server (consumes both)  
✅ `08:26:35` The second agent peer-agent2 (visitor VM) is enrolled and syncing  
✅ `08:26:36` The second agent's app host helper is enabled and the relay knows it from its host facts  
✅ `08:26:51` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-pdir-server, @lamalibre/e2e-pdir-agent, @lamalibre/e2e-pcons-server, @lamalibre/e2e-pcons-agent )  
✅ `08:26:52` The agent VM reaches it at http://10.13.37.1:4874  
✅ `08:26:53` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T08:26:53.221Z"})  
✅ `08:26:53` …through its own OIDC client  
✅ `08:26:57` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `08:27:07` e2e-pdir installed and approved (its peers block in the digest)  
✅ `08:27:08` e2e-pcons installed and approved  
✅ `08:27:19` e2e-pdir hosted on test-agent (agent VM) ()  
✅ `08:27:29` e2e-pcons hosted on peer-agent2 (visitor VM) ()  
✅ `08:27:30` Both halves are identity-ready (their feeds at the head)  
✅ `08:27:30` The relay attached its peer channel to e2e-pcons's half on the visitor VM  
✅ `08:27:30` Two events published before the consumer was ever granted anything  
✅ `08:27:30` The shelf grants e2e-pdir:read (and its unit.changed events) to e2e-pcons  
✅ `08:27:30` GET /api/peers: the subscription to unit.changed  

## First contact: an initial gap, then the events in order

✅ `08:27:34` The consumer started with an 'initial' gap: onGap ran (its reconcile)  
✅ `08:27:34` …and was given none of the events from before its starting point  
✅ `08:27:35` Three events delivered in order: a-1,a-2,a-3  

## The consumer's agent half stopped: events wait, then come once

✅ `08:28:01` The relay's health of e2e-pcons is down (app)  
✅ `08:28:02` Four events published while the consumer is stopped  
✅ `08:28:22` Started again: up, and the relay attached its channel anew  
✅ `08:28:22` It caught up from its cursor: b-1..b-4 after a-1..a-3  
✅ `08:28:22` Every event exactly once, in order of the provider's seq  
✅ `08:28:23` No gap across the restart: the cursor was enough  

## The grant removed, events meanwhile, granted again

✅ `08:28:23` The shelf removed  
✅ `08:28:43` Events published without a grant are not delivered  
✅ `08:28:43` The consumer will hold its next reconcile open  
✅ `08:28:44` The shelf applied again  
✅ `08:28:57` Granted again: a 'granted' gap (a new epoch), onGap running  
✅ `08:28:57` The pending gap: granted, resuming from 11 — past c-1 and c-2  
✅ `08:28:57` A pull by hand with the gap's epoch and stream from position 0: answered ()  
✅ `08:28:57` …with a gap and no events: c-1 and c-2, published without a grant, stay out of reach  
✅ `08:28:58` The reconcile released  
✅ `08:28:58` Only what came after the new grant is delivered: d-1, never c-1 or c-2  
✅ `08:28:58` Still each exactly once, in order  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `41` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `41` |

ℹ️ `08:28:58` Cleaning up test resources...  
