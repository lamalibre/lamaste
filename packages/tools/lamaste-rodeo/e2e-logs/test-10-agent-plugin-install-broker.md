# Lamaste E2E: 10 — Agent Plugin Install through the Registry Broker

> Started at `2026-11-10 13:01:37 UTC`


## Pre-flight: check onboarding is complete

✅ `13:01:38` Onboarding is complete  
ℹ️ `13:01:38` Agent VM local registry name: e2e-agent; label enrolled on the host: test-agent  
✅ `13:01:38` Agent test-agent is enrolled on the host  

## Stand-in registry on the host VM

✅ `13:01:39` Fixture plugin shipped to the host VM  
✅ `13:01:43` Stand-in registry is up on the host VM  
✅ `13:01:44` Agent VM reaches the registry at http://10.13.37.1:4874  

## registry-credential set --oidc on the host

✅ `13:01:45` Credential configured through the OIDC chain ({"configured":true,"provider":"feria","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T13:01:45.271Z"})  
✅ `13:01:45` Auth kind is oidc  
✅ `13:01:45` The registry identified the panel as ci:auth.test.lamaste.local/lamaste-server  

## Agent plugin install through the broker

✅ `13:01:55` lamaste-agentd is installed on the agent VM  
✅ `13:01:57` Agent panel is running on the agent VM  
✅ `13:01:59` Agent installed @lamalibre/e2e-oidc-server from the registry  
✅ `13:01:59` Agent plugin registry lists the plugin  

## Registry saw the brokered token

✅ `13:01:59` The registry holds one token for agent:test-agent  
✅ `13:01:59` Token kind is agent  
✅ `13:01:59` Token scope is read only  
✅ `13:01:59` Brokered by the panel's OIDC identity  
✅ `13:01:59` The packument was fetched  
✅ `13:01:59` The tarball was fetched  
✅ `13:01:59` Every package request carried a token owned by agent:test-agent  
✅ `13:01:59` Every package request used a Bearer registry token  

## Agent left clean

✅ `13:01:59` The agent user's ~/.npmrc is unchanged  
✅ `13:01:59` No registry token landed in ~/.npmrc  
✅ `13:01:59` No .npmrc-install-* file remains in the agent's data directory  

## Panel audit log

✅ `13:02:00` The panel logged the brokering for test-agent  
✅ `13:02:00` The audit line carries the registry's tokenId 9e2509db-0da8-4c7a-9056-e390366f0f97  

## Uninstall on the agent

✅ `13:02:00` Plugin disable answered before the panel restarted  
✅ `13:02:01` Agent panel is back after the plugin disable  
✅ `13:02:02` Agent plugin uninstalled  
✅ `13:02:02` Agent plugin registry no longer lists the plugin  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `29` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `29` |

