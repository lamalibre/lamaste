# Lamaste E2E: 10 — Agent Plugin Install through the Registry Broker

> Started at `2026-10-13 11:46:38 UTC`


## Pre-flight: check onboarding is complete

✅ `11:46:38` Onboarding is complete  
ℹ️ `11:46:39` Agent VM local registry name: e2e-agent; label enrolled on the host: test-agent  
✅ `11:46:39` Agent test-agent is enrolled on the host  

## Stand-in registry on the host VM

✅ `11:46:39` Fixture plugin shipped to the host VM  
✅ `11:46:44` Stand-in registry is up on the host VM  
✅ `11:46:44` Agent VM reaches the registry at http://10.13.37.1:4874  

## registry-credential set --oidc on the host

✅ `11:46:46` Credential configured through the OIDC chain ({"configured":true,"provider":"feria","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-10-13T11:46:46.863Z"})  
✅ `11:46:46` Auth kind is oidc  
✅ `11:46:46` The registry identified the panel as ci:auth.test.lamaste.local/lamaste-server  

## Agent plugin install through the broker

✅ `11:47:30` lamaste-agentd is installed on the agent VM  
✅ `11:47:32` Agent panel is running on the agent VM  
✅ `11:47:33` Agent installed @lamalibre/e2e-oidc-server from the registry  
✅ `11:47:33` Agent plugin registry lists the plugin  

## Registry saw the brokered token

✅ `11:47:33` The registry holds one token for agent:test-agent  
✅ `11:47:33` Token kind is agent  
✅ `11:47:34` Token scope is read only  
✅ `11:47:34` Brokered by the panel's OIDC identity  
✅ `11:47:34` The packument was fetched  
✅ `11:47:34` The tarball was fetched  
✅ `11:47:34` Every package request carried a token owned by agent:test-agent  
✅ `11:47:34` Every package request used a Bearer registry token  

## Agent left clean

✅ `11:47:34` The agent user's ~/.npmrc is unchanged  
✅ `11:47:34` No registry token landed in ~/.npmrc  
✅ `11:47:34` No .npmrc-install-* file remains in the agent's data directory  

## Panel audit log

✅ `11:47:34` The panel logged the brokering for test-agent  
✅ `11:47:34` The audit line carries the registry's tokenId 0a7d9cf3-46c7-45f0-a930-5922c02cda8e  

## Uninstall on the agent

✅ `11:47:34` Plugin disable answered before the panel restarted  
✅ `11:47:35` Agent panel is back after the plugin disable  
✅ `11:47:36` Agent plugin uninstalled  
✅ `11:47:36` Agent plugin registry no longer lists the plugin  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `29` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `29` |

