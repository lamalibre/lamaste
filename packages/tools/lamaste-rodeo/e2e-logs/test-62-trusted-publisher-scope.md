# Lamaste E2E: 62 — A trusted publisher scope: an app plugin of a second scope (Three-VM)

> Started at `2026-11-10 08:58:51 UTC`


## Pre-flight

✅ `08:58:51` Onboarding is complete  
✅ `08:58:52` Agent test-agent is enrolled on the host  
✅ `08:58:52` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `08:58:52` The agent VM's lamaste-agent has the apphost command  
✅ `08:58:52` The built-in trusted scope is @lamalibre  
✅ `08:58:52` @example is not trusted on this relay  

## Published to the development Feria

✅ `08:58:52` The development Feria hosts @example (@lamalibre, @example)  
✅ `08:58:53` Fixture built: @example/e2e-scoped-server and its bundled agent half @example/e2e-scoped-agent 1.0.0  
✅ `08:58:53` npm publish @example/e2e-scoped-server@1.0.0 to the development Feria  
✅ `08:58:53` npm publish @example/e2e-scoped-agent@1.0.0 to the development Feria  
✅ `08:58:54` A package of a scope the development Feria does not host is not accepted  
✅ `08:58:56` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with no packages )  
✅ `08:58:56` The agent VM reaches it at http://10.13.37.1:4874  
✅ `08:58:57` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T08:58:57.718Z"})  
✅ `08:58:57` …through its own OIDC client  
✅ `08:58:57` The VMs reach the development Feria at http://192.168.2.1:4873  
✅ `08:58:58` @example/e2e-scoped-server@1.0.0 fetched from the development Feria and served by the stand-in  
✅ `08:58:58` …byte for byte (integrity sha512-tMSnA27CyxzY0…)  
✅ `08:58:58` @example/e2e-scoped-agent@1.0.0 fetched from the development Feria and served by the stand-in  
✅ `08:58:58` …byte for byte (integrity sha512-nxd0uFZCv01o9…)  

## Not trusted: the install is refused

✅ `08:58:59` Installing @example/e2e-scoped-server on a relay that does not trust @example is refused (400)  
✅ `08:58:59` …untrusted_scope  
✅ `08:58:59` …and nothing is installed  
✅ `08:58:59` A look-alike of the built-in scope (@lamalibre-evil/e2e-scoped-server) is refused  
✅ `08:58:59` A look-alike of the built-in scope (@LamaLibre/e2e-scoped-server) is refused  

## Trusting the scope: only while the registry hosts it

✅ `08:59:00` Trusting @example while the registry does not host it is refused (409)  
✅ `08:59:00` …registry_lacks_scope  
✅ `08:59:00` lamaste-server trusted-scopes add @example ({"builtIn":"@lamalibre","additional":["@example"],"effective":["@lamalibre","@example"]})  
✅ `08:59:00` GET /api/settings/trusted-scopes lists it  
✅ `08:59:01` Audit: settings.trusted-scope.added  
✅ `08:59:01` The administrators are told  
✅ `08:59:04` The agent's sync recorded the relay's list: @lamalibre,@example  

## Installed from the trusted scope; the agent half pinned

✅ `08:59:09` Installed @example/e2e-scoped-server@1.0.0  
✅ `08:59:09` …the plugin e2e-scoped, named by its route  
✅ `08:59:09` Its agent half is @example/e2e-scoped-agent  
✅ `08:59:09` …pinned at the integrity the registry publishes  
✅ `08:59:09` Approved  

## Hosted through the app host helper (protocol 3)

✅ `08:59:13` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `08:59:14` Host facts: the helper speaks protocol 3 (any trusted scope)  
✅ `08:59:14` Eligibility: test-agent can host it  
✅ `08:59:15` The agent's window is open, under a policy naming @example/e2e-scoped-agent  
✅ `08:59:25` The hosting operation succeeded ()  
✅ `08:59:25` Step: install the agent half  
✅ `08:59:25` The agent half runs on the agent VM  
✅ `08:59:25` …as lamaste-app-e2e-scoped  
✅ `08:59:25` The app host helper records @example/e2e-scoped-agent as the route's owner  
✅ `08:59:26` GET /api/e2e-scoped/ping reaches the installed version through the tunnel  
✅ `08:59:26` The agent pulled @example/e2e-scoped-agent from the relay's registry with its brokered token (@example routed there)  

## In use: the scope stays trusted, the registry stays configured

✅ `08:59:26` Removing @example while its plugin is installed is refused (409)  
✅ `08:59:26` …scope_in_use  
✅ `08:59:26` …naming @example/e2e-scoped-server  
✅ `08:59:26` Clearing the registry credential while @example is trusted is refused (409)  
✅ `08:59:26` …trusted_scopes_need_registry  

## Uninstalled with purge; the scope removed and refused again

✅ `08:59:33` Uninstalled with purge ()  
✅ `08:59:33` e2e-scoped is gone from the relay  
✅ `08:59:34` @example is no longer trusted  
✅ `08:59:34` …@lamalibre alone again  
✅ `08:59:34` Audit: settings.trusted-scope.removed  
✅ `08:59:34` Installing @example/e2e-scoped-server is refused again (untrusted_scope)  
✅ `08:59:38` The agent's sync dropped @example  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `60` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `60` |

ℹ️ `08:59:38` Cleaning up test resources...  
