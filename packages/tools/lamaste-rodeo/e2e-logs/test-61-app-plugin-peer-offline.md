# Lamaste E2E: 61 — The provider offline (Three-VM)

> Started at `2026-11-10 19:40:22 UTC`


## Pre-flight, both plugins hosted, the shelf applied

✅ `19:40:22` Onboarding is complete  
✅ `19:40:22` Agent test-agent is enrolled on the host  
✅ `19:40:23` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `19:40:23` The agent VM's lamaste-agent has the apphost command  
✅ `19:40:24` Fixtures built: @lamalibre/e2e-pdir-server (provides e2e-pdir:read, e2e-pdir:write) and @lamalibre/e2e-pcons-server (consumes both)  
✅ `19:40:24` The second agent peer-agent2 (visitor VM) is enrolled and syncing  
✅ `19:40:25` The second agent's app host helper is enabled and the relay knows it from its host facts  
✅ `19:40:40` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-pdir-server, @lamalibre/e2e-pdir-agent, @lamalibre/e2e-pcons-server, @lamalibre/e2e-pcons-agent )  
✅ `19:40:40` The agent VM reaches it at http://10.13.37.1:4874  
✅ `19:40:41` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T19:40:41.682Z"})  
✅ `19:40:41` …through its own OIDC client  
✅ `19:40:46` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `19:40:55` e2e-pdir installed and approved (its peers block in the digest)  
✅ `19:40:56` e2e-pcons installed and approved  
✅ `19:41:06` e2e-pdir hosted on test-agent (agent VM) ()  
✅ `19:41:17` e2e-pcons hosted on peer-agent2 (visitor VM) ()  
✅ `19:41:17` Both halves are identity-ready (their feeds at the head)  
✅ `19:41:17` The relay attached its peer channel to e2e-pcons's half on the visitor VM  
✅ `19:41:18` The shelf grants e2e-pdir:read to e2e-pcons  
✅ `19:41:18` A call answers while the provider is up  
✅ `19:41:22` The consumer's events cursor rests on the provider's stream (its initial gap reconciled)  

## The provider's agent half stopped

✅ `19:41:55` The relay's health of e2e-pdir: down app  
✅ `19:41:56` …reason app: the tunnel answers, the half does not  
✅ `19:41:56` A call: 503 peer_unavailable, down_app  
✅ `19:41:56` …with Retry-After (10 s)  
✅ `19:41:56` …answered at once (0 s): nothing waited on the dead port  
✅ `19:42:13` Started again: up, and the call answers  

## The provider's agent unreachable (its chisel client stopped)

✅ `19:42:43` Down: down tunnel  
✅ `19:42:43` …reason tunnel: nothing answers on the relay's end  
✅ `19:42:43` A call: 503 peer_unavailable, down_tunnel  
✅ `19:43:04` The agent back: up, and the call answers  
✅ `19:43:04` Events published after the recovery are delivered  
✅ `19:43:04` …exactly the two, once each  
✅ `19:43:05` …from the cursor held across the outage: no gap but the initial one  
✅ `19:43:05` …on the same provider stream as before the outage  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `35` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `35` |

ℹ️ `19:43:05` Cleaning up test resources...  
