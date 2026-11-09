# Lamaste E2E: 39 — App plugin identity feed (Three-VM)

> Started at `2026-11-09 13:17:08 UTC`


## Pre-flight

✅ `13:17:08` Onboarding is complete  
✅ `13:17:08` Agent test-agent is enrolled on the host  
✅ `13:17:09` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:17:09` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:17:09` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  
✅ `13:17:09` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `13:17:09` testuser has a directory id (a4ea9be9-a804-4853-bcab-a5f64ac9ee43)  
✅ `13:17:09` The panel's directory has an id (f1d5f1e1-13b5-4986-b929-af4e8d912eb6)  

## Fixtures, the stand-in Feria; both plugins installed and hosted

✅ `13:17:10` Fixtures built: @lamalibre/e2e-idfeed-server (identity: viewer, editor; displayName, email) and @lamalibre/e2e-idplain-server (no identity)  
✅ `13:17:24` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-idfeed-server, @lamalibre/e2e-idfeed-agent, @lamalibre/e2e-idplain-server, @lamalibre/e2e-idplain-agent )  
✅ `13:17:24` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:17:25` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T13:17:25.985Z"})  
✅ `13:17:25` …through its own OIDC client  
✅ `13:17:29` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:17:35` Installed @lamalibre/e2e-idfeed-server@1.0.0  
✅ `13:17:35` …its identity block: roles editor and viewer, attributes displayName and email  
✅ `13:17:35` …approved with its agent half  
✅ `13:17:39` Installed @lamalibre/e2e-idplain-server@1.0.0, no identity  
✅ `13:17:50` e2e-idfeed hosted on test-agent ()  
✅ `13:17:50` e2e-idplain hosted on test-agent ()  
✅ `13:18:03` The relay's health of e2e-idfeed is up  
✅ `13:18:03` The relay's health of e2e-idplain is up  

## Ready: its agent half's first complete sync reached the head; it follows the directory

✅ `13:18:03` e2e-idfeed is ready for its users  
✅ `13:18:03` 1.0.0 is ready; its agent half follows directory f1d5f1e1-13b5-4986-b929-af4e8d912eb6  
✅ `13:18:03` …its cursor at the head of the audience: ready means synced, not merely answering  
✅ `13:18:03` The panel synced it at 2026-11-09T13:18:01.506Z  
✅ `13:18:03` GET /api/e2e-idfeed/e2e/projection: the agent half's projection follows the same directory  
✅ `13:18:03` …and holds no member: no one is entitled yet  

## Entitled: testuser as viewer, a group's member as editor

✅ `13:18:04` User e2e39-bob created  
✅ `13:18:04` …with a directory id (c20dbdb4-ee7e-4893-88d1-cf6874f3c6f9)  
✅ `13:18:04` Group e2e39-editors created  
✅ `13:18:04` …with e2e39-bob in it  
✅ `13:18:04` testuser entitled as viewer  
✅ `13:18:04` …named by the directory's id  
✅ `13:18:04` e2e39-editors entitled as editor  
✅ `13:18:04` The agent half's projection holds both, pushed through the tunnel  
✅ `13:18:04` testuser: viewer, active  
✅ `13:18:04` …with the directory's display name and address — both declared  
✅ `13:18:05` e2e39-bob: editor through the group, active  
✅ `13:18:05` …E2E Bob, e2e39-bob@example.test  
✅ `13:18:05` The panel sees its agent half at the head of the audience  
✅ `13:18:05` The audience: two active members  

## Revoked: removed, unentitled, the last attributes kept

✅ `13:18:05` testuser's role revoked  
✅ `13:18:05` The agent half: testuser removed, unentitled  
✅ `13:18:05` …no roles, the last attributes it received kept  
✅ `13:18:05` …removed at 2026-11-09T13:18:05.452Z  
✅ `13:18:05` The panel's audience: remove/unentitled with the last attributes  

## Disabled: still a member, status disabled

✅ `13:18:05` e2e39-bob disabled, the same id  
✅ `13:18:05` The agent half: e2e39-bob disabled, still an editor  
✅ `13:18:06` The audience: one disabled member, none active  

## Deleted: removed, deleted, the last display name kept

✅ `13:18:06` e2e39-bob deleted; Gatekeeper dropped their grants and memberships  
✅ `13:18:06` The agent half: e2e39-bob removed, deleted  
✅ `13:18:06` …no roles, the last display name kept  
✅ `13:18:06` e2e39-editors no longer has them  
✅ `13:18:06` The directory keeps their tombstone  

## Erased while the agent half is stopped: queued, then caught up

✅ `13:18:07` The agent half is stopped: its socket and its service (nothing holds its port)  
✅ `13:18:07` e2e39-bob erased by their id  
✅ `13:18:07` The directory scrubbed the tombstone to the bare id  
✅ `13:18:07` …and the erasure is pending for e2e-idfeed  
✅ `13:18:07` GET /api/plugins/e2e-idfeed/identity: pending erasure c20dbdb4-ee7e-4893-88d1-cf6874f3c6f9  
✅ `13:18:07` …its agent half is behind (1 change)  
✅ `13:18:07` The audience: remove/erased, nothing but the id  
✅ `13:18:08` The panel tried and could not deliver it: other: read ECONNRESET  
ℹ️ `13:18:08` The agent half's socket started again; nothing asks the panel to sync  
✅ `13:18:37` The agent half caught up on its own (health back up, or the minute's retry)  
✅ `13:18:37` The agent half scrubbed the row to the bare id  
✅ `13:18:37` …erased at 2026-11-09T13:18:36.074Z  
✅ `13:18:37` …and ran the plugin's anonymiser (onErase)  
✅ `13:18:37` No erasure pending for e2e-idfeed: its cursor passed it  
✅ `13:18:37` GET /api/identity/directory: none pending for the user  

## Reconcile: nothing to find; then a tampered projection

✅ `13:18:37` testuser entitled as viewer again  
✅ `13:18:38` The agent half: testuser a member again  
✅ `13:18:38` POST /api/plugins/e2e-idfeed/identity/sync {reconcile}: a replay that finds no mismatch  
✅ `13:18:38` …recorded: lastMismatches 0  
✅ `13:18:38` Tampered with as lamaste-app-e2e-idfeed: testuser given the editor role, a member slipped in  
✅ `13:18:38` …the agent half now believes testuser is an editor  
✅ `13:18:38` …and holds a member the directory never named  
✅ `13:18:39` The next reconcile reports 2 mismatches  
✅ `13:18:39` …recorded on the feed's state  
✅ `13:18:39` …and audited (identity.reconcile.mismatches)  
✅ `13:18:39` The replay put testuser back: viewer  
✅ `13:18:39` …and removed the member the directory never named  
✅ `13:18:39` The reconcile after that finds nothing  
✅ `13:18:39` …and audits nothing  

## A plugin without identity is never sent any

✅ `13:18:39` GET /api/plugins/e2e-idplain/audience: 400  
✅ `13:18:39` …no_identity  
✅ `13:18:40` GET /api/plugins/e2e-idplain/entitlements: 400  
✅ `13:18:40` …no_identity  
✅ `13:18:40` POST /api/plugins/e2e-idplain/identity/sync: 400 (no_identity)  
✅ `13:18:40` PUT /api/plugins/e2e-idplain/entitlements: 400 — no roles to give  
✅ `13:18:40` GET /api/plugins/e2e-idplain/identity: nothing declared, no feed  
✅ `13:18:40` Its agent half's request log: not one /admin/identity request  
✅ `13:18:40` …though it answered the relay's health probes all along (6 logged)  
✅ `13:18:40` …while e2e-idfeed's agent half was sent 23 identity calls  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `92` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `92` |

ℹ️ `13:18:40` Cleaning up test resources...  
