# Lamaste E2E: 61 — The provider offline (Three-VM)

> Started at `2026-11-10 08:34:08 UTC`


## Pre-flight, both plugins hosted, the shelf applied

✅ `08:34:08` Onboarding is complete  
✅ `08:34:08` Agent test-agent is enrolled on the host  
✅ `08:34:09` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `08:34:09` The agent VM's lamaste-agent has the apphost command  
✅ `08:34:10` Fixtures built: @lamalibre/e2e-pdir-server (provides e2e-pdir:read, e2e-pdir:write) and @lamalibre/e2e-pcons-server (consumes both)  
✅ `08:34:10` The second agent peer-agent2 (visitor VM) is enrolled and syncing  
✅ `08:34:11` The second agent's app host helper is enabled and the relay knows it from its host facts  
✅ `08:34:26` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-pdir-server, @lamalibre/e2e-pdir-agent, @lamalibre/e2e-pcons-server, @lamalibre/e2e-pcons-agent )  
✅ `08:34:26` The agent VM reaches it at http://10.13.37.1:4874  
✅ `08:34:28` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T08:34:28.613Z"})  
✅ `08:34:28` …through its own OIDC client  
✅ `08:34:33` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `08:34:43` e2e-pdir installed and approved (its peers block in the digest)  
✅ `08:34:43` e2e-pcons installed and approved  
✅ `08:34:53` e2e-pdir hosted on test-agent (agent VM) ()  
✅ `08:35:04` e2e-pcons hosted on peer-agent2 (visitor VM) ()  
✅ `08:35:04` Both halves are identity-ready (their feeds at the head)  
✅ `08:35:04` The relay attached its peer channel to e2e-pcons's half on the visitor VM  
✅ `08:35:05` The shelf grants e2e-pdir:read to e2e-pcons  
✅ `08:35:05` A call answers while the provider is up  

## The provider's agent half stopped

✅ `08:35:34` The relay's health of e2e-pdir: down app  
✅ `08:35:35` …reason app: the tunnel answers, the half does not  
✅ `08:35:35` A call: 503 peer_unavailable, down_app  
✅ `08:35:35` …with Retry-After (10 s)  
✅ `08:35:35` …answered at once (0 s): nothing waited on the dead port  
✅ `08:35:55` Started again: up, and the call answers  

## The provider's agent unreachable (its chisel client stopped)

✅ `08:36:25` Down: down tunnel  
✅ `08:36:25` …reason tunnel: nothing answers on the relay's end  
✅ `08:36:25` A call: 503 peer_unavailable, down_tunnel  
✅ `08:36:45` The agent back: up, and the call answers  
✅ `08:36:49` Events published after the recovery are delivered  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `31` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `31` |

ℹ️ `08:36:49` Cleaning up test resources...  
