# Lamaste E2E: 39 — App plugin identity feed (Three-VM)

> Started at `2026-11-10 18:22:33 UTC`


## Pre-flight

✅ `18:22:34` Onboarding is complete  
✅ `18:22:34` Agent test-agent is enrolled on the host  
✅ `18:22:34` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `18:22:34` The agent VM's lamaste-agent has the apphost command  
ℹ️ `18:22:34` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  
✅ `18:22:35` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `18:22:35` testuser has a directory id (2ffd9f57-e9f3-4f6f-a9ed-cdc01426ff28)  
✅ `18:22:35` The panel's directory has an id (aacd56ad-d6e1-4472-bfaf-079896b7cdca)  

## Fixtures, the stand-in Feria; both plugins installed and hosted

✅ `18:22:36` Fixtures built: @lamalibre/e2e-idfeed-server (identity: viewer, editor; displayName, email) and @lamalibre/e2e-idplain-server (no identity)  
✅ `18:22:51` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-idfeed-server, @lamalibre/e2e-idfeed-agent, @lamalibre/e2e-idplain-server, @lamalibre/e2e-idplain-agent )  
✅ `18:22:51` The agent VM reaches it at http://10.13.37.1:4874  
✅ `18:22:52` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T18:22:52.823Z"})  
✅ `18:22:52` …through its own OIDC client  
✅ `18:22:56` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `18:23:02` Installed @lamalibre/e2e-idfeed-server@1.0.0  
✅ `18:23:02` …its identity block: roles editor and viewer, attributes displayName and email  
✅ `18:23:02` …approved with its agent half  
✅ `18:23:06` Installed @lamalibre/e2e-idplain-server@1.0.0, no identity  
✅ `18:23:17` e2e-idfeed hosted on test-agent ()  
✅ `18:23:17` e2e-idplain hosted on test-agent ()  
✅ `18:23:37` The relay's health of e2e-idfeed is up  
✅ `18:23:37` The relay's health of e2e-idplain is up  

## Ready: its agent half's first complete sync reached the head; it follows the directory

✅ `18:23:38` e2e-idfeed is ready for its users  
✅ `18:23:38` 1.0.0 is ready; its agent half follows directory aacd56ad-d6e1-4472-bfaf-079896b7cdca  
✅ `18:23:38` …its cursor at the head of the audience: ready means synced, not merely answering  
✅ `18:23:38` The panel synced it at 2026-11-10T18:23:37.274Z  
✅ `18:23:38` GET /api/e2e-idfeed/e2e/projection: the agent half's projection follows the same directory  
✅ `18:23:38` …and holds no member: no one is entitled yet  

## Entitled: testuser as viewer, a group's member as editor

✅ `18:23:39` User e2e39-bob created  
✅ `18:23:39` …with a directory id (f3a99138-08da-4330-9fe4-abd7efc7a5cf)  
✅ `18:23:39` Group e2e39-editors created  
✅ `18:23:39` …with e2e39-bob in it  
✅ `18:23:39` testuser entitled as viewer  
✅ `18:23:39` …named by the directory's id  
✅ `18:23:39` e2e39-editors entitled as editor  
✅ `18:23:39` The agent half's projection holds both, pushed through the tunnel  
✅ `18:23:39` testuser: viewer, active  
✅ `18:23:39` …with the directory's display name and address — both declared  
✅ `18:23:40` e2e39-bob: editor through the group, active  
✅ `18:23:40` …E2E Bob, e2e39-bob@example.test  
✅ `18:23:40` The panel sees its agent half at the head of the audience  
✅ `18:23:40` The audience: two active members  

## Revoked: removed, unentitled, the last attributes kept

✅ `18:23:40` testuser's role revoked  
✅ `18:23:40` The agent half: testuser removed, unentitled  
✅ `18:23:40` …no roles, the last attributes it received kept  
✅ `18:23:40` …removed at 2026-11-10T18:23:40.672Z  
✅ `18:23:41` The panel's audience: remove/unentitled with the last attributes  

## Disabled: still a member, status disabled

✅ `18:23:41` e2e39-bob disabled, the same id  
✅ `18:23:41` The agent half: e2e39-bob disabled, still an editor  
✅ `18:23:41` The audience: one disabled member, none active  

## Deleted: removed, deleted, the last display name kept

✅ `18:23:41` e2e39-bob deleted; Gatekeeper dropped their grants and memberships  
✅ `18:23:42` The agent half: e2e39-bob removed, deleted  
✅ `18:23:42` …no roles, the last display name kept  
✅ `18:23:42` e2e39-editors no longer has them  
✅ `18:23:42` The directory keeps their tombstone  

## Erased while the agent half is stopped: queued, then caught up

✅ `18:23:42` The agent half is stopped: its socket and its service (nothing holds its port)  
✅ `18:23:43` e2e39-bob erased by their id  
✅ `18:23:43` The directory scrubbed the tombstone to the bare id  
✅ `18:23:43` …and the erasure is pending for e2e-idfeed  
✅ `18:23:43` GET /api/plugins/e2e-idfeed/identity: pending erasure f3a99138-08da-4330-9fe4-abd7efc7a5cf  
✅ `18:23:43` …its agent half is behind (1 change)  
✅ `18:23:43` The audience: remove/erased, nothing but the id  
✅ `18:23:44` The panel tried and could not deliver it: other: read ECONNRESET  
ℹ️ `18:23:44` The agent half's socket started again; nothing asks the panel to sync  
✅ `18:24:39` The agent half caught up on its own (health back up, or the minute's retry)  
✅ `18:24:39` The agent half scrubbed the row to the bare id  
✅ `18:24:39` …erased at 2026-11-10T18:24:37.764Z  
✅ `18:24:39` …and ran the plugin's anonymiser (onErase)  
✅ `18:24:40` No erasure pending for e2e-idfeed: its cursor passed it  
✅ `18:24:40` GET /api/identity/directory: none pending for the user  

## Reconcile: nothing to find; then a tampered projection

✅ `18:24:40` testuser entitled as viewer again  
✅ `18:24:40` The agent half: testuser a member again  
✅ `18:24:40` POST /api/plugins/e2e-idfeed/identity/sync {reconcile}: a replay that finds no mismatch  
✅ `18:24:40` …recorded: lastMismatches 0  
✅ `18:24:41` Tampered with as lamaste-app-e2e-idfeed: testuser given the editor role, a member slipped in  
✅ `18:24:41` …the agent half now believes testuser is an editor  
✅ `18:24:41` …and holds a member the directory never named  
✅ `18:24:41` The next reconcile reports 2 mismatches  
✅ `18:24:41` …recorded on the feed's state  
✅ `18:24:41` …and audited (identity.reconcile.mismatches)  
✅ `18:24:41` The replay put testuser back: viewer  
✅ `18:24:42` …and removed the member the directory never named  
✅ `18:24:42` The reconcile after that finds nothing  
✅ `18:24:42` …and audits nothing  

## A plugin without identity is never sent any

✅ `18:24:42` GET /api/plugins/e2e-idplain/audience: 400  
✅ `18:24:42` …no_identity  
✅ `18:24:42` GET /api/plugins/e2e-idplain/entitlements: 400  
✅ `18:24:42` …no_identity  
✅ `18:24:42` POST /api/plugins/e2e-idplain/identity/sync: 400 (no_identity)  
✅ `18:24:43` PUT /api/plugins/e2e-idplain/entitlements: 400 — no roles to give  
✅ `18:24:43` GET /api/plugins/e2e-idplain/identity: nothing declared, no feed  
✅ `18:24:43` Its agent half's request log: not one /admin/identity request  
✅ `18:24:43` …though it answered the relay's health probes all along (10 logged)  
✅ `18:24:43` …while e2e-idfeed's agent half was sent 23 identity calls  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `92` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `92` |

ℹ️ `18:24:43` Cleaning up test resources...  
