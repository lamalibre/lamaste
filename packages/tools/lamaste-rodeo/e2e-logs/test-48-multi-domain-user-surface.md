# Lamaste E2E: 48 — Multi-domain relay: a plugin's user surface on another domain (Three-VM)

> Started at `2026-11-04 14:36:08 UTC`


## Pre-flight

✅ `14:36:08` Onboarding is complete  
✅ `14:36:08` Agent test-agent is enrolled on the host  
✅ `14:36:09` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:36:09` The agent VM's lamaste-agent has the apphost command  
✅ `14:36:09` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `14:36:09` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a member of A and a customer of B; the plugin installed on A

✅ `14:36:10` Domain lamaste-second.local added (201)  
✅ `14:36:10` …pending until activated  
✅ `14:36:10` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:36:10` …the one required record is auth.lamaste-second.local  
✅ `14:36:11` lamaste-second.local is active  
✅ `14:36:12` User e2e48-member created, member of test.lamaste.local  
✅ `14:36:13` User e2e48-cust created, member of lamaste-second.local  
✅ `14:36:13` Both have a directory id  
✅ `14:36:13` Fixture built: @lamalibre/e2e-mdsurf-server (identity: viewer, editor) and its agent package  
✅ `14:36:16` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-mdsurf-server, @lamalibre/e2e-mdsurf-agent )  
✅ `14:36:16` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:36:17` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T14:36:17.721Z"})  
✅ `14:36:17` …through its own OIDC client  
✅ `14:36:21` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:36:23` Installed @lamalibre/e2e-mdsurf-server@1.0.0  
✅ `14:36:23` …it belongs to the primary domain A  
✅ `14:36:24` Approved  
✅ `14:36:35` Hosted on test-agent ()  
✅ `14:36:52` The relay's health of the hosting is up  
✅ `14:36:52` Ready: its agent half's first complete sync ended at the head  

## Bound to an authenticated tunnel on A; the member entitled

✅ `14:36:54` Tunnel e2e48us.test.lamaste.local (authenticated), carried by test-agent  
✅ `14:36:56` PUT /api/tunnels/499fa8f5-6da0-427b-aeeb-febf4d2815e1/user-surface {route: e2e-mdsurf}  
✅ `14:36:56` …served  
✅ `14:36:56` e2e48-member entitled as viewer  
✅ `14:36:56` …an active member of the audience  

## The member reaches the agent half; the customer of B gets JSON not_a_member

✅ `14:36:58` e2e48-member signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:37:00` e2e48-cust signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:37:00` GET /api/e2e-mdsurf/app/echo as e2e48-member: 200  
✅ `14:37:00` …the caller the panel signed  
✅ `14:37:01` GET /api/e2e-mdsurf/app/echo as e2e48-cust (a member of B only): 403  
✅ `14:37:01` …JSON {error: not_a_member}  
✅ `14:37:01` …never a redirect  
✅ `14:37:01` …and nothing of another user  

## The plugin cannot move to B while it is served on A

✅ `14:37:01` PUT /api/plugins/e2e-mdsurf/domain {domain: B}: 409 while bound on A  
✅ `14:37:01` …surface_bound  
✅ `14:37:01` …it still belongs to A  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `42` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `42` |

ℹ️ `14:37:01` Cleaning up test resources...  
