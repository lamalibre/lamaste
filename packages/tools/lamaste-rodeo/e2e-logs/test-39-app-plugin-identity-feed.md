# Lamaste E2E: 39 — App plugin identity feed (Three-VM)

> Started at `2026-11-10 13:40:23 UTC`


## Pre-flight

✅ `13:40:23` Onboarding is complete  
✅ `13:40:24` Agent test-agent is enrolled on the host  
✅ `13:40:24` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:40:24` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:40:24` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  
✅ `13:40:24` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `13:40:25` testuser has a directory id (9145b465-0d30-4f0a-95d4-1a5407a52c18)  
✅ `13:40:25` The panel's directory has an id (d4e2e7af-ced1-4ddd-9b85-a212ad9d247f)  

## Fixtures, the stand-in Feria; both plugins installed and hosted

✅ `13:40:26` Fixtures built: @lamalibre/e2e-idfeed-server (identity: viewer, editor; displayName, email) and @lamalibre/e2e-idplain-server (no identity)  
✅ `13:40:42` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-idfeed-server, @lamalibre/e2e-idfeed-agent, @lamalibre/e2e-idplain-server, @lamalibre/e2e-idplain-agent )  
✅ `13:40:42` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:40:43` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T13:40:43.417Z"})  
✅ `13:40:43` …through its own OIDC client  
✅ `13:40:47` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:40:53` Installed @lamalibre/e2e-idfeed-server@1.0.0  
✅ `13:40:53` …its identity block: roles editor and viewer, attributes displayName and email  
✅ `13:40:53` …approved with its agent half  
✅ `13:40:57` Installed @lamalibre/e2e-idplain-server@1.0.0, no identity  
✅ `13:41:08` e2e-idfeed hosted on test-agent ()  
✅ `13:41:08` e2e-idplain hosted on test-agent ()  
✅ `13:41:22` The relay's health of e2e-idfeed is up  
✅ `13:41:22` The relay's health of e2e-idplain is up  

## Ready: its agent half's first complete sync reached the head; it follows the directory

✅ `13:41:22` e2e-idfeed is ready for its users  
✅ `13:41:23` 1.0.0 is ready; its agent half follows directory d4e2e7af-ced1-4ddd-9b85-a212ad9d247f  
✅ `13:41:23` …its cursor at the head of the audience: ready means synced, not merely answering  
✅ `13:41:23` The panel synced it at 2026-11-10T13:41:19.165Z  
✅ `13:41:23` GET /api/e2e-idfeed/e2e/projection: the agent half's projection follows the same directory  
✅ `13:41:23` …and holds no member: no one is entitled yet  

## Entitled: testuser as viewer, a group's member as editor

✅ `13:41:23` User e2e39-bob created  
✅ `13:41:23` …with a directory id (d3b727d2-83ec-4f3d-b48d-a8051495650c)  
✅ `13:41:23` Group e2e39-editors created  
✅ `13:41:24` …with e2e39-bob in it  
✅ `13:41:24` testuser entitled as viewer  
✅ `13:41:24` …named by the directory's id  
✅ `13:41:24` e2e39-editors entitled as editor  
✅ `13:41:24` The agent half's projection holds both, pushed through the tunnel  
✅ `13:41:24` testuser: viewer, active  
✅ `13:41:24` …with the directory's display name and address — both declared  
✅ `13:41:24` e2e39-bob: editor through the group, active  
✅ `13:41:24` …E2E Bob, e2e39-bob@example.test  
✅ `13:41:25` The panel sees its agent half at the head of the audience  
✅ `13:41:25` The audience: two active members  

## Revoked: removed, unentitled, the last attributes kept

✅ `13:41:25` testuser's role revoked  
✅ `13:41:25` The agent half: testuser removed, unentitled  
✅ `13:41:25` …no roles, the last attributes it received kept  
✅ `13:41:25` …removed at 2026-11-10T13:41:25.398Z  
✅ `13:41:25` The panel's audience: remove/unentitled with the last attributes  

## Disabled: still a member, status disabled

✅ `13:41:26` e2e39-bob disabled, the same id  
✅ `13:41:26` The agent half: e2e39-bob disabled, still an editor  
✅ `13:41:26` The audience: one disabled member, none active  

## Deleted: removed, deleted, the last display name kept

✅ `13:41:26` e2e39-bob deleted; Gatekeeper dropped their grants and memberships  
✅ `13:41:26` The agent half: e2e39-bob removed, deleted  
✅ `13:41:27` …no roles, the last display name kept  
✅ `13:41:27` e2e39-editors no longer has them  
✅ `13:41:27` The directory keeps their tombstone  

## Erased while the agent half is stopped: queued, then caught up

✅ `13:41:27` The agent half is stopped: its socket and its service (nothing holds its port)  
✅ `13:41:28` e2e39-bob erased by their id  
✅ `13:41:28` The directory scrubbed the tombstone to the bare id  
✅ `13:41:28` …and the erasure is pending for e2e-idfeed  
✅ `13:41:28` GET /api/plugins/e2e-idfeed/identity: pending erasure d3b727d2-83ec-4f3d-b48d-a8051495650c  
✅ `13:41:28` …its agent half is behind (1 change)  
✅ `13:41:28` The audience: remove/erased, nothing but the id  
✅ `13:41:29` The panel tried and could not deliver it: other: read ECONNRESET  
ℹ️ `13:41:29` The agent half's socket started again; nothing asks the panel to sync  
✅ `13:42:08` The agent half caught up on its own (health back up, or the minute's retry)  
✅ `13:42:08` The agent half scrubbed the row to the bare id  
✅ `13:42:08` …erased at 2026-11-10T13:42:08.586Z  
✅ `13:42:09` …and ran the plugin's anonymiser (onErase)  
✅ `13:42:09` No erasure pending for e2e-idfeed: its cursor passed it  
✅ `13:42:09` GET /api/identity/directory: none pending for the user  

## Reconcile: nothing to find; then a tampered projection

✅ `13:42:09` testuser entitled as viewer again  
✅ `13:42:09` The agent half: testuser a member again  
✅ `13:42:09` POST /api/plugins/e2e-idfeed/identity/sync {reconcile}: a replay that finds no mismatch  
✅ `13:42:09` …recorded: lastMismatches 0  
✅ `13:42:10` Tampered with as lamaste-app-e2e-idfeed: testuser given the editor role, a member slipped in  
✅ `13:42:10` …the agent half now believes testuser is an editor  
✅ `13:42:10` …and holds a member the directory never named  
✅ `13:42:10` The next reconcile reports 2 mismatches  
✅ `13:42:10` …recorded on the feed's state  
✅ `13:42:11` …and audited (identity.reconcile.mismatches)  
✅ `13:42:11` The replay put testuser back: viewer  
✅ `13:42:11` …and removed the member the directory never named  
✅ `13:42:11` The reconcile after that finds nothing  
✅ `13:42:11` …and audits nothing  

## A plugin without identity is never sent any

✅ `13:42:11` GET /api/plugins/e2e-idplain/audience: 400  
✅ `13:42:11` …no_identity  
✅ `13:42:12` GET /api/plugins/e2e-idplain/entitlements: 400  
✅ `13:42:12` …no_identity  
✅ `13:42:12` POST /api/plugins/e2e-idplain/identity/sync: 400 (no_identity)  
✅ `13:42:12` PUT /api/plugins/e2e-idplain/entitlements: 400 — no roles to give  
✅ `13:42:12` GET /api/plugins/e2e-idplain/identity: nothing declared, no feed  
✅ `13:42:12` Its agent half's request log: not one /admin/identity request  
✅ `13:42:12` …though it answered the relay's health probes all along (8 logged)  
✅ `13:42:12` …while e2e-idfeed's agent half was sent 23 identity calls  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `92` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `92` |

ℹ️ `13:42:12` Cleaning up test resources...  
