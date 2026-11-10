# Lamaste E2E: 59 — A call on behalf of a user (Three-VM)

> Started at `2026-11-10 08:20:07 UTC`


## Pre-flight, users, both plugins hosted, the shelf applied

✅ `08:20:07` Onboarding is complete  
✅ `08:20:08` Agent test-agent is enrolled on the host  
✅ `08:20:08` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `08:20:09` The agent VM's lamaste-agent has the apphost command  
✅ `08:20:11` User e2e59-both created  
✅ `08:20:11` User e2e59-only created  
✅ `08:20:12` Fixtures built: @lamalibre/e2e-pdir-server (provides e2e-pdir:read, e2e-pdir:write) and @lamalibre/e2e-pcons-server (consumes both)  
✅ `08:20:12` The second agent peer-agent2 (visitor VM) is enrolled and syncing  
✅ `08:20:13` The second agent's app host helper is enabled and the relay knows it from its host facts  
✅ `08:20:29` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-pdir-server, @lamalibre/e2e-pdir-agent, @lamalibre/e2e-pcons-server, @lamalibre/e2e-pcons-agent )  
✅ `08:20:29` The agent VM reaches it at http://10.13.37.1:4874  
✅ `08:20:30` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T08:20:30.759Z"})  
✅ `08:20:30` …through its own OIDC client  
✅ `08:20:35` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `08:20:45` e2e-pdir installed and approved (its peers block in the digest)  
✅ `08:20:45` e2e-pcons installed and approved  
✅ `08:20:56` e2e-pdir hosted on test-agent (agent VM) ()  
✅ `08:21:08` e2e-pcons hosted on peer-agent2 (visitor VM) ()  
✅ `08:21:08` Both halves are identity-ready (their feeds at the head)  
✅ `08:21:08` The relay attached its peer channel to e2e-pcons's half on the visitor VM  
✅ `08:21:08` The shelf grants e2e-pdir:read to e2e-pcons  
✅ `08:21:08` e2e59-both entitled to e2e-pcons (viewer)  
✅ `08:21:09` e2e59-both entitled to e2e-pdir (viewer)  
✅ `08:21:09` e2e59-only entitled to e2e-pcons only  
✅ `08:21:09` The audiences hold them: e2e59-both in both, e2e59-only in e2e-pcons  

## The consumer's user surface, on a tunnel its hosting agent carries

✅ `08:21:10` Tunnel e2e59pc.test.lamaste.local, carried by peer-agent2  
✅ `08:21:11` Bound as e2e-pcons's user surface  
✅ `08:21:11` …served: the tunnel's agent is the plugin's hosting agent  
✅ `08:21:33` e2e59-both signed in from the visitor VM  
✅ `08:21:35` e2e59-only signed in  

## On behalf of e2e59-both: the provider learns who

✅ `08:21:35` GET /api/e2e-pcons/app/me-via-peer as e2e59-both: 200  
✅ `08:21:35` The relay gave the consumer a delegation with the request  
✅ `08:21:35` The call on e2e59-both's behalf: 200 from the provider ()  
✅ `08:21:35` …the peer caller: e2e-pcons, its endpoint  
✅ `08:21:35` …and the user: the directory's id, the username, the roles in the provider  
✅ `08:21:35` …for the path the consumer built from the user it was told  

## On behalf of e2e59-only, whom the provider's audience does not hold

✅ `08:21:35` GET /api/e2e-pcons/app/me-via-peer as e2e59-only: the consumer answers  
✅ `08:21:35` …its call on e2e59-only's behalf: 403 user_not_entitled — never named to the provider  

## A delegation the consumer made up

✅ `08:21:36` A made-up delegation: 401 delegation_invalid  
✅ `08:21:36` …the provider's handler never ran  
✅ `08:21:36` Without a delegation the same call is the plugin's own: no user  

## e2e59-both disabled

✅ `08:21:36` e2e59-both disabled  
✅ `08:21:37` e2e59-both's next request is refused at the user surface (401)  
✅ `08:21:37` …and nothing is called on their behalf  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `44` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `44` |

ℹ️ `08:21:37` Cleaning up test resources...  
