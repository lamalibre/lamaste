# Lamaste E2E: 48 — Multi-domain relay: a plugin's user surface on another domain (Three-VM)

> Started at `2026-10-25 18:43:47 UTC`


## Pre-flight

✅ `18:43:47` Onboarding is complete  
✅ `18:43:47` Agent test-agent is enrolled on the host  
✅ `18:43:48` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `18:43:48` The agent VM's lamaste-agent has the apphost command  
✅ `18:43:48` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `18:43:48` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a member of A and a customer of B; the plugin installed on A

✅ `18:43:49` Domain lamaste-second.local added (201)  
✅ `18:43:49` …pending until activated  
✅ `18:43:49` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `18:43:49` …the one required record is auth.lamaste-second.local  
✅ `18:43:50` lamaste-second.local is active  
✅ `18:43:52` User e2e48-member created, member of test.lamaste.local  
✅ `18:43:53` User e2e48-cust created, member of lamaste-second.local  
✅ `18:43:53` Both have a directory id  
✅ `18:43:54` Fixture built: @lamalibre/e2e-mdsurf-server (identity: viewer, editor) and its agent package  
✅ `18:43:56` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-mdsurf-server, @lamalibre/e2e-mdsurf-agent )  
✅ `18:43:56` The agent VM reaches it at http://10.13.37.1:4874  
✅ `18:43:57` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-10-25T18:43:58.239Z"})  
✅ `18:43:57` …through its own OIDC client  
✅ `18:44:01` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `18:44:05` Installed @lamalibre/e2e-mdsurf-server@1.0.0  
✅ `18:44:05` …it belongs to the primary domain A  
✅ `18:44:05` Approved  
✅ `18:44:16` Hosted on test-agent ()  
✅ `18:44:35` The relay's health of the hosting is up  
✅ `18:44:35` Ready: its agent half's first complete sync ended at the head  

## Bound to an authenticated tunnel on A; the member entitled

✅ `18:44:36` Tunnel e2e48us.test.lamaste.local (authenticated), carried by test-agent  
✅ `18:44:38` PUT /api/tunnels/864aa1ed-7226-486e-9645-91d241509d97/user-surface {route: e2e-mdsurf}  
✅ `18:44:38` …served  
✅ `18:44:38` e2e48-member entitled as viewer  
✅ `18:44:38` …an active member of the audience  

## The member reaches the agent half; the customer of B gets JSON not_a_member

✅ `18:44:40` e2e48-member signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:44:41` e2e48-cust signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:44:41` GET /api/e2e-mdsurf/app/echo as e2e48-member: 200  
✅ `18:44:41` …the caller the panel signed  
✅ `18:44:42` GET /api/e2e-mdsurf/app/echo as e2e48-cust (a member of B only): 403  
✅ `18:44:42` …JSON {error: not_a_member}  
✅ `18:44:42` …never a redirect  
✅ `18:44:42` …and nothing of another user  

## The plugin cannot move to B while it is served on A

✅ `18:44:42` PUT /api/plugins/e2e-mdsurf/domain {domain: B}: 409 while bound on A  
✅ `18:44:42` …surface_bound  
✅ `18:44:42` …it still belongs to A  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `42` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `42` |

ℹ️ `18:44:42` Cleaning up test resources...  
