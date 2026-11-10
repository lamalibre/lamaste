# Lamaste E2E: 62 — A trusted publisher scope: an app plugin of a second scope (Three-VM)

> Started at `2026-11-10 15:02:59 UTC`


## Pre-flight

✅ `15:02:59` Onboarding is complete  
✅ `15:03:00` Agent test-agent is enrolled on the host  
✅ `15:03:00` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `15:03:00` The agent VM's lamaste-agent has the apphost command  
✅ `15:03:01` The built-in trusted scope is @lamalibre  
✅ `15:03:01` @example is not trusted on this relay  

## Published to the development Feria

✅ `15:03:01` The development Feria hosts @example (@lamalibre, @example)  
✅ `15:03:01` Fixture built: @example/e2e-scoped-server and its bundled agent half @example/e2e-scoped-agent 1.0.0  
✅ `15:03:02` npm publish @example/e2e-scoped-server@1.0.0 to the development Feria  
✅ `15:03:02` npm publish @example/e2e-scoped-agent@1.0.0 to the development Feria  
✅ `15:03:03` A package of a scope the development Feria does not host is not accepted  
✅ `15:03:05` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with no packages )  
✅ `15:03:05` The agent VM reaches it at http://10.13.37.1:4874  
✅ `15:03:06` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T15:03:06.673Z"})  
✅ `15:03:06` …through its own OIDC client  
✅ `15:03:06` The VMs reach the development Feria at http://192.168.2.1:4873  
✅ `15:03:07` @example/e2e-scoped-server@1.0.0 fetched from the development Feria and served by the stand-in  
✅ `15:03:07` …byte for byte (integrity sha512-tMSnA27CyxzY0…)  
✅ `15:03:07` @example/e2e-scoped-agent@1.0.0 fetched from the development Feria and served by the stand-in  
✅ `15:03:07` …byte for byte (integrity sha512-fy52Au9EYvkTd…)  

## Not trusted: the install is refused

✅ `15:03:08` Installing @example/e2e-scoped-server on a relay that does not trust @example is refused (400)  
✅ `15:03:08` …untrusted_scope  
✅ `15:03:08` …and nothing is installed  
✅ `15:03:08` A look-alike of the built-in scope (@lamalibre-evil/e2e-scoped-server) is refused  
✅ `15:03:08` A look-alike of the built-in scope (@LamaLibre/e2e-scoped-server) is refused  

## Trusting the scope: only while the registry hosts it

✅ `15:03:08` Trusting @example while the registry does not host it is refused (409)  
✅ `15:03:08` …registry_lacks_scope  
✅ `15:03:09` lamaste-server trusted-scopes add @example ({"builtIn":"@lamalibre","additional":["@example"],"effective":["@lamalibre","@example"]})  
✅ `15:03:09` GET /api/settings/trusted-scopes lists it  
✅ `15:03:09` Audit: settings.trusted-scope.added  
✅ `15:03:09` The administrators are told  
✅ `15:03:13` The agent's sync recorded the relay's list: @lamalibre,@example  

## Installed from the trusted scope; the agent half pinned

✅ `15:03:18` Installed @example/e2e-scoped-server@1.0.0  
✅ `15:03:18` …the plugin e2e-scoped, named by its route  
✅ `15:03:18` Its agent half is @example/e2e-scoped-agent  
✅ `15:03:18` …pinned at the integrity the registry publishes  
✅ `15:03:18` Approved  

## Hosted through the app host helper (protocol 3)

✅ `15:03:23` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `15:03:23` Host facts: the helper speaks protocol 3 (any trusted scope)  
✅ `15:03:23` Eligibility: test-agent can host it  
✅ `15:03:24` The agent's window is open, under a policy naming @example/e2e-scoped-agent  
✅ `15:03:35` The hosting operation succeeded ()  
✅ `15:03:35` Step: install the agent half  
✅ `15:03:35` The agent half runs on the agent VM  
✅ `15:03:35` …as lamaste-app-e2e-scoped  
✅ `15:03:35` The app host helper records @example/e2e-scoped-agent as the route's owner  
✅ `15:03:35` GET /api/e2e-scoped/ping reaches the installed version through the tunnel  
✅ `15:03:35` The agent pulled @example/e2e-scoped-agent from the relay's registry with its brokered token (@example routed there)  

## In use: the scope stays trusted, the registry stays configured

✅ `15:03:35` Removing @example while its plugin is installed is refused (409)  
✅ `15:03:36` …scope_in_use  
✅ `15:03:36` …naming @example/e2e-scoped-server  
✅ `15:03:36` Clearing the registry credential while @example is trusted is refused (409)  
✅ `15:03:36` …trusted_scopes_need_registry  

## Uninstalled with purge; the scope removed and refused again

✅ `15:03:43` Uninstalled with purge ()  
✅ `15:03:43` e2e-scoped is gone from the relay  
✅ `15:03:44` @example is no longer trusted  
✅ `15:03:44` …@lamalibre alone again  
✅ `15:03:44` Audit: settings.trusted-scope.removed  
✅ `15:03:44` Installing @example/e2e-scoped-server is refused again (untrusted_scope)  
✅ `15:03:48` The agent's sync dropped @example  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `60` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `60` |

ℹ️ `15:03:48` Cleaning up test resources...  
