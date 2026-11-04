# Lamaste E2E: 10 — Agent Plugin Install through the Registry Broker

> Started at `2026-11-04 13:32:07 UTC`


## Pre-flight: check onboarding is complete

✅ `13:32:07` Onboarding is complete  
ℹ️ `13:32:08` Agent VM local registry name: e2e-agent; label enrolled on the host: test-agent  
✅ `13:32:08` Agent test-agent is enrolled on the host  

## Stand-in registry on the host VM

✅ `13:32:10` Fixture plugin shipped to the host VM  
✅ `13:32:12` Stand-in registry is up on the host VM  
✅ `13:32:12` Agent VM reaches the registry at http://10.13.37.1:4874  

## registry-credential set --oidc on the host

✅ `13:32:14` Credential configured through the OIDC chain ({"configured":true,"provider":"feria","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T13:32:13.991Z"})  
✅ `13:32:14` Auth kind is oidc  
✅ `13:32:14` The registry identified the panel as ci:auth.test.lamaste.local/lamaste-server  

## Agent plugin install through the broker

✅ `13:32:26` lamaste-agentd is installed on the agent VM  
✅ `13:32:29` Agent panel is running on the agent VM  
✅ `13:32:30` Agent installed @lamalibre/e2e-oidc-server from the registry  
✅ `13:32:31` Agent plugin registry lists the plugin  

## Registry saw the brokered token

✅ `13:32:31` The registry holds one token for agent:test-agent  
✅ `13:32:31` Token kind is agent  
✅ `13:32:31` Token scope is read only  
✅ `13:32:31` Brokered by the panel's OIDC identity  
✅ `13:32:31` The packument was fetched  
✅ `13:32:31` The tarball was fetched  
✅ `13:32:31` Every package request carried a token owned by agent:test-agent  
✅ `13:32:32` Every package request used a Bearer registry token  

## Agent left clean

✅ `13:32:32` The agent user's ~/.npmrc is unchanged  
✅ `13:32:32` No registry token landed in ~/.npmrc  
✅ `13:32:32` No .npmrc-install-* file remains in the agent's data directory  

## Panel audit log

✅ `13:32:32` The panel logged the brokering for test-agent  
✅ `13:32:33` The audit line carries the registry's tokenId 76797480-cf18-4c22-a5e8-df94d3513f96  

## Uninstall on the agent

✅ `13:32:33` Plugin disable answered before the panel restarted  
✅ `13:32:34` Agent panel is back after the plugin disable  
✅ `13:32:35` Agent plugin uninstalled  
✅ `13:32:35` Agent plugin registry no longer lists the plugin  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `29` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `29` |

