# Lamaste E2E: 10 — Agent Plugin Install through the Registry Broker

> Started at `2026-11-09 12:39:29 UTC`


## Pre-flight: check onboarding is complete

✅ `12:39:29` Onboarding is complete  
ℹ️ `12:39:30` Agent VM local registry name: e2e-agent; label enrolled on the host: test-agent  
✅ `12:39:30` Agent test-agent is enrolled on the host  

## Stand-in registry on the host VM

✅ `12:39:31` Fixture plugin shipped to the host VM  
✅ `12:39:35` Stand-in registry is up on the host VM  
✅ `12:39:35` Agent VM reaches the registry at http://10.13.37.1:4874  

## registry-credential set --oidc on the host

✅ `12:39:36` Credential configured through the OIDC chain ({"configured":true,"provider":"feria","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T12:39:36.165Z"})  
✅ `12:39:36` Auth kind is oidc  
✅ `12:39:36` The registry identified the panel as ci:auth.test.lamaste.local/lamaste-server  

## Agent plugin install through the broker

✅ `12:39:46` lamaste-agentd is installed on the agent VM  
✅ `12:39:48` Agent panel is running on the agent VM  
✅ `12:39:49` Agent installed @lamalibre/e2e-oidc-server from the registry  
✅ `12:39:49` Agent plugin registry lists the plugin  

## Registry saw the brokered token

✅ `12:39:50` The registry holds one token for agent:test-agent  
✅ `12:39:50` Token kind is agent  
✅ `12:39:50` Token scope is read only  
✅ `12:39:50` Brokered by the panel's OIDC identity  
✅ `12:39:50` The packument was fetched  
✅ `12:39:50` The tarball was fetched  
✅ `12:39:50` Every package request carried a token owned by agent:test-agent  
✅ `12:39:50` Every package request used a Bearer registry token  

## Agent left clean

✅ `12:39:50` The agent user's ~/.npmrc is unchanged  
✅ `12:39:50` No registry token landed in ~/.npmrc  
✅ `12:39:50` No .npmrc-install-* file remains in the agent's data directory  

## Panel audit log

✅ `12:39:50` The panel logged the brokering for test-agent  
✅ `12:39:50` The audit line carries the registry's tokenId c448ddf9-58d1-4f67-8583-cb4955deb043  

## Uninstall on the agent

✅ `12:39:50` Plugin disable answered before the panel restarted  
✅ `12:39:52` Agent panel is back after the plugin disable  
✅ `12:39:52` Agent plugin uninstalled  
✅ `12:39:52` Agent plugin registry no longer lists the plugin  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `29` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `29` |

