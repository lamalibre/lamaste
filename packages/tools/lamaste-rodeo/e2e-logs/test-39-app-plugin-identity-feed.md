# Lamaste E2E: 39 — App plugin identity feed (Three-VM)

> Started at `2026-11-02 16:23:11 UTC`


## Pre-flight

✅ `16:23:11` Onboarding is complete  
✅ `16:23:12` Agent test-agent is enrolled on the host  
✅ `16:23:12` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `16:23:12` The agent VM's lamaste-agent has the apphost command  
ℹ️ `16:23:12` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  
✅ `16:23:12` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `16:23:12` testuser has a directory id (e9e04643-ef58-46d4-883d-67c366b35251)  
✅ `16:23:12` The panel's directory has an id (c7f9df84-7b79-45b3-92ed-375e74233c30)  

## Fixtures, the stand-in Feria; both plugins installed and hosted

✅ `16:23:13` Fixtures built: @lamalibre/e2e-idfeed-server (identity: viewer, editor; displayName, email) and @lamalibre/e2e-idplain-server (no identity)  
✅ `16:23:17` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-idfeed-server, @lamalibre/e2e-idfeed-agent, @lamalibre/e2e-idplain-server, @lamalibre/e2e-idplain-agent )  
✅ `16:23:17` The agent VM reaches it at http://10.13.37.1:4874  
✅ `16:23:19` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-02T16:23:19.387Z"})  
✅ `16:23:19` …through its own OIDC client  
✅ `16:23:23` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `16:23:25` Installed @lamalibre/e2e-idfeed-server@1.0.0  
✅ `16:23:25` …its identity block: roles editor and viewer, attributes displayName and email  
✅ `16:23:25` …approved with its agent half  
✅ `16:23:27` Installed @lamalibre/e2e-idplain-server@1.0.0, no identity  
✅ `16:23:38` e2e-idfeed hosted on test-agent ()  
✅ `16:23:38` e2e-idplain hosted on test-agent ()  
✅ `16:23:55` The relay's health of e2e-idfeed is up  
✅ `16:23:55` The relay's health of e2e-idplain is up  

## Ready: its agent half's first complete sync reached the head; it follows the directory

✅ `16:23:55` e2e-idfeed is ready for its users  
✅ `16:23:55` 1.0.0 is ready; its agent half follows directory c7f9df84-7b79-45b3-92ed-375e74233c30  
✅ `16:23:55` …its cursor at the head of the audience: ready means synced, not merely answering  
✅ `16:23:55` The panel synced it at 2026-11-02T16:23:55.146Z  
✅ `16:23:55` GET /api/e2e-idfeed/e2e/projection: the agent half's projection follows the same directory  
✅ `16:23:55` …and holds no member: no one is entitled yet  

## Entitled: testuser as viewer, a group's member as editor

✅ `16:23:56` User e2e39-bob created  
✅ `16:23:56` …with a directory id (8c0a9da4-853b-421d-9e95-15458c2527b6)  
✅ `16:23:56` Group e2e39-editors created  
✅ `16:23:56` …with e2e39-bob in it  
✅ `16:23:56` testuser entitled as viewer  
✅ `16:23:56` …named by the directory's id  
✅ `16:23:56` e2e39-editors entitled as editor  
✅ `16:23:57` The agent half's projection holds both, pushed through the tunnel  
✅ `16:23:57` testuser: viewer, active  
✅ `16:23:57` …with the directory's display name and address — both declared  
✅ `16:23:57` e2e39-bob: editor through the group, active  
✅ `16:23:57` …E2E Bob, e2e39-bob@example.test  
✅ `16:23:57` The panel sees its agent half at the head of the audience  
✅ `16:23:57` The audience: two active members  

## Revoked: removed, unentitled, the last attributes kept

✅ `16:23:57` testuser's role revoked  
✅ `16:23:57` The agent half: testuser removed, unentitled  
✅ `16:23:57` …no roles, the last attributes it received kept  
✅ `16:23:57` …removed at 2026-11-02T16:23:57.954Z  
✅ `16:23:57` The panel's audience: remove/unentitled with the last attributes  

## Disabled: still a member, status disabled

✅ `16:23:58` e2e39-bob disabled, the same id  
✅ `16:23:58` The agent half: e2e39-bob disabled, still an editor  
✅ `16:23:58` The audience: one disabled member, none active  

## Deleted: removed, deleted, the last display name kept

✅ `16:23:58` e2e39-bob deleted; Gatekeeper dropped their grants and memberships  
✅ `16:23:58` The agent half: e2e39-bob removed, deleted  
✅ `16:23:58` …no roles, the last display name kept  
✅ `16:23:58` e2e39-editors no longer has them  
✅ `16:23:58` The directory keeps their tombstone  

## Erased while the agent half is stopped: queued, then caught up

✅ `16:23:59` The agent half is stopped: its socket and its service (nothing holds its port)  
✅ `16:23:59` e2e39-bob erased by their id  
✅ `16:23:59` The directory scrubbed the tombstone to the bare id  
✅ `16:23:59` …and the erasure is pending for e2e-idfeed  
✅ `16:23:59` GET /api/plugins/e2e-idfeed/identity: pending erasure 8c0a9da4-853b-421d-9e95-15458c2527b6  
✅ `16:23:59` …its agent half is behind (1 change)  
✅ `16:23:59` The audience: remove/erased, nothing but the id  
✅ `16:23:59` The panel tried and could not deliver it: other: read ECONNRESET  
ℹ️ `16:23:59` The agent half's socket started again; nothing asks the panel to sync  
✅ `16:24:06` The agent half caught up on its own (health back up, or the minute's retry)  
✅ `16:24:06` The agent half scrubbed the row to the bare id  
✅ `16:24:06` …erased at 2026-11-02T16:24:06.936Z  
✅ `16:24:06` …and ran the plugin's anonymiser (onErase)  
✅ `16:24:07` No erasure pending for e2e-idfeed: its cursor passed it  
✅ `16:24:07` GET /api/identity/directory: none pending for the user  

## Reconcile: nothing to find; then a tampered projection

✅ `16:24:07` testuser entitled as viewer again  
✅ `16:24:07` The agent half: testuser a member again  
✅ `16:24:07` POST /api/plugins/e2e-idfeed/identity/sync {reconcile}: a replay that finds no mismatch  
✅ `16:24:07` …recorded: lastMismatches 0  
✅ `16:24:07` Tampered with as lamaste-app-e2e-idfeed: testuser given the editor role, a member slipped in  
✅ `16:24:07` …the agent half now believes testuser is an editor  
✅ `16:24:07` …and holds a member the directory never named  
✅ `16:24:08` The next reconcile reports 2 mismatches  
✅ `16:24:08` …recorded on the feed's state  
✅ `16:24:08` …and audited (identity.reconcile.mismatches)  
✅ `16:24:08` The replay put testuser back: viewer  
✅ `16:24:08` …and removed the member the directory never named  
✅ `16:24:08` The reconcile after that finds nothing  
✅ `16:24:08` …and audits nothing  

## A plugin without identity is never sent any

✅ `16:24:08` GET /api/plugins/e2e-idplain/audience: 400  
✅ `16:24:08` …no_identity  
✅ `16:24:08` GET /api/plugins/e2e-idplain/entitlements: 400  
✅ `16:24:08` …no_identity  
✅ `16:24:09` POST /api/plugins/e2e-idplain/identity/sync: 400 (no_identity)  
✅ `16:24:09` PUT /api/plugins/e2e-idplain/entitlements: 400 — no roles to give  
✅ `16:24:09` GET /api/plugins/e2e-idplain/identity: nothing declared, no feed  
✅ `16:24:09` Its agent half's request log: not one /admin/identity request  
✅ `16:24:09` …though it answered the relay's health probes all along (4 logged)  
✅ `16:24:09` …while e2e-idfeed's agent half was sent 23 identity calls  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `92` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `92` |

ℹ️ `16:24:09` Cleaning up test resources...  
