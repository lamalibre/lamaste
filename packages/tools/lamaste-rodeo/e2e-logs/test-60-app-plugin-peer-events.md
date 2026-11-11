# Lamaste E2E: 60 — Events between app plugins across a consumer restart (Three-VM)

> Started at `2026-11-10 19:34:46 UTC`


## Pre-flight, both plugins hosted, the shelf applied

✅ `19:34:46` Onboarding is complete  
✅ `19:34:47` Agent test-agent is enrolled on the host  
✅ `19:34:47` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `19:34:47` The agent VM's lamaste-agent has the apphost command  
✅ `19:34:48` Fixtures built: @lamalibre/e2e-pdir-server (provides e2e-pdir:read, e2e-pdir:write) and @lamalibre/e2e-pcons-server (consumes both)  
✅ `19:34:48` The second agent peer-agent2 (visitor VM) is enrolled and syncing  
✅ `19:34:50` The second agent's app host helper is enabled and the relay knows it from its host facts  
✅ `19:35:04` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-pdir-server, @lamalibre/e2e-pdir-agent, @lamalibre/e2e-pcons-server, @lamalibre/e2e-pcons-agent )  
✅ `19:35:04` The agent VM reaches it at http://10.13.37.1:4874  
✅ `19:35:05` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T19:35:05.779Z"})  
✅ `19:35:05` …through its own OIDC client  
✅ `19:35:10` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `19:35:20` e2e-pdir installed and approved (its peers block in the digest)  
✅ `19:35:20` e2e-pcons installed and approved  
✅ `19:35:31` e2e-pdir hosted on test-agent (agent VM) ()  
✅ `19:35:41` e2e-pcons hosted on peer-agent2 (visitor VM) ()  
✅ `19:35:42` Both halves are identity-ready (their feeds at the head)  
✅ `19:35:42` The relay attached its peer channel to e2e-pcons's half on the visitor VM  
✅ `19:35:42` Two events published before the consumer was ever granted anything  
✅ `19:35:42` The shelf grants e2e-pdir:read (and its unit.changed events) to e2e-pcons  
✅ `19:35:42` GET /api/peers: the subscription to unit.changed  

## First contact: an initial gap, then the events in order

✅ `19:35:46` The consumer started with an 'initial' gap: onGap ran (its reconcile)  
✅ `19:35:46` …and was given none of the events from before its starting point  
✅ `19:35:46` Three events delivered in order: a-1,a-2,a-3  

## The consumer's agent half stopped: events wait, then come once

✅ `19:36:14` The relay's health of e2e-pcons is down (app)  
✅ `19:36:14` Four events published while the consumer is stopped  
✅ `19:36:31` Started again: up, and the relay attached its channel anew  
✅ `19:36:31` It caught up from its cursor: b-1..b-4 after a-1..a-3  
✅ `19:36:31` Every event exactly once, in order of the provider's seq  
✅ `19:36:31` No gap across the restart: the cursor was enough  

## The grant removed, events meanwhile, granted again

✅ `19:36:31` The shelf removed  
✅ `19:36:52` Events published without a grant are not delivered  
✅ `19:36:52` The consumer will hold its next reconcile open  
✅ `19:36:52` The shelf applied again  
✅ `19:37:06` Granted again: a 'granted' gap (a new epoch), onGap running  
✅ `19:37:06` The pending gap: granted, resuming from 11 — past c-1 and c-2  
✅ `19:37:06` A pull by hand with the gap's epoch and stream from position 0: answered ()  
✅ `19:37:06` …with a gap and no events: c-1 and c-2, published without a grant, stay out of reach  
✅ `19:37:06` The reconcile released  
✅ `19:37:07` Only what came after the new grant is delivered: d-1, never c-1 or c-2  
✅ `19:37:07` Still each exactly once, in order  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `41` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `41` |

ℹ️ `19:37:07` Cleaning up test resources...  
