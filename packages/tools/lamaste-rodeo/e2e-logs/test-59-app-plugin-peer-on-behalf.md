# Lamaste E2E: 59 — A call on behalf of a user (Three-VM)

> Started at `2026-11-11 10:22:16 UTC`


## Pre-flight, users, both plugins hosted, the shelf applied

✅ `10:22:16` Onboarding is complete  
✅ `10:22:16` Agent test-agent is enrolled on the host  
✅ `10:22:17` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:22:17` The agent VM's lamaste-agent has the apphost command  
✅ `10:22:19` User e2e59-both created  
✅ `10:22:19` User e2e59-only created  
✅ `10:22:20` Fixtures built: @lamalibre/e2e-pdir-server (provides e2e-pdir:read, e2e-pdir:write) and @lamalibre/e2e-pcons-server (consumes both)  
✅ `10:22:20` The second agent peer-agent2 (visitor VM) is enrolled and syncing  
✅ `10:22:21` The second agent's app host helper is enabled and the relay knows it from its host facts  
✅ `10:22:36` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-pdir-server, @lamalibre/e2e-pdir-agent, @lamalibre/e2e-pcons-server, @lamalibre/e2e-pcons-agent )  
✅ `10:22:37` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:22:38` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T10:22:38.351Z"})  
✅ `10:22:38` …through its own OIDC client  
✅ `10:22:39` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:22:51` e2e-pdir installed and approved (its peers block in the digest)  
✅ `10:22:51` e2e-pcons installed and approved  
✅ `10:23:02` e2e-pdir hosted on test-agent (agent VM) ()  
✅ `10:23:13` e2e-pcons hosted on peer-agent2 (visitor VM) ()  
✅ `10:23:13` Both halves are identity-ready (their feeds at the head)  
✅ `10:23:13` The relay attached its peer channel to e2e-pcons's half on the visitor VM  
✅ `10:23:13` The shelf grants e2e-pdir:read to e2e-pcons  
✅ `10:23:13` e2e59-both entitled to e2e-pcons (viewer)  
✅ `10:23:14` e2e59-both entitled to e2e-pdir (viewer)  
✅ `10:23:14` e2e59-only entitled to e2e-pcons only  
✅ `10:23:14` The audiences hold them: e2e59-both in both, e2e59-only in e2e-pcons  

## The consumer's user surface, on a tunnel its hosting agent carries

✅ `10:23:17` Tunnel e2e59pc.test.lamaste.local, carried by peer-agent2  
✅ `10:23:20` Bound as e2e-pcons's user surface  
✅ `10:23:20` …served: the tunnel's agent is the plugin's hosting agent  
✅ `10:23:32` e2e59-both signed in from the visitor VM  
✅ `10:23:34` e2e59-only signed in  

## On behalf of e2e59-both: the provider learns who

✅ `10:23:35` GET /api/e2e-pcons/app/me-via-peer as e2e59-both: 200  
✅ `10:23:35` The relay gave the consumer a delegation with the request  
✅ `10:23:35` The call on e2e59-both's behalf: 200 from the provider ()  
✅ `10:23:35` …the peer caller: e2e-pcons, its endpoint  
✅ `10:23:35` …and the user: the directory's id, the username, the roles in the provider  
✅ `10:23:35` …for the path the consumer built from the user it was told  

## On behalf of e2e59-only, whom the provider's audience does not hold

✅ `10:23:35` GET /api/e2e-pcons/app/me-via-peer as e2e59-only: the consumer answers  
✅ `10:23:35` …its call on e2e59-only's behalf: 403 user_not_entitled — never named to the provider  

## A delegation the consumer made up

✅ `10:23:35` A made-up delegation: 401 delegation_invalid  
✅ `10:23:35` …the provider's handler never ran  
✅ `10:23:36` Without a delegation the same call is the plugin's own: no user  

## e2e59-both disabled

✅ `10:23:36` e2e59-both disabled  
✅ `10:23:36` e2e59-both's next request is refused at the user surface (401)  
✅ `10:23:36` …and nothing is called on their behalf  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `44` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `44` |

ℹ️ `10:23:36` Cleaning up test resources...  
