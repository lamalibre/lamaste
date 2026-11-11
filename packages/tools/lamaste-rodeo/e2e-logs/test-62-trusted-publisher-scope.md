# Lamaste E2E: 62 — A trusted publisher scope: an app plugin of a second scope (Three-VM)

> Started at `2026-11-11 11:28:31 UTC`


## Pre-flight

✅ `11:28:32` Onboarding is complete  
✅ `11:28:32` Agent test-agent is enrolled on the host  
✅ `11:28:32` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `11:28:32` The agent VM's lamaste-agent has the apphost command  
✅ `11:28:33` The built-in trusted scope is @lamalibre  
✅ `11:28:33` @example is not trusted on this relay  

## Published to the development Feria

✅ `11:28:33` The development Feria hosts @example (@lamalibre, @example)  
✅ `11:28:33` Fixture built: @example/e2e-scoped-server and its bundled agent half @example/e2e-scoped-agent 1.0.0  
✅ `11:28:34` npm publish @example/e2e-scoped-server@1.0.0 to the development Feria  
✅ `11:28:34` npm publish @example/e2e-scoped-agent@1.0.0 to the development Feria  
✅ `11:28:35` A package of a scope the development Feria does not host is not accepted  
✅ `11:28:37` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with no packages )  
✅ `11:28:37` The agent VM reaches it at http://10.13.37.1:4874  
✅ `11:28:38` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T11:28:38.518Z"})  
✅ `11:28:38` …through its own OIDC client  
✅ `11:28:38` The VMs reach the development Feria at http://192.168.2.1:4873  
✅ `11:28:39` @example/e2e-scoped-server@1.0.0 fetched from the development Feria and served by the stand-in  
✅ `11:28:39` …byte for byte (integrity sha512-tMSnA27CyxzY0…)  
✅ `11:28:39` @example/e2e-scoped-agent@1.0.0 fetched from the development Feria and served by the stand-in  
✅ `11:28:39` …byte for byte (integrity sha512-IaGDZ4HE0cMor…)  

## Not trusted: the install is refused

✅ `11:28:40` Installing @example/e2e-scoped-server on a relay that does not trust @example is refused (400)  
✅ `11:28:40` …untrusted_scope  
✅ `11:28:40` …and nothing is installed  
✅ `11:28:40` A look-alike of the built-in scope (@lamalibre-evil/e2e-scoped-server) is refused  
✅ `11:28:40` A look-alike of the built-in scope (@LamaLibre/e2e-scoped-server) is refused  

## Trusting the scope: only while the registry hosts it

✅ `11:28:40` Trusting @example while the registry does not host it is refused (409)  
✅ `11:28:40` …registry_lacks_scope  
✅ `11:28:41` lamaste-server trusted-scopes add @example ({"builtIn":"@lamalibre","additional":["@example"],"effective":["@lamalibre","@example"]})  
✅ `11:28:41` GET /api/settings/trusted-scopes lists it  
✅ `11:28:41` Audit: settings.trusted-scope.added  
✅ `11:28:42` The administrators are told  
✅ `11:28:46` The agent's sync recorded the relay's list: @lamalibre,@example  

## Installed from the trusted scope; the agent half pinned

✅ `11:28:50` Installed @example/e2e-scoped-server@1.0.0  
✅ `11:28:50` …the plugin e2e-scoped, named by its route  
✅ `11:28:50` Its agent half is @example/e2e-scoped-agent  
✅ `11:28:50` …pinned at the integrity the registry publishes  
✅ `11:28:50` Approved  

## Hosted through the app host helper (protocol 3)

✅ `11:28:51` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `11:28:51` Host facts: the helper speaks protocol 3 (any trusted scope)  
✅ `11:28:52` Eligibility: test-agent can host it  
✅ `11:28:52` The agent's window is open, under a policy naming @example/e2e-scoped-agent  
✅ `11:29:03` The hosting operation succeeded ()  
✅ `11:29:03` Step: install the agent half  
✅ `11:29:03` The agent half runs on the agent VM  
✅ `11:29:03` …as lamaste-app-e2e-scoped  
✅ `11:29:04` The app host helper records @example/e2e-scoped-agent as the route's owner  
✅ `11:29:04` GET /api/e2e-scoped/ping reaches the installed version through the tunnel  
✅ `11:29:04` The agent pulled @example/e2e-scoped-agent from the relay's registry with its brokered token (@example routed there)  

## In use: the scope stays trusted, the registry stays configured

✅ `11:29:04` Removing @example while its plugin is installed is refused (409)  
✅ `11:29:04` …scope_in_use  
✅ `11:29:04` …naming @example/e2e-scoped-server  
✅ `11:29:04` Clearing the registry credential while @example is trusted is refused (409)  
✅ `11:29:04` …trusted_scopes_need_registry  

## Uninstalled with purge; the scope removed and refused again

✅ `11:29:15` Uninstalled with purge ()  
✅ `11:29:15` e2e-scoped is gone from the relay  
✅ `11:29:16` @example is no longer trusted  
✅ `11:29:16` …@lamalibre alone again  
✅ `11:29:16` Audit: settings.trusted-scope.removed  
✅ `11:29:16` Installing @example/e2e-scoped-server is refused again (untrusted_scope)  
✅ `11:29:20` The agent's sync dropped @example  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `60` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `60` |

ℹ️ `11:29:20` Cleaning up test resources...  
