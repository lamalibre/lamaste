# Lamaste E2E: 61 — The provider offline (Three-VM)

> Started at `2026-11-10 14:56:47 UTC`


## Pre-flight, both plugins hosted, the shelf applied

✅ `14:56:48` Onboarding is complete  
✅ `14:56:48` Agent test-agent is enrolled on the host  
✅ `14:56:48` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:56:49` The agent VM's lamaste-agent has the apphost command  
✅ `14:56:49` Fixtures built: @lamalibre/e2e-pdir-server (provides e2e-pdir:read, e2e-pdir:write) and @lamalibre/e2e-pcons-server (consumes both)  
✅ `14:56:50` The second agent peer-agent2 (visitor VM) is enrolled and syncing  
✅ `14:56:51` The second agent's app host helper is enabled and the relay knows it from its host facts  
✅ `14:57:06` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-pdir-server, @lamalibre/e2e-pdir-agent, @lamalibre/e2e-pcons-server, @lamalibre/e2e-pcons-agent )  
✅ `14:57:06` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:57:07` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T14:57:07.791Z"})  
✅ `14:57:07` …through its own OIDC client  
✅ `14:57:12` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:57:23` e2e-pdir installed and approved (its peers block in the digest)  
✅ `14:57:23` e2e-pcons installed and approved  
✅ `14:57:34` e2e-pdir hosted on test-agent (agent VM) ()  
✅ `14:57:44` e2e-pcons hosted on peer-agent2 (visitor VM) ()  
✅ `14:57:45` Both halves are identity-ready (their feeds at the head)  
✅ `14:57:45` The relay attached its peer channel to e2e-pcons's half on the visitor VM  
✅ `14:57:45` The shelf grants e2e-pdir:read to e2e-pcons  
✅ `14:57:46` A call answers while the provider is up  
✅ `14:57:49` The consumer's events cursor rests on the provider's stream (its initial gap reconciled)  

## The provider's agent half stopped

✅ `14:58:16` The relay's health of e2e-pdir: down app  
✅ `14:58:16` …reason app: the tunnel answers, the half does not  
✅ `14:58:16` A call: 503 peer_unavailable, down_app  
✅ `14:58:16` …with Retry-After (10 s)  
✅ `14:58:16` …answered at once (0 s): nothing waited on the dead port  
✅ `14:58:33` Started again: up, and the call answers  

## The provider's agent unreachable (its chisel client stopped)

✅ `14:59:04` Down: down tunnel  
✅ `14:59:04` …reason tunnel: nothing answers on the relay's end  
✅ `14:59:04` A call: 503 peer_unavailable, down_tunnel  
✅ `14:59:25` The agent back: up, and the call answers  
✅ `14:59:32` Events published after the recovery are delivered  
✅ `14:59:32` …exactly the two, once each  
✅ `14:59:32` …from the cursor held across the outage: no gap but the initial one  
✅ `14:59:33` …on the same provider stream as before the outage  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `35` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `35` |

ℹ️ `14:59:33` Cleaning up test resources...  
