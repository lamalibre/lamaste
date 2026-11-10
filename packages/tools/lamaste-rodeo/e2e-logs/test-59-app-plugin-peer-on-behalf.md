# Lamaste E2E: 59 — A call on behalf of a user (Three-VM)

> Started at `2026-11-10 14:46:45 UTC`


## Pre-flight, users, both plugins hosted, the shelf applied

✅ `14:46:45` Onboarding is complete  
✅ `14:46:45` Agent test-agent is enrolled on the host  
✅ `14:46:45` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:46:46` The agent VM's lamaste-agent has the apphost command  
✅ `14:46:48` User e2e59-both created  
✅ `14:46:48` User e2e59-only created  
✅ `14:46:50` Fixtures built: @lamalibre/e2e-pdir-server (provides e2e-pdir:read, e2e-pdir:write) and @lamalibre/e2e-pcons-server (consumes both)  
✅ `14:46:51` The second agent peer-agent2 (visitor VM) is enrolled and syncing  
✅ `14:46:52` The second agent's app host helper is enabled and the relay knows it from its host facts  
✅ `14:47:08` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-pdir-server, @lamalibre/e2e-pdir-agent, @lamalibre/e2e-pcons-server, @lamalibre/e2e-pcons-agent )  
✅ `14:47:08` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:47:09` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T14:47:09.329Z"})  
✅ `14:47:09` …through its own OIDC client  
✅ `14:47:13` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:47:23` e2e-pdir installed and approved (its peers block in the digest)  
✅ `14:47:24` e2e-pcons installed and approved  
✅ `14:47:34` e2e-pdir hosted on test-agent (agent VM) ()  
✅ `14:47:45` e2e-pcons hosted on peer-agent2 (visitor VM) ()  
✅ `14:47:46` Both halves are identity-ready (their feeds at the head)  
✅ `14:47:46` The relay attached its peer channel to e2e-pcons's half on the visitor VM  
✅ `14:47:46` The shelf grants e2e-pdir:read to e2e-pcons  
✅ `14:47:46` e2e59-both entitled to e2e-pcons (viewer)  
✅ `14:47:46` e2e59-both entitled to e2e-pdir (viewer)  
✅ `14:47:47` e2e59-only entitled to e2e-pcons only  
✅ `14:47:47` The audiences hold them: e2e59-both in both, e2e59-only in e2e-pcons  

## The consumer's user surface, on a tunnel its hosting agent carries

✅ `14:47:50` Tunnel e2e59pc.test.lamaste.local, carried by peer-agent2  
✅ `14:47:53` Bound as e2e-pcons's user surface  
✅ `14:47:53` …served: the tunnel's agent is the plugin's hosting agent  
✅ `14:48:02` e2e59-both signed in from the visitor VM  
✅ `14:48:04` e2e59-only signed in  

## On behalf of e2e59-both: the provider learns who

✅ `14:48:04` GET /api/e2e-pcons/app/me-via-peer as e2e59-both: 200  
✅ `14:48:04` The relay gave the consumer a delegation with the request  
✅ `14:48:04` The call on e2e59-both's behalf: 200 from the provider ()  
✅ `14:48:04` …the peer caller: e2e-pcons, its endpoint  
✅ `14:48:04` …and the user: the directory's id, the username, the roles in the provider  
✅ `14:48:04` …for the path the consumer built from the user it was told  

## On behalf of e2e59-only, whom the provider's audience does not hold

✅ `14:48:04` GET /api/e2e-pcons/app/me-via-peer as e2e59-only: the consumer answers  
✅ `14:48:04` …its call on e2e59-only's behalf: 403 user_not_entitled — never named to the provider  

## A delegation the consumer made up

✅ `14:48:05` A made-up delegation: 401 delegation_invalid  
✅ `14:48:05` …the provider's handler never ran  
✅ `14:48:05` Without a delegation the same call is the plugin's own: no user  

## e2e59-both disabled

✅ `14:48:05` e2e59-both disabled  
✅ `14:48:05` e2e59-both's next request is refused at the user surface (401)  
✅ `14:48:05` …and nothing is called on their behalf  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `44` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `44` |

ℹ️ `14:48:05` Cleaning up test resources...  
