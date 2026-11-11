# Lamaste E2E: 10 — Agent Plugin Install through the Registry Broker

> Started at `2026-11-11 09:00:34 UTC`


## Pre-flight: check onboarding is complete

✅ `09:00:35` Onboarding is complete  
ℹ️ `09:00:35` Agent VM local registry name: e2e-agent; label enrolled on the host: test-agent  
✅ `09:00:35` Agent test-agent is enrolled on the host  

## Stand-in registry on the host VM

✅ `09:00:36` Fixture plugin shipped to the host VM  
✅ `09:00:40` Stand-in registry is up on the host VM  
✅ `09:00:41` Agent VM reaches the registry at http://10.13.37.1:4874  

## registry-credential set --oidc on the host

✅ `09:00:42` Credential configured through the OIDC chain ({"configured":true,"provider":"feria","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T09:00:42.202Z"})  
✅ `09:00:42` Auth kind is oidc  
✅ `09:00:42` The registry identified the panel as ci:auth.test.lamaste.local/lamaste-server  

## Agent plugin install through the broker

✅ `09:00:53` lamaste-agentd is installed on the agent VM  
✅ `09:00:55` Agent panel is running on the agent VM  
✅ `09:00:56` Agent installed @lamalibre/e2e-oidc-server from the registry  
✅ `09:00:56` Agent plugin registry lists the plugin  

## Registry saw the brokered token

✅ `09:00:56` The registry holds one token for agent:test-agent  
✅ `09:00:56` Token kind is agent  
✅ `09:00:56` Token scope is read only  
✅ `09:00:56` Brokered by the panel's OIDC identity  
✅ `09:00:57` The packument was fetched  
✅ `09:00:57` The tarball was fetched  
✅ `09:00:57` Every package request carried a token owned by agent:test-agent  
✅ `09:00:57` Every package request used a Bearer registry token  

## Agent left clean

✅ `09:00:57` The agent user's ~/.npmrc is unchanged  
✅ `09:00:57` No registry token landed in ~/.npmrc  
✅ `09:00:57` No .npmrc-install-* file remains in the agent's data directory  

## Panel audit log

✅ `09:00:57` The panel logged the brokering for test-agent  
✅ `09:00:57` The audit line carries the registry's tokenId f7742069-f1ab-4f80-af70-cd8f0ced33c7  

## Uninstall on the agent

✅ `09:00:57` Plugin disable answered before the panel restarted  
✅ `09:00:59` Agent panel is back after the plugin disable  
✅ `09:00:59` Agent plugin uninstalled  
✅ `09:00:59` Agent plugin registry no longer lists the plugin  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `29` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `29` |

