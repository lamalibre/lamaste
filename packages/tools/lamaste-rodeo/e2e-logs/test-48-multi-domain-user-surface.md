# Lamaste E2E: 48 — Multi-domain relay: a plugin's user surface on another domain (Three-VM)

> Started at `2026-10-25 17:39:25 UTC`


## Pre-flight

✅ `17:39:25` Onboarding is complete  
✅ `17:39:25` Agent test-agent is enrolled on the host  
✅ `17:39:25` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `17:39:26` The agent VM's lamaste-agent has the apphost command  
✅ `17:39:26` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `17:39:26` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a member of A and a customer of B; the plugin installed on A

✅ `17:39:27` Domain lamaste-second.local added (201)  
✅ `17:39:27` …pending until activated  
✅ `17:39:27` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `17:39:27` …the one required record is auth.lamaste-second.local  
✅ `17:39:30` lamaste-second.local is active  
✅ `17:39:33` User e2e48-member created, member of test.lamaste.local  
✅ `17:39:36` User e2e48-cust created, member of lamaste-second.local  
✅ `17:39:36` Both have a directory id  
✅ `17:39:40` Fixture built: @lamalibre/e2e-mdsurf-server (identity: viewer, editor) and its agent package  
✅ `17:39:47` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-mdsurf-server, @lamalibre/e2e-mdsurf-agent )  
✅ `17:39:47` The agent VM reaches it at http://10.13.37.1:4874  
✅ `17:39:50` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-10-25T17:39:50.450Z"})  
✅ `17:39:50` …through its own OIDC client  
✅ `17:39:55` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `17:39:57` Installed @lamalibre/e2e-mdsurf-server@1.0.0  
✅ `17:39:57` …it belongs to the primary domain A  
✅ `17:39:57` Approved  
✅ `17:40:08` Hosted on test-agent ()  
✅ `17:40:22` The relay's health of the hosting is up  
✅ `17:40:22` Ready: its agent half's first complete sync ended at the head  

## Bound to an authenticated tunnel on A; the member entitled

✅ `17:40:23` Tunnel e2e48us.test.lamaste.local (authenticated), carried by test-agent  
✅ `17:40:24` PUT /api/tunnels/4d5543e9-8787-4046-af50-f6152426810f/user-surface {route: e2e-mdsurf}  
✅ `17:40:24` …served  
✅ `17:40:24` e2e48-member entitled as viewer  
✅ `17:40:24` …an active member of the audience  

## The member reaches the agent half; the customer of B gets JSON not_a_member

✅ `17:40:27` e2e48-member signed in at auth.test.lamaste.local (password, TOTP)  
✅ `17:40:28` e2e48-cust signed in at auth.test.lamaste.local (password, TOTP)  
✅ `17:40:28` GET /api/e2e-mdsurf/app/echo as e2e48-member: 200  
✅ `17:40:28` …the caller the panel signed  
✅ `17:40:28` GET /api/e2e-mdsurf/app/echo as e2e48-cust (a member of B only): 403  
✅ `17:40:28` …JSON {error: not_a_member}  
✅ `17:40:28` …never a redirect  
✅ `17:40:28` …and nothing of another user  

## The plugin cannot move to B while it is served on A

✅ `17:40:29` PUT /api/plugins/e2e-mdsurf/domain {domain: B}: 409 while bound on A  
✅ `17:40:29` …surface_bound  
✅ `17:40:29` …it still belongs to A  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `42` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `42` |

ℹ️ `17:40:29` Cleaning up test resources...  
