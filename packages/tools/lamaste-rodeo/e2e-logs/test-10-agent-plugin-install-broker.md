# Lamaste E2E: 10 — Agent Plugin Install through the Registry Broker

> Started at `2026-11-10 17:44:37 UTC`


## Pre-flight: check onboarding is complete

✅ `17:44:37` Onboarding is complete  
ℹ️ `17:44:37` Agent VM local registry name: e2e-agent; label enrolled on the host: test-agent  
✅ `17:44:38` Agent test-agent is enrolled on the host  

## Stand-in registry on the host VM

✅ `17:44:38` Fixture plugin shipped to the host VM  
✅ `17:44:43` Stand-in registry is up on the host VM  
✅ `17:44:43` Agent VM reaches the registry at http://10.13.37.1:4874  

## registry-credential set --oidc on the host

✅ `17:44:44` Credential configured through the OIDC chain ({"configured":true,"provider":"feria","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T17:44:44.414Z"})  
✅ `17:44:44` Auth kind is oidc  
✅ `17:44:44` The registry identified the panel as ci:auth.test.lamaste.local/lamaste-server  

## Agent plugin install through the broker

✅ `17:44:55` lamaste-agentd is installed on the agent VM  
✅ `17:44:58` Agent panel is running on the agent VM  
✅ `17:44:59` Agent installed @lamalibre/e2e-oidc-server from the registry  
✅ `17:44:59` Agent plugin registry lists the plugin  

## Registry saw the brokered token

✅ `17:44:59` The registry holds one token for agent:test-agent  
✅ `17:44:59` Token kind is agent  
✅ `17:44:59` Token scope is read only  
✅ `17:44:59` Brokered by the panel's OIDC identity  
✅ `17:44:59` The packument was fetched  
✅ `17:44:59` The tarball was fetched  
✅ `17:44:59` Every package request carried a token owned by agent:test-agent  
✅ `17:44:59` Every package request used a Bearer registry token  

## Agent left clean

✅ `17:44:59` The agent user's ~/.npmrc is unchanged  
✅ `17:44:59` No registry token landed in ~/.npmrc  
✅ `17:44:59` No .npmrc-install-* file remains in the agent's data directory  

## Panel audit log

✅ `17:45:00` The panel logged the brokering for test-agent  
✅ `17:45:00` The audit line carries the registry's tokenId 56406eae-a5ab-43ff-a5a4-2378ecb3cf19  

## Uninstall on the agent

✅ `17:45:00` Plugin disable answered before the panel restarted  
✅ `17:45:01` Agent panel is back after the plugin disable  
✅ `17:45:02` Agent plugin uninstalled  
✅ `17:45:02` Agent plugin registry no longer lists the plugin  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `29` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `29` |

