# Lamaste E2E: 58 — Calls between app plugins on two agents (Three-VM)

> Started at `2026-11-10 19:25:31 UTC`


## Pre-flight, the second agent, both plugins hosted

✅ `19:25:31` Onboarding is complete  
✅ `19:25:32` Agent test-agent is enrolled on the host  
✅ `19:25:32` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `19:25:32` The agent VM's lamaste-agent has the apphost command  
✅ `19:25:33` Fixtures built: @lamalibre/e2e-pdir-server (provides e2e-pdir:read, e2e-pdir:write) and @lamalibre/e2e-pcons-server (consumes both)  
✅ `19:25:44` lamaste-agent installed on the visitor VM from the dev Feria (INSTALLED)  
✅ `19:25:45` An enrolment token for peer-agent2  
✅ `19:25:49` lamaste-agent setup on the visitor VM (  for it, the sync timer starts carrying it within 30 seconds.)  
✅ `19:25:49` The second agent peer-agent2 is enrolled and its sync timer is active  
✅ `19:25:53` The second agent's app host helper is enabled and the relay knows it from its host facts  
✅ `19:26:09` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-pdir-server, @lamalibre/e2e-pdir-agent, @lamalibre/e2e-pcons-server, @lamalibre/e2e-pcons-agent )  
✅ `19:26:09` The agent VM reaches it at http://10.13.37.1:4874  
✅ `19:26:10` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T19:26:10.371Z"})  
✅ `19:26:10` …through its own OIDC client  
✅ `19:26:14` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `19:26:24` e2e-pdir installed and approved (its peers block in the digest)  
✅ `19:26:24` e2e-pcons installed and approved  
✅ `19:26:36` e2e-pdir hosted on test-agent (agent VM) ()  
✅ `19:26:46` e2e-pcons hosted on peer-agent2 (visitor VM) ()  
✅ `19:26:47` Both halves are identity-ready (their feeds at the head)  
✅ `19:26:47` The relay attached its peer channel to e2e-pcons's half on the visitor VM  

## No shelf applied: nothing is granted

✅ `19:26:47` A call before any shelf is applied: 403 not_granted  
✅ `19:26:47` …a scope no installed plugin provides is answered alike (not_granted)  
✅ `19:26:47` GET /api/peers: e2e-pdir provides e2e-pdir:read and e2e-pdir:write  
✅ `19:26:47` …no shelf e2e-peers applied  

## Applying a shelf: refusals, then the edge

✅ `19:26:47` A scope whose namespace is not its provider's route is refused (400)  
✅ `19:26:48` A consumer that is not installed is kept pending or refused: 200 [{"scope":"e2e-pdir:read","provider":"e2e-pdir","consumer":"e2e-idsurf","state":"pending","reason":"consumer_not_installed","grantedSeq":1}]  
✅ `19:26:48` PUT /api/peers/shelves/e2e-peers: e2e-pdir:read granted to e2e-pcons  
✅ `19:26:48` GET /api/peers: the edge e2e-pcons → e2e-pdir:read is effective  
✅ `19:26:48` Audited: peer.shelf.applied  

## A granted call, from the visitor VM's agent to the agent VM's

✅ `19:26:48` GET /units/7 on e2e-pdir:read: 200 from the provider  
✅ `19:26:48` …the provider saw the peer caller the relay signed: e2e-pcons, e2e-pdir:read, major 1, one hop  
✅ `19:26:48` …and the endpoint pattern the relay matched  
✅ `19:26:48` …no user: the plugin called as itself  

## Denied: no grant, not in the allowlist, a sibling route

✅ `19:26:49` e2e-pdir:write is not granted: 403 not_granted  
✅ `19:26:49` GET /secret, which the provider serves but does not declare: 403 endpoint_not_allowed  
✅ `19:26:49` GET /units/export (matches /units/:unitId, a static route of its own on the provider): 403  
✅ `19:26:49` …the provider's SDK refused it: its route is not the endpoint the relay matched  
✅ `19:26:49` The provider's handlers ran only for the allowlisted route — never /secret, never /units/export  
✅ `19:26:49` The relay's refusals are audited (peer.call.denied: 2)  

## The shelf widened to e2e-pdir:write

✅ `19:26:49` Re-applied with e2e-pdir:write too  
✅ `19:26:50` POST /echo with a body: 200, echoed, under e2e-pdir:write  
✅ `19:26:50` e2e-pdir:read still answers (its edge kept across the re-apply)  

## The provider cannot go while the consumer depends on it

✅ `19:26:50` Unhosting the provider: 409, even with force  
✅ `19:26:50` …peer_dependents, naming e2e-pcons  
✅ `19:26:50` The provider disabled (an uninstall needs it)  
✅ `19:26:50` A disabled provider's edges are pending: a call is 403 not_granted  
✅ `19:26:50` …GET /api/peers shows the edge pending (provider_disabled)  
✅ `19:26:51` Uninstalling the provider: 409, even with force  
✅ `19:26:51` …peer_dependents  
✅ `19:26:51` Enabled again  
✅ `19:26:51` …and it answers again  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `52` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `52` |

ℹ️ `19:26:51` Cleaning up test resources...  
