# Lamaste E2E: 41 — App plugin identity ledger across an uninstall (Three-VM)

> Started at `2026-11-02 16:32:02 UTC`


## Pre-flight

✅ `16:32:02` Onboarding is complete  
✅ `16:32:02` Agent test-agent is enrolled on the host  
✅ `16:32:02` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `16:32:03` The agent VM's lamaste-agent has the apphost command  
ℹ️ `16:32:03` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  
✅ `16:32:03` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `16:32:03` testuser has a directory id (e9e04643-ef58-46d4-883d-67c366b35251)  

## Entitled before it is hosted; the moment it is ready, its projection holds them

✅ `16:32:04` Fixture built: @lamalibre/e2e-ledger-server (identity: viewer, editor; displayName, email) and its agent package  
✅ `16:32:06` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-ledger-server, @lamalibre/e2e-ledger-agent )  
✅ `16:32:06` The agent VM reaches it at http://10.13.37.1:4874  
✅ `16:32:08` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-02T16:32:08.528Z"})  
✅ `16:32:08` …through its own OIDC client  
✅ `16:32:08` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `16:32:09` User e2e41-carol created  
✅ `16:32:09` …with a directory id (709faba2-f85c-47df-bd65-b41099e7beee)  
✅ `16:32:11` Installed @lamalibre/e2e-ledger-server@1.0.0, which declares identity; approved  
✅ `16:32:12` e2e41-carol entitled as viewer, before the plugin is hosted  
✅ `16:32:12` testuser entitled as viewer, before the plugin is hosted  
✅ `16:32:22` Hosted on test-agent ()  
✅ `16:32:22` The agent half answers through the tunnel (its data: instance 2367ef914c0967bb)  
✅ `16:32:41` The relay's health of the hosting is up  
✅ `16:32:41` Ready: its agent half's first complete sync ended at the head of the audience  
✅ `16:32:42` 1.0.0 is ready, nothing behind  
✅ `16:32:42` The projection already holds e2e41-carol: active, viewer  
✅ `16:32:42` …and testuser  

## Uninstalled without purge: the data stays on the agent

✅ `16:32:49` Uninstalled without purge ()  
✅ `16:32:49` The plugin is gone from the relay  
✅ `16:32:49` GET /api/plugins/e2e-ledger/retained-data: test-agent keeps its agent half's data  
✅ `16:32:49` The projection in that data holds e2e41-carol, active  

## Deleted and erased while no agent half runs: the erasure waits for the kept data

✅ `16:32:49` e2e41-carol deleted  
✅ `16:32:50` …and erased by their id  
✅ `16:32:50` The directory scrubbed the tombstone to the bare id  
✅ `16:32:50` The erasure is pending for e2e-ledger, uninstalled as it is: its ledger stayed with its data  
✅ `16:32:50` …marked inactive: no feed reaches the data until the plugin comes back  
✅ `16:32:50` The kept projection still holds e2e41-carol's name: nothing reached it yet  

## Installed and hosted again: the kept data taken back, the erasure replayed

✅ `16:32:52` @lamalibre/e2e-ledger-server@1.0.0 installed again, approved  
✅ `16:33:02` Hosted on test-agent again ()  
✅ `16:33:03` The agent half took back the data the uninstall kept (instance 2367ef914c0967bb)  
✅ `16:33:03` …and the relay no longer records it as retained  
✅ `16:33:03` Ready again: the replay since the hosting reached the head  
✅ `16:33:03` Ready, the projection holds e2e41-carol as the bare id, erased: the replay delivered the erasure  
✅ `16:33:03` …erased at 2026-11-02T16:33:02.628Z  
✅ `16:33:03` …and the plugin's anonymiser (onErase) ran for them  
✅ `16:33:03` testuser is still a viewer: Gatekeeper's grants outlived the uninstall  
✅ `16:33:03` GET /api/plugins/e2e-ledger/identity: no erasure pending  
✅ `16:33:03` GET /api/identity/directory: none pending for e2e41-carol  

## An erasure is sticky: the relay's upsert never brings the user back

✅ `16:33:03` As lamaste-app-e2e-ledger: testuser's row scrubbed as an erasure leaves it — one the relay's ledger does not hold  
✅ `16:33:03` Reconcile 1: the relay's upsert of testuser contradicts the erasure — reported (1 mismatch)  
✅ `16:33:04` …the row stays the bare id, erased  
✅ `16:33:04` Reconcile 2: the relay's upsert of testuser contradicts the erasure — reported (1 mismatch)  
✅ `16:33:04` …the row stays the bare id, erased  
✅ `16:33:04` …and no hook ran for it (the plugin's anonymiser was never called for testuser)  

## Uninstalled with purge: no data left anywhere, the ledger goes

✅ `16:33:11` Uninstalled with purge ()  
✅ `16:33:11` The plugin is gone from the relay  
✅ `16:33:11` No agent keeps data of e2e-ledger  
✅ `16:33:12` …its data directory, the projection in it, and its account are gone from the agent VM  
✅ `16:33:12` The relay dropped the plugin's identity ledger (journal: Dropped the identity ledger of a plugin no agent keeps data of)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `16:33:12` Cleaning up test resources...  
