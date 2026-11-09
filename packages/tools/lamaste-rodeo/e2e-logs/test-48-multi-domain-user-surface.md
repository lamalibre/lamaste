# Lamaste E2E: 48 — Multi-domain relay: a plugin's user surface on another domain (Three-VM)

> Started at `2026-11-09 13:44:07 UTC`


## Pre-flight

✅ `13:44:07` Onboarding is complete  
✅ `13:44:07` Agent test-agent is enrolled on the host  
✅ `13:44:08` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:44:08` The agent VM's lamaste-agent has the apphost command  
✅ `13:44:08` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `13:44:08` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a member of A and a customer of B; the plugin installed on A

✅ `13:44:09` Domain lamaste-second.local added (201)  
✅ `13:44:09` …pending until activated  
✅ `13:44:09` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `13:44:09` …the one required record is auth.lamaste-second.local  
✅ `13:44:10` lamaste-second.local is active  
✅ `13:44:11` User e2e48-member created, member of test.lamaste.local  
✅ `13:44:11` User e2e48-cust created, member of lamaste-second.local  
✅ `13:44:11` Both have a directory id  
✅ `13:44:11` Fixture built: @lamalibre/e2e-mdsurf-server (identity: viewer, editor) and its agent package  
✅ `13:44:19` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-mdsurf-server, @lamalibre/e2e-mdsurf-agent )  
✅ `13:44:20` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:44:21` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T13:44:21.288Z"})  
✅ `13:44:21` …through its own OIDC client  
✅ `13:44:25` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:44:29` Installed @lamalibre/e2e-mdsurf-server@1.0.0  
✅ `13:44:29` …it belongs to the primary domain A  
✅ `13:44:29` Approved  
✅ `13:44:40` Hosted on test-agent ()  
✅ `13:44:59` The relay's health of the hosting is up  
✅ `13:44:59` Ready: its agent half's first complete sync ended at the head  

## Bound to an authenticated tunnel on A; the member entitled

✅ `13:45:01` Tunnel e2e48us.test.lamaste.local (authenticated), carried by test-agent  
✅ `13:45:02` PUT /api/tunnels/529dea9a-0513-49be-8c88-7ad09fdc7272/user-surface {route: e2e-mdsurf}  
✅ `13:45:02` …served  
✅ `13:45:02` e2e48-member entitled as viewer  
✅ `13:45:02` …an active member of the audience  

## The member reaches the agent half; the customer of B gets JSON not_a_member

✅ `13:45:04` e2e48-member signed in at auth.test.lamaste.local (password, TOTP)  
✅ `13:45:06` e2e48-cust signed in at auth.test.lamaste.local (password, TOTP)  
✅ `13:45:06` GET /api/e2e-mdsurf/app/echo as e2e48-member: 200  
✅ `13:45:06` …the caller the panel signed  
✅ `13:45:06` GET /api/e2e-mdsurf/app/echo as e2e48-cust (a member of B only): 403  
✅ `13:45:06` …JSON {error: not_a_member}  
✅ `13:45:06` …never a redirect  
✅ `13:45:06` …and nothing of another user  

## The plugin cannot move to B while it is served on A

✅ `13:45:07` PUT /api/plugins/e2e-mdsurf/domain {domain: B}: 409 while bound on A  
✅ `13:45:07` …surface_bound  
✅ `13:45:07` …it still belongs to A  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `42` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `42` |

ℹ️ `13:45:07` Cleaning up test resources...  
