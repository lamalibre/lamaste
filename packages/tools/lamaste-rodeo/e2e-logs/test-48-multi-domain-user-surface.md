# Lamaste E2E: 48 — Multi-domain relay: a plugin's user surface on another domain (Three-VM)

> Started at `2026-11-02 16:49:08 UTC`


## Pre-flight

✅ `16:49:08` Onboarding is complete  
✅ `16:49:08` Agent test-agent is enrolled on the host  
✅ `16:49:08` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `16:49:09` The agent VM's lamaste-agent has the apphost command  
✅ `16:49:09` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `16:49:09` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a member of A and a customer of B; the plugin installed on A

✅ `16:49:10` Domain lamaste-second.local added (201)  
✅ `16:49:10` …pending until activated  
✅ `16:49:10` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `16:49:10` …the one required record is auth.lamaste-second.local  
✅ `16:49:11` lamaste-second.local is active  
✅ `16:49:12` User e2e48-member created, member of test.lamaste.local  
✅ `16:49:12` User e2e48-cust created, member of lamaste-second.local  
✅ `16:49:12` Both have a directory id  
✅ `16:49:13` Fixture built: @lamalibre/e2e-mdsurf-server (identity: viewer, editor) and its agent package  
✅ `16:49:15` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-mdsurf-server, @lamalibre/e2e-mdsurf-agent )  
✅ `16:49:15` The agent VM reaches it at http://10.13.37.1:4874  
✅ `16:49:16` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-02T16:49:17.160Z"})  
✅ `16:49:16` …through its own OIDC client  
✅ `16:49:20` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `16:49:23` Installed @lamalibre/e2e-mdsurf-server@1.0.0  
✅ `16:49:23` …it belongs to the primary domain A  
✅ `16:49:23` Approved  
✅ `16:49:34` Hosted on test-agent ()  
✅ `16:49:44` The relay's health of the hosting is up  
✅ `16:49:44` Ready: its agent half's first complete sync ended at the head  

## Bound to an authenticated tunnel on A; the member entitled

✅ `16:49:46` Tunnel e2e48us.test.lamaste.local (authenticated), carried by test-agent  
✅ `16:49:47` PUT /api/tunnels/236a4b36-7213-4895-96ee-d9bb04369fad/user-surface {route: e2e-mdsurf}  
✅ `16:49:47` …served  
✅ `16:49:47` e2e48-member entitled as viewer  
✅ `16:49:47` …an active member of the audience  

## The member reaches the agent half; the customer of B gets JSON not_a_member

✅ `16:49:49` e2e48-member signed in at auth.test.lamaste.local (password, TOTP)  
✅ `16:49:51` e2e48-cust signed in at auth.test.lamaste.local (password, TOTP)  
✅ `16:49:51` GET /api/e2e-mdsurf/app/echo as e2e48-member: 200  
✅ `16:49:51` …the caller the panel signed  
✅ `16:49:51` GET /api/e2e-mdsurf/app/echo as e2e48-cust (a member of B only): 403  
✅ `16:49:51` …JSON {error: not_a_member}  
✅ `16:49:51` …never a redirect  
✅ `16:49:51` …and nothing of another user  

## The plugin cannot move to B while it is served on A

✅ `16:49:51` PUT /api/plugins/e2e-mdsurf/domain {domain: B}: 409 while bound on A  
✅ `16:49:51` …surface_bound  
✅ `16:49:52` …it still belongs to A  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `42` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `42` |

ℹ️ `16:49:52` Cleaning up test resources...  
