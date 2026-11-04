# Lamaste E2E: 39 — App plugin identity feed (Three-VM)

> Started at `2026-11-04 14:09:37 UTC`


## Pre-flight

✅ `14:09:37` Onboarding is complete  
✅ `14:09:37` Agent test-agent is enrolled on the host  
✅ `14:09:38` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:09:38` The agent VM's lamaste-agent has the apphost command  
ℹ️ `14:09:38` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  
✅ `14:09:38` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `14:09:38` testuser has a directory id (1147b52f-3100-420a-9e0c-15ca839e1edf)  
✅ `14:09:38` The panel's directory has an id (e62f2dce-d919-44cd-b86b-cc94acab05d2)  

## Fixtures, the stand-in Feria; both plugins installed and hosted

✅ `14:09:39` Fixtures built: @lamalibre/e2e-idfeed-server (identity: viewer, editor; displayName, email) and @lamalibre/e2e-idplain-server (no identity)  
✅ `14:09:42` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-idfeed-server, @lamalibre/e2e-idfeed-agent, @lamalibre/e2e-idplain-server, @lamalibre/e2e-idplain-agent )  
✅ `14:09:42` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:09:43` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T14:09:43.389Z"})  
✅ `14:09:43` …through its own OIDC client  
✅ `14:09:43` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:09:45` Installed @lamalibre/e2e-idfeed-server@1.0.0  
✅ `14:09:45` …its identity block: roles editor and viewer, attributes displayName and email  
✅ `14:09:45` …approved with its agent half  
✅ `14:09:47` Installed @lamalibre/e2e-idplain-server@1.0.0, no identity  
✅ `14:09:57` e2e-idfeed hosted on test-agent ()  
✅ `14:09:57` e2e-idplain hosted on test-agent ()  
✅ `14:10:14` The relay's health of e2e-idfeed is up  
✅ `14:10:14` The relay's health of e2e-idplain is up  

## Ready: its agent half's first complete sync reached the head; it follows the directory

✅ `14:10:14` e2e-idfeed is ready for its users  
✅ `14:10:14` 1.0.0 is ready; its agent half follows directory e62f2dce-d919-44cd-b86b-cc94acab05d2  
✅ `14:10:14` …its cursor at the head of the audience: ready means synced, not merely answering  
✅ `14:10:14` The panel synced it at 2026-11-04T14:10:13.814Z  
✅ `14:10:14` GET /api/e2e-idfeed/e2e/projection: the agent half's projection follows the same directory  
✅ `14:10:14` …and holds no member: no one is entitled yet  

## Entitled: testuser as viewer, a group's member as editor

✅ `14:10:15` User e2e39-bob created  
✅ `14:10:15` …with a directory id (ea4ba1d9-a419-455f-9f49-0d72857ca9be)  
✅ `14:10:15` Group e2e39-editors created  
✅ `14:10:15` …with e2e39-bob in it  
✅ `14:10:15` testuser entitled as viewer  
✅ `14:10:15` …named by the directory's id  
✅ `14:10:15` e2e39-editors entitled as editor  
✅ `14:10:15` The agent half's projection holds both, pushed through the tunnel  
✅ `14:10:16` testuser: viewer, active  
✅ `14:10:16` …with the directory's display name and address — both declared  
✅ `14:10:16` e2e39-bob: editor through the group, active  
✅ `14:10:16` …E2E Bob, e2e39-bob@example.test  
✅ `14:10:16` The panel sees its agent half at the head of the audience  
✅ `14:10:16` The audience: two active members  

## Revoked: removed, unentitled, the last attributes kept

✅ `14:10:16` testuser's role revoked  
✅ `14:10:16` The agent half: testuser removed, unentitled  
✅ `14:10:17` …no roles, the last attributes it received kept  
✅ `14:10:17` …removed at 2026-11-04T14:10:16.673Z  
✅ `14:10:17` The panel's audience: remove/unentitled with the last attributes  

## Disabled: still a member, status disabled

✅ `14:10:17` e2e39-bob disabled, the same id  
✅ `14:10:17` The agent half: e2e39-bob disabled, still an editor  
✅ `14:10:17` The audience: one disabled member, none active  

## Deleted: removed, deleted, the last display name kept

✅ `14:10:17` e2e39-bob deleted; Gatekeeper dropped their grants and memberships  
✅ `14:10:18` The agent half: e2e39-bob removed, deleted  
✅ `14:10:18` …no roles, the last display name kept  
✅ `14:10:18` e2e39-editors no longer has them  
✅ `14:10:18` The directory keeps their tombstone  

## Erased while the agent half is stopped: queued, then caught up

✅ `14:10:18` The agent half is stopped: its socket and its service (nothing holds its port)  
✅ `14:10:18` e2e39-bob erased by their id  
✅ `14:10:19` The directory scrubbed the tombstone to the bare id  
✅ `14:10:19` …and the erasure is pending for e2e-idfeed  
✅ `14:10:19` GET /api/plugins/e2e-idfeed/identity: pending erasure ea4ba1d9-a419-455f-9f49-0d72857ca9be  
✅ `14:10:19` …its agent half is behind (1 change)  
✅ `14:10:19` The audience: remove/erased, nothing but the id  
✅ `14:10:19` The panel tried and could not deliver it: other: read ECONNRESET  
ℹ️ `14:10:19` The agent half's socket started again; nothing asks the panel to sync  
✅ `14:10:39` The agent half caught up on its own (health back up, or the minute's retry)  
✅ `14:10:39` The agent half scrubbed the row to the bare id  
✅ `14:10:39` …erased at 2026-11-04T14:10:37.978Z  
✅ `14:10:39` …and ran the plugin's anonymiser (onErase)  
✅ `14:10:39` No erasure pending for e2e-idfeed: its cursor passed it  
✅ `14:10:39` GET /api/identity/directory: none pending for the user  

## Reconcile: nothing to find; then a tampered projection

✅ `14:10:40` testuser entitled as viewer again  
✅ `14:10:40` The agent half: testuser a member again  
✅ `14:10:40` POST /api/plugins/e2e-idfeed/identity/sync {reconcile}: a replay that finds no mismatch  
✅ `14:10:40` …recorded: lastMismatches 0  
✅ `14:10:40` Tampered with as lamaste-app-e2e-idfeed: testuser given the editor role, a member slipped in  
✅ `14:10:40` …the agent half now believes testuser is an editor  
✅ `14:10:40` …and holds a member the directory never named  
✅ `14:10:41` The next reconcile reports 2 mismatches  
✅ `14:10:41` …recorded on the feed's state  
✅ `14:10:41` …and audited (identity.reconcile.mismatches)  
✅ `14:10:41` The replay put testuser back: viewer  
✅ `14:10:41` …and removed the member the directory never named  
✅ `14:10:41` The reconcile after that finds nothing  
✅ `14:10:41` …and audits nothing  

## A plugin without identity is never sent any

✅ `14:10:41` GET /api/plugins/e2e-idplain/audience: 400  
✅ `14:10:41` …no_identity  
✅ `14:10:41` GET /api/plugins/e2e-idplain/entitlements: 400  
✅ `14:10:42` …no_identity  
✅ `14:10:42` POST /api/plugins/e2e-idplain/identity/sync: 400 (no_identity)  
✅ `14:10:42` PUT /api/plugins/e2e-idplain/entitlements: 400 — no roles to give  
✅ `14:10:42` GET /api/plugins/e2e-idplain/identity: nothing declared, no feed  
✅ `14:10:42` Its agent half's request log: not one /admin/identity request  
✅ `14:10:42` …though it answered the relay's health probes all along (5 logged)  
✅ `14:10:42` …while e2e-idfeed's agent half was sent 23 identity calls  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `92` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `92` |

ℹ️ `14:10:42` Cleaning up test resources...  
