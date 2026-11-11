# Lamaste E2E: 48 — Multi-domain relay: a plugin's user surface on another domain (Three-VM)

> Started at `2026-11-10 18:52:43 UTC`


## Pre-flight

✅ `18:52:43` Onboarding is complete  
✅ `18:52:43` Agent test-agent is enrolled on the host  
✅ `18:52:44` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `18:52:44` The agent VM's lamaste-agent has the apphost command  
✅ `18:52:44` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `18:52:44` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a member of A and a customer of B; the plugin installed on A

✅ `18:52:45` Domain lamaste-second.local added (201)  
✅ `18:52:45` …pending until activated  
✅ `18:52:45` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `18:52:45` …the one required record is auth.lamaste-second.local  
✅ `18:52:47` lamaste-second.local is active  
✅ `18:52:48` User e2e48-member created, member of test.lamaste.local  
✅ `18:52:48` User e2e48-cust created, member of lamaste-second.local  
✅ `18:52:48` Both have a directory id  
✅ `18:52:49` Fixture built: @lamalibre/e2e-mdsurf-server (identity: viewer, editor) and its agent package  
✅ `18:52:58` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-mdsurf-server, @lamalibre/e2e-mdsurf-agent )  
✅ `18:52:58` The agent VM reaches it at http://10.13.37.1:4874  
✅ `18:52:59` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T18:52:59.719Z"})  
✅ `18:52:59` …through its own OIDC client  
✅ `18:53:03` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `18:53:08` Installed @lamalibre/e2e-mdsurf-server@1.0.0  
✅ `18:53:09` …it belongs to the primary domain A  
✅ `18:53:09` Approved  
✅ `18:53:20` Hosted on test-agent ()  
✅ `18:53:40` The relay's health of the hosting is up  
✅ `18:53:40` Ready: its agent half's first complete sync ended at the head  

## Bound to an authenticated tunnel on A; the member entitled

✅ `18:53:42` Tunnel e2e48us.test.lamaste.local (authenticated), carried by test-agent  
✅ `18:53:44` PUT /api/tunnels/a27cae2b-028d-42c2-8ab2-35fd7e2ca1ff/user-surface {route: e2e-mdsurf}  
✅ `18:53:44` …served  
✅ `18:53:44` e2e48-member entitled as viewer  
✅ `18:53:44` …an active member of the audience  

## The member reaches the agent half; the customer of B gets JSON not_a_member

✅ `18:53:47` e2e48-member signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:53:48` e2e48-cust signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:53:48` GET /api/e2e-mdsurf/app/echo as e2e48-member: 200  
✅ `18:53:49` …the caller the panel signed  
✅ `18:53:49` GET /api/e2e-mdsurf/app/echo as e2e48-cust (a member of B only): 403  
✅ `18:53:49` …JSON {error: not_a_member}  
✅ `18:53:49` …never a redirect  
✅ `18:53:49` …and nothing of another user  

## The plugin cannot move to B while it is served on A

✅ `18:53:49` PUT /api/plugins/e2e-mdsurf/domain {domain: B}: 409 while bound on A  
✅ `18:53:49` …surface_bound  
✅ `18:53:49` …it still belongs to A  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `42` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `42` |

ℹ️ `18:53:49` Cleaning up test resources...  
