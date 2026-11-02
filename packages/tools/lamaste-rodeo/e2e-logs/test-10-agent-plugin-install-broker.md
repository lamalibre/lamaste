# Lamaste E2E: 10 — Agent Plugin Install through the Registry Broker

> Started at `2026-11-02 15:47:29 UTC`


## Pre-flight: check onboarding is complete

✅ `15:47:29` Onboarding is complete  
ℹ️ `15:47:29` Agent VM local registry name: e2e-agent; label enrolled on the host: test-agent  
✅ `15:47:29` Agent test-agent is enrolled on the host  

## Stand-in registry on the host VM

✅ `15:47:30` Fixture plugin shipped to the host VM  
✅ `15:47:31` Stand-in registry is up on the host VM  
✅ `15:47:31` Agent VM reaches the registry at http://10.13.37.1:4874  

## registry-credential set --oidc on the host

✅ `15:47:33` Credential configured through the OIDC chain ({"configured":true,"provider":"feria","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-02T15:47:33.626Z"})  
✅ `15:47:33` Auth kind is oidc  
✅ `15:47:33` The registry identified the panel as ci:auth.test.lamaste.local/lamaste-server  

## Agent plugin install through the broker

✅ `15:48:10` lamaste-agentd is installed on the agent VM  
✅ `15:48:12` Agent panel is running on the agent VM  
✅ `15:48:13` Agent installed @lamalibre/e2e-oidc-server from the registry  
✅ `15:48:13` Agent plugin registry lists the plugin  

## Registry saw the brokered token

✅ `15:48:14` The registry holds one token for agent:test-agent  
✅ `15:48:14` Token kind is agent  
✅ `15:48:14` Token scope is read only  
✅ `15:48:14` Brokered by the panel's OIDC identity  
✅ `15:48:14` The packument was fetched  
✅ `15:48:14` The tarball was fetched  
✅ `15:48:14` Every package request carried a token owned by agent:test-agent  
✅ `15:48:14` Every package request used a Bearer registry token  

## Agent left clean

✅ `15:48:14` The agent user's ~/.npmrc is unchanged  
✅ `15:48:14` No registry token landed in ~/.npmrc  
✅ `15:48:14` No .npmrc-install-* file remains in the agent's data directory  

## Panel audit log

✅ `15:48:14` The panel logged the brokering for test-agent  
✅ `15:48:14` The audit line carries the registry's tokenId 8cad4f5c-46c5-4da2-9997-b75643938b1a  

## Uninstall on the agent

✅ `15:48:14` Plugin disable answered before the panel restarted  
✅ `15:48:15` Agent panel is back after the plugin disable  
✅ `15:48:16` Agent plugin uninstalled  
✅ `15:48:16` Agent plugin registry no longer lists the plugin  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `29` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `29` |

