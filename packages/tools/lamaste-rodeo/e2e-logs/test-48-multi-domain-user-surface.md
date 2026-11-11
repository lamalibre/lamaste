# Lamaste E2E: 48 — Multi-domain relay: a plugin's user surface on another domain (Three-VM)

> Started at `2026-11-11 11:24:43 UTC`


## Pre-flight

✅ `11:24:43` Onboarding is complete  
✅ `11:24:43` Agent test-agent is enrolled on the host  
✅ `11:24:44` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `11:24:44` The agent VM's lamaste-agent has the apphost command  
✅ `11:24:44` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `11:24:44` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a member of A and a customer of B; the plugin installed on A

✅ `11:24:45` Domain lamaste-second.local added (201)  
✅ `11:24:45` …pending until activated  
✅ `11:24:45` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `11:24:45` …the one required record is auth.lamaste-second.local  
✅ `11:24:47` lamaste-second.local is active  
✅ `11:24:48` User e2e48-member created, member of test.lamaste.local  
✅ `11:24:48` User e2e48-cust created, member of lamaste-second.local  
✅ `11:24:48` Both have a directory id  
✅ `11:24:48` Fixture built: @lamalibre/e2e-mdsurf-server (identity: viewer, editor) and its agent package  
✅ `11:24:57` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-mdsurf-server, @lamalibre/e2e-mdsurf-agent )  
✅ `11:24:58` The agent VM reaches it at http://10.13.37.1:4874  
✅ `11:24:59` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T11:24:59.084Z"})  
✅ `11:24:59` …through its own OIDC client  
✅ `11:24:59` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `11:25:04` Installed @lamalibre/e2e-mdsurf-server@1.0.0  
✅ `11:25:05` …it belongs to the primary domain A  
✅ `11:25:05` Approved  
✅ `11:25:15` Hosted on test-agent ()  
✅ `11:25:28` The relay's health of the hosting is up  
✅ `11:25:28` Ready: its agent half's first complete sync ended at the head  

## Bound to an authenticated tunnel on A; the member entitled

✅ `11:25:32` Tunnel e2e48us.test.lamaste.local (authenticated), carried by test-agent  
✅ `11:25:35` PUT /api/tunnels/4faa7d49-3e40-4771-a462-13af69600663/user-surface {route: e2e-mdsurf}  
✅ `11:25:35` …served  
✅ `11:25:35` e2e48-member entitled as viewer  
✅ `11:25:36` …an active member of the audience  

## The member reaches the agent half; the customer of B gets JSON not_a_member

✅ `11:25:38` e2e48-member signed in at auth.test.lamaste.local (password, TOTP)  
✅ `11:25:40` e2e48-cust signed in at auth.test.lamaste.local (password, TOTP)  
✅ `11:25:40` GET /api/e2e-mdsurf/app/echo as e2e48-member: 200  
✅ `11:25:40` …the caller the panel signed  
✅ `11:25:40` GET /api/e2e-mdsurf/app/echo as e2e48-cust (a member of B only): 403  
✅ `11:25:40` …JSON {error: not_a_member}  
✅ `11:25:40` …never a redirect  
✅ `11:25:40` …and nothing of another user  

## The plugin cannot move to B while it is served on A

✅ `11:25:40` PUT /api/plugins/e2e-mdsurf/domain {domain: B}: 409 while bound on A  
✅ `11:25:40` …surface_bound  
✅ `11:25:41` …it still belongs to A  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `42` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `42` |

ℹ️ `11:25:41` Cleaning up test resources...  
