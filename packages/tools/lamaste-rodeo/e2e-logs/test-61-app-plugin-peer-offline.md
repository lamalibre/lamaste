# Lamaste E2E: 61 — The provider offline (Three-VM)

> Started at `2026-11-11 10:28:21 UTC`


## Pre-flight, both plugins hosted, the shelf applied

✅ `10:28:21` Onboarding is complete  
✅ `10:28:21` Agent test-agent is enrolled on the host  
✅ `10:28:22` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:28:22` The agent VM's lamaste-agent has the apphost command  
✅ `10:28:23` Fixtures built: @lamalibre/e2e-pdir-server (provides e2e-pdir:read, e2e-pdir:write) and @lamalibre/e2e-pcons-server (consumes both)  
✅ `10:28:23` The second agent peer-agent2 (visitor VM) is enrolled and syncing  
✅ `10:28:24` The second agent's app host helper is enabled and the relay knows it from its host facts  
✅ `10:28:39` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-pdir-server, @lamalibre/e2e-pdir-agent, @lamalibre/e2e-pcons-server, @lamalibre/e2e-pcons-agent )  
✅ `10:28:39` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:28:41` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T10:28:41.115Z"})  
✅ `10:28:41` …through its own OIDC client  
✅ `10:28:42` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:28:52` e2e-pdir installed and approved (its peers block in the digest)  
✅ `10:28:52` e2e-pcons installed and approved  
✅ `10:29:03` e2e-pdir hosted on test-agent (agent VM) ()  
✅ `10:29:14` e2e-pcons hosted on peer-agent2 (visitor VM) ()  
✅ `10:29:14` Both halves are identity-ready (their feeds at the head)  
✅ `10:29:14` The relay attached its peer channel to e2e-pcons's half on the visitor VM  
✅ `10:29:15` The shelf grants e2e-pdir:read to e2e-pcons  
✅ `10:29:15` A call answers while the provider is up  
✅ `10:29:15` The consumer's events cursor rests on the provider's stream (its initial gap reconciled)  

## The provider's agent half stopped

✅ `10:29:45` The relay's health of e2e-pdir: down app  
✅ `10:29:45` …reason app: the tunnel answers, the half does not  
✅ `10:29:45` A call: 503 peer_unavailable, down_app  
✅ `10:29:45` …with Retry-After (10 s)  
✅ `10:29:45` …answered at once (0 s): nothing waited on the dead port  
✅ `10:30:02` Started again: up, and the call answers  

## The provider's agent unreachable (its chisel client stopped)

✅ `10:30:35` Down: down tunnel  
✅ `10:30:35` …reason tunnel: nothing answers on the relay's end  
✅ `10:30:35` A call: 503 peer_unavailable, down_tunnel  
✅ `10:30:52` The agent back: up, and the call answers  
✅ `10:30:59` Events published after the recovery are delivered  
✅ `10:30:59` …exactly the two, once each  
✅ `10:30:59` …from the cursor held across the outage: no gap but the initial one  
✅ `10:31:00` …on the same provider stream as before the outage  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `35` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `35` |

ℹ️ `10:31:00` Cleaning up test resources...  
