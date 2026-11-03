# Lamaste E2E: 48 — Multi-domain relay: a plugin's user surface on another domain (Three-VM)

> Started at `2026-11-03 10:32:38 UTC`


## Pre-flight

✅ `10:32:38` Onboarding is complete  
✅ `10:32:38` Agent test-agent is enrolled on the host  
✅ `10:32:38` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:32:38` The agent VM's lamaste-agent has the apphost command  
✅ `10:32:38` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `10:32:38` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a member of A and a customer of B; the plugin installed on A

✅ `10:32:39` Domain lamaste-second.local added (201)  
✅ `10:32:39` …pending until activated  
✅ `10:32:39` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `10:32:39` …the one required record is auth.lamaste-second.local  
✅ `10:32:40` lamaste-second.local is active  
✅ `10:32:41` User e2e48-member created, member of test.lamaste.local  
✅ `10:32:42` User e2e48-cust created, member of lamaste-second.local  
✅ `10:32:42` Both have a directory id  
✅ `10:32:42` Fixture built: @lamalibre/e2e-mdsurf-server (identity: viewer, editor) and its agent package  
✅ `10:32:50` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-mdsurf-server, @lamalibre/e2e-mdsurf-agent )  
✅ `10:32:51` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:32:52` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T10:32:52.106Z"})  
✅ `10:32:52` …through its own OIDC client  
✅ `10:32:56` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:33:00` Installed @lamalibre/e2e-mdsurf-server@1.0.0  
✅ `10:33:01` …it belongs to the primary domain A  
✅ `10:33:01` Approved  
✅ `10:33:11` Hosted on test-agent ()  
✅ `10:33:31` The relay's health of the hosting is up  
✅ `10:33:31` Ready: its agent half's first complete sync ended at the head  

## Bound to an authenticated tunnel on A; the member entitled

✅ `10:33:32` Tunnel e2e48us.test.lamaste.local (authenticated), carried by test-agent  
✅ `10:33:34` PUT /api/tunnels/f95c9729-958a-4a30-b7ec-f5821adad4c9/user-surface {route: e2e-mdsurf}  
✅ `10:33:34` …served  
✅ `10:33:34` e2e48-member entitled as viewer  
✅ `10:33:34` …an active member of the audience  

## The member reaches the agent half; the customer of B gets JSON not_a_member

✅ `10:33:36` e2e48-member signed in at auth.test.lamaste.local (password, TOTP)  
✅ `10:33:38` e2e48-cust signed in at auth.test.lamaste.local (password, TOTP)  
✅ `10:33:38` GET /api/e2e-mdsurf/app/echo as e2e48-member: 200  
✅ `10:33:38` …the caller the panel signed  
✅ `10:33:38` GET /api/e2e-mdsurf/app/echo as e2e48-cust (a member of B only): 403  
✅ `10:33:38` …JSON {error: not_a_member}  
✅ `10:33:38` …never a redirect  
✅ `10:33:38` …and nothing of another user  

## The plugin cannot move to B while it is served on A

✅ `10:33:38` PUT /api/plugins/e2e-mdsurf/domain {domain: B}: 409 while bound on A  
✅ `10:33:38` …surface_bound  
✅ `10:33:38` …it still belongs to A  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `42` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `42` |

ℹ️ `10:33:38` Cleaning up test resources...  
