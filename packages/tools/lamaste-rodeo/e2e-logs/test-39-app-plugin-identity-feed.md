# Lamaste E2E: 39 — App plugin identity feed (Three-VM)

> Started at `2026-11-03 10:05:22 UTC`


## Pre-flight

✅ `10:05:22` Onboarding is complete  
✅ `10:05:22` Agent test-agent is enrolled on the host  
✅ `10:05:22` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:05:23` The agent VM's lamaste-agent has the apphost command  
ℹ️ `10:05:23` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  
✅ `10:05:23` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `10:05:23` testuser has a directory id (c02d7d5d-31df-4d9e-bd75-f9445f7c3285)  
✅ `10:05:23` The panel's directory has an id (b87242d0-7c2d-42d3-87fe-43a5472853f8)  

## Fixtures, the stand-in Feria; both plugins installed and hosted

✅ `10:05:24` Fixtures built: @lamalibre/e2e-idfeed-server (identity: viewer, editor; displayName, email) and @lamalibre/e2e-idplain-server (no identity)  
✅ `10:05:39` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-idfeed-server, @lamalibre/e2e-idfeed-agent, @lamalibre/e2e-idplain-server, @lamalibre/e2e-idplain-agent )  
✅ `10:05:39` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:05:40` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T10:05:40.278Z"})  
✅ `10:05:40` …through its own OIDC client  
✅ `10:05:44` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:05:49` Installed @lamalibre/e2e-idfeed-server@1.0.0  
✅ `10:05:49` …its identity block: roles editor and viewer, attributes displayName and email  
✅ `10:05:49` …approved with its agent half  
✅ `10:05:53` Installed @lamalibre/e2e-idplain-server@1.0.0, no identity  
✅ `10:06:04` e2e-idfeed hosted on test-agent ()  
✅ `10:06:04` e2e-idplain hosted on test-agent ()  
✅ `10:06:21` The relay's health of e2e-idfeed is up  
✅ `10:06:21` The relay's health of e2e-idplain is up  

## Ready: its agent half's first complete sync reached the head; it follows the directory

✅ `10:06:21` e2e-idfeed is ready for its users  
✅ `10:06:21` 1.0.0 is ready; its agent half follows directory b87242d0-7c2d-42d3-87fe-43a5472853f8  
✅ `10:06:21` …its cursor at the head of the audience: ready means synced, not merely answering  
✅ `10:06:21` The panel synced it at 2026-11-03T10:06:19.517Z  
✅ `10:06:21` GET /api/e2e-idfeed/e2e/projection: the agent half's projection follows the same directory  
✅ `10:06:21` …and holds no member: no one is entitled yet  

## Entitled: testuser as viewer, a group's member as editor

✅ `10:06:22` User e2e39-bob created  
✅ `10:06:22` …with a directory id (1c7bd900-93f7-4b48-8154-2b9c247d0692)  
✅ `10:06:22` Group e2e39-editors created  
✅ `10:06:22` …with e2e39-bob in it  
✅ `10:06:22` testuser entitled as viewer  
✅ `10:06:22` …named by the directory's id  
✅ `10:06:22` e2e39-editors entitled as editor  
✅ `10:06:23` The agent half's projection holds both, pushed through the tunnel  
✅ `10:06:23` testuser: viewer, active  
✅ `10:06:23` …with the directory's display name and address — both declared  
✅ `10:06:23` e2e39-bob: editor through the group, active  
✅ `10:06:23` …E2E Bob, e2e39-bob@example.test  
✅ `10:06:23` The panel sees its agent half at the head of the audience  
✅ `10:06:23` The audience: two active members  

## Revoked: removed, unentitled, the last attributes kept

✅ `10:06:23` testuser's role revoked  
✅ `10:06:23` The agent half: testuser removed, unentitled  
✅ `10:06:23` …no roles, the last attributes it received kept  
✅ `10:06:23` …removed at 2026-11-03T10:06:23.744Z  
✅ `10:06:24` The panel's audience: remove/unentitled with the last attributes  

## Disabled: still a member, status disabled

✅ `10:06:24` e2e39-bob disabled, the same id  
✅ `10:06:24` The agent half: e2e39-bob disabled, still an editor  
✅ `10:06:24` The audience: one disabled member, none active  

## Deleted: removed, deleted, the last display name kept

✅ `10:06:24` e2e39-bob deleted; Gatekeeper dropped their grants and memberships  
✅ `10:06:24` The agent half: e2e39-bob removed, deleted  
✅ `10:06:24` …no roles, the last display name kept  
✅ `10:06:25` e2e39-editors no longer has them  
✅ `10:06:25` The directory keeps their tombstone  

## Erased while the agent half is stopped: queued, then caught up

✅ `10:06:25` The agent half is stopped: its socket and its service (nothing holds its port)  
✅ `10:06:25` e2e39-bob erased by their id  
✅ `10:06:25` The directory scrubbed the tombstone to the bare id  
✅ `10:06:25` …and the erasure is pending for e2e-idfeed  
✅ `10:06:26` GET /api/plugins/e2e-idfeed/identity: pending erasure 1c7bd900-93f7-4b48-8154-2b9c247d0692  
✅ `10:06:26` …its agent half is behind (1 change)  
✅ `10:06:26` The audience: remove/erased, nothing but the id  
✅ `10:06:26` The panel tried and could not deliver it: other: read ECONNRESET  
ℹ️ `10:06:26` The agent half's socket started again; nothing asks the panel to sync  
✅ `10:06:39` The agent half caught up on its own (health back up, or the minute's retry)  
✅ `10:06:39` The agent half scrubbed the row to the bare id  
✅ `10:06:39` …erased at 2026-11-03T10:06:38.303Z  
✅ `10:06:40` …and ran the plugin's anonymiser (onErase)  
✅ `10:06:40` No erasure pending for e2e-idfeed: its cursor passed it  
✅ `10:06:40` GET /api/identity/directory: none pending for the user  

## Reconcile: nothing to find; then a tampered projection

✅ `10:06:40` testuser entitled as viewer again  
✅ `10:06:40` The agent half: testuser a member again  
✅ `10:06:40` POST /api/plugins/e2e-idfeed/identity/sync {reconcile}: a replay that finds no mismatch  
✅ `10:06:40` …recorded: lastMismatches 0  
✅ `10:06:40` Tampered with as lamaste-app-e2e-idfeed: testuser given the editor role, a member slipped in  
✅ `10:06:41` …the agent half now believes testuser is an editor  
✅ `10:06:41` …and holds a member the directory never named  
✅ `10:06:41` The next reconcile reports 2 mismatches  
✅ `10:06:41` …recorded on the feed's state  
✅ `10:06:41` …and audited (identity.reconcile.mismatches)  
✅ `10:06:41` The replay put testuser back: viewer  
✅ `10:06:41` …and removed the member the directory never named  
✅ `10:06:41` The reconcile after that finds nothing  
✅ `10:06:41` …and audits nothing  

## A plugin without identity is never sent any

✅ `10:06:42` GET /api/plugins/e2e-idplain/audience: 400  
✅ `10:06:42` …no_identity  
✅ `10:06:42` GET /api/plugins/e2e-idplain/entitlements: 400  
✅ `10:06:42` …no_identity  
✅ `10:06:42` POST /api/plugins/e2e-idplain/identity/sync: 400 (no_identity)  
✅ `10:06:42` PUT /api/plugins/e2e-idplain/entitlements: 400 — no roles to give  
✅ `10:06:42` GET /api/plugins/e2e-idplain/identity: nothing declared, no feed  
✅ `10:06:42` Its agent half's request log: not one /admin/identity request  
✅ `10:06:42` …though it answered the relay's health probes all along (5 logged)  
✅ `10:06:42` …while e2e-idfeed's agent half was sent 23 identity calls  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `92` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `92` |

ℹ️ `10:06:42` Cleaning up test resources...  
