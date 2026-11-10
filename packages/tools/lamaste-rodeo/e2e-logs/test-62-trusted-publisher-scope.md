# Lamaste E2E: 62 — A trusted publisher scope: an app plugin of a second scope (Three-VM)

> Started at `2026-11-10 20:16:36 UTC`


## Pre-flight

✅ `20:16:36` Onboarding is complete  
✅ `20:16:37` Agent test-agent is enrolled on the host  
✅ `20:16:37` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `20:16:37` The agent VM's lamaste-agent has the apphost command  
✅ `20:16:37` The built-in trusted scope is @lamalibre  
✅ `20:16:38` @example is not trusted on this relay  

## Published to the development Feria

✅ `20:16:38` The development Feria hosts @example (@lamalibre, @example)  
✅ `20:16:38` Fixture built: @example/e2e-scoped-server and its bundled agent half @example/e2e-scoped-agent 1.0.0  
✅ `20:16:39` npm publish @example/e2e-scoped-server@1.0.0 to the development Feria  
✅ `20:16:39` npm publish @example/e2e-scoped-agent@1.0.0 to the development Feria  
✅ `20:16:40` A package of a scope the development Feria does not host is not accepted  
✅ `20:16:42` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with no packages )  
✅ `20:16:42` The agent VM reaches it at http://10.13.37.1:4874  
✅ `20:16:43` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T20:16:43.889Z"})  
✅ `20:16:43` …through its own OIDC client  
✅ `20:16:44` The VMs reach the development Feria at http://192.168.2.1:4873  
✅ `20:16:44` @example/e2e-scoped-server@1.0.0 fetched from the development Feria and served by the stand-in  
✅ `20:16:44` …byte for byte (integrity sha512-tMSnA27CyxzY0…)  
✅ `20:16:45` @example/e2e-scoped-agent@1.0.0 fetched from the development Feria and served by the stand-in  
✅ `20:16:45` …byte for byte (integrity sha512-5IScthtFfVJK4…)  

## Not trusted: the install is refused

✅ `20:16:45` Installing @example/e2e-scoped-server on a relay that does not trust @example is refused (400)  
✅ `20:16:45` …untrusted_scope  
✅ `20:16:45` …and nothing is installed  
✅ `20:16:46` A look-alike of the built-in scope (@lamalibre-evil/e2e-scoped-server) is refused  
✅ `20:16:46` A look-alike of the built-in scope (@LamaLibre/e2e-scoped-server) is refused  

## Trusting the scope: only while the registry hosts it

✅ `20:16:46` Trusting @example while the registry does not host it is refused (409)  
✅ `20:16:46` …registry_lacks_scope  
✅ `20:16:47` lamaste-server trusted-scopes add @example ({"builtIn":"@lamalibre","additional":["@example"],"effective":["@lamalibre","@example"]})  
✅ `20:16:47` GET /api/settings/trusted-scopes lists it  
✅ `20:16:47` Audit: settings.trusted-scope.added  
✅ `20:16:47` The administrators are told  
✅ `20:16:51` The agent's sync recorded the relay's list: @lamalibre,@example  

## Installed from the trusted scope; the agent half pinned

✅ `20:16:55` Installed @example/e2e-scoped-server@1.0.0  
✅ `20:16:55` …the plugin e2e-scoped, named by its route  
✅ `20:16:55` Its agent half is @example/e2e-scoped-agent  
✅ `20:16:55` …pinned at the integrity the registry publishes  
✅ `20:16:55` Approved  

## Hosted through the app host helper (protocol 3)

✅ `20:17:00` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `20:17:00` Host facts: the helper speaks protocol 3 (any trusted scope)  
✅ `20:17:00` Eligibility: test-agent can host it  
✅ `20:17:01` The agent's window is open, under a policy naming @example/e2e-scoped-agent  
✅ `20:17:11` The hosting operation succeeded ()  
✅ `20:17:12` Step: install the agent half  
✅ `20:17:12` The agent half runs on the agent VM  
✅ `20:17:12` …as lamaste-app-e2e-scoped  
✅ `20:17:12` The app host helper records @example/e2e-scoped-agent as the route's owner  
✅ `20:17:12` GET /api/e2e-scoped/ping reaches the installed version through the tunnel  
✅ `20:17:12` The agent pulled @example/e2e-scoped-agent from the relay's registry with its brokered token (@example routed there)  

## In use: the scope stays trusted, the registry stays configured

✅ `20:17:12` Removing @example while its plugin is installed is refused (409)  
✅ `20:17:12` …scope_in_use  
✅ `20:17:12` …naming @example/e2e-scoped-server  
✅ `20:17:13` Clearing the registry credential while @example is trusted is refused (409)  
✅ `20:17:13` …trusted_scopes_need_registry  

## Uninstalled with purge; the scope removed and refused again

✅ `20:17:24` Uninstalled with purge ()  
✅ `20:17:24` e2e-scoped is gone from the relay  
✅ `20:17:24` @example is no longer trusted  
✅ `20:17:24` …@lamalibre alone again  
✅ `20:17:24` Audit: settings.trusted-scope.removed  
✅ `20:17:24` Installing @example/e2e-scoped-server is refused again (untrusted_scope)  
✅ `20:17:28` The agent's sync dropped @example  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `60` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `60` |

ℹ️ `20:17:28` Cleaning up test resources...  
