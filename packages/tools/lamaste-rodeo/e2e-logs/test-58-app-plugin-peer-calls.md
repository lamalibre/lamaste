# Lamaste E2E: 58 — Calls between app plugins on two agents (Three-VM)

> Started at `2026-11-11 10:19:30 UTC`


## Pre-flight, the second agent, both plugins hosted

✅ `10:19:30` Onboarding is complete  
✅ `10:19:30` Agent test-agent is enrolled on the host  
✅ `10:19:31` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:19:31` The agent VM's lamaste-agent has the apphost command  
✅ `10:19:32` Fixtures built: @lamalibre/e2e-pdir-server (provides e2e-pdir:read, e2e-pdir:write) and @lamalibre/e2e-pcons-server (consumes both)  
✅ `10:19:43` lamaste-agent installed on the visitor VM from the dev Feria (INSTALLED)  
✅ `10:19:44` An enrolment token for peer-agent2  
✅ `10:19:48` lamaste-agent setup on the visitor VM (  for it, the sync timer starts carrying it within 30 seconds.)  
✅ `10:19:49` The second agent peer-agent2 is enrolled and its sync timer is active  
✅ `10:19:53` The second agent's app host helper is enabled and the relay knows it from its host facts  
✅ `10:20:09` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-pdir-server, @lamalibre/e2e-pdir-agent, @lamalibre/e2e-pcons-server, @lamalibre/e2e-pcons-agent )  
✅ `10:20:09` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:20:10` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T10:20:10.294Z"})  
✅ `10:20:10` …through its own OIDC client  
✅ `10:20:11` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:20:21` e2e-pdir installed and approved (its peers block in the digest)  
✅ `10:20:21` e2e-pcons installed and approved  
✅ `10:20:32` e2e-pdir hosted on test-agent (agent VM) ()  
✅ `10:20:43` e2e-pcons hosted on peer-agent2 (visitor VM) ()  
✅ `10:20:43` Both halves are identity-ready (their feeds at the head)  
✅ `10:20:44` The relay attached its peer channel to e2e-pcons's half on the visitor VM  

## No shelf applied: nothing is granted

✅ `10:20:44` A call before any shelf is applied: 403 not_granted  
✅ `10:20:44` …a scope no installed plugin provides is answered alike (not_granted)  
✅ `10:20:44` GET /api/peers: e2e-pdir provides e2e-pdir:read and e2e-pdir:write  
✅ `10:20:44` …no shelf e2e-peers applied  

## Applying a shelf: refusals, then the edge

✅ `10:20:44` A scope whose namespace is not its provider's route is refused (400)  
✅ `10:20:44` A consumer that is not installed is kept pending or refused: 200 [{"scope":"e2e-pdir:read","provider":"e2e-pdir","consumer":"e2e-idsurf","state":"pending","reason":"consumer_not_installed","grantedSeq":1}]  
✅ `10:20:45` PUT /api/peers/shelves/e2e-peers: e2e-pdir:read granted to e2e-pcons  
✅ `10:20:45` GET /api/peers: the edge e2e-pcons → e2e-pdir:read is effective  
✅ `10:20:45` Audited: peer.shelf.applied  

## A granted call, from the visitor VM's agent to the agent VM's

✅ `10:20:45` GET /units/7 on e2e-pdir:read: 200 from the provider  
✅ `10:20:45` …the provider saw the peer caller the relay signed: e2e-pcons, e2e-pdir:read, major 1, one hop  
✅ `10:20:45` …and the endpoint pattern the relay matched  
✅ `10:20:45` …no user: the plugin called as itself  

## Denied: no grant, not in the allowlist, a sibling route

✅ `10:20:45` e2e-pdir:write is not granted: 403 not_granted  
✅ `10:20:46` GET /secret, which the provider serves but does not declare: 403 endpoint_not_allowed  
✅ `10:20:46` GET /units/export (matches /units/:unitId, a static route of its own on the provider): 403  
✅ `10:20:46` …the provider's SDK refused it: its route is not the endpoint the relay matched  
✅ `10:20:46` The provider's handlers ran only for the allowlisted route — never /secret, never /units/export  
✅ `10:20:46` The relay's refusals are audited (peer.call.denied: 2)  

## The shelf widened to e2e-pdir:write

✅ `10:20:46` Re-applied with e2e-pdir:write too  
✅ `10:20:46` POST /echo with a body: 200, echoed, under e2e-pdir:write  
✅ `10:20:47` e2e-pdir:read still answers (its edge kept across the re-apply)  

## The provider cannot go while the consumer depends on it

✅ `10:20:47` Unhosting the provider: 409, even with force  
✅ `10:20:47` …peer_dependents, naming e2e-pcons  
✅ `10:20:47` The provider disabled (an uninstall needs it)  
✅ `10:20:47` A disabled provider's edges are pending: a call is 403 not_granted  
✅ `10:20:48` …GET /api/peers shows the edge pending (provider_disabled)  
✅ `10:20:48` Uninstalling the provider: 409, even with force  
✅ `10:20:48` …peer_dependents  
✅ `10:20:48` Enabled again  
✅ `10:20:48` …and it answers again  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `52` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `52` |

ℹ️ `10:20:48` Cleaning up test resources...  
