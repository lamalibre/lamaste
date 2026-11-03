# Lamaste E2E: 41 — App plugin identity ledger across an uninstall (Three-VM)

> Started at `2026-11-03 10:15:03 UTC`


## Pre-flight

✅ `10:15:04` Onboarding is complete  
✅ `10:15:04` Agent test-agent is enrolled on the host  
✅ `10:15:04` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:15:04` The agent VM's lamaste-agent has the apphost command  
ℹ️ `10:15:04` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  
✅ `10:15:05` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `10:15:05` testuser has a directory id (c02d7d5d-31df-4d9e-bd75-f9445f7c3285)  

## Entitled before it is hosted; the moment it is ready, its projection holds them

✅ `10:15:05` Fixture built: @lamalibre/e2e-ledger-server (identity: viewer, editor; displayName, email) and its agent package  
✅ `10:15:14` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-ledger-server, @lamalibre/e2e-ledger-agent )  
✅ `10:15:15` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:15:16` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T10:15:16.467Z"})  
✅ `10:15:16` …through its own OIDC client  
✅ `10:15:17` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:15:18` User e2e41-carol created  
✅ `10:15:18` …with a directory id (ed7f035b-0ed7-410f-99b5-26317b9baeba)  
✅ `10:15:22` Installed @lamalibre/e2e-ledger-server@1.0.0, which declares identity; approved  
✅ `10:15:22` e2e41-carol entitled as viewer, before the plugin is hosted  
✅ `10:15:22` testuser entitled as viewer, before the plugin is hosted  
✅ `10:15:33` Hosted on test-agent ()  
✅ `10:15:33` The agent half answers through the tunnel (its data: instance 1b1e5319727cddfc)  
✅ `10:15:43` The relay's health of the hosting is up  
✅ `10:15:43` Ready: its agent half's first complete sync ended at the head of the audience  
✅ `10:15:43` 1.0.0 is ready, nothing behind  
✅ `10:15:43` The projection already holds e2e41-carol: active, viewer  
✅ `10:15:43` …and testuser  

## Uninstalled without purge: the data stays on the agent

✅ `10:15:51` Uninstalled without purge ()  
✅ `10:15:51` The plugin is gone from the relay  
✅ `10:15:51` GET /api/plugins/e2e-ledger/retained-data: test-agent keeps its agent half's data  
✅ `10:15:51` The projection in that data holds e2e41-carol, active  

## Deleted and erased while no agent half runs: the erasure waits for the kept data

✅ `10:15:51` e2e41-carol deleted  
✅ `10:15:52` …and erased by their id  
✅ `10:15:52` The directory scrubbed the tombstone to the bare id  
✅ `10:15:52` The erasure is pending for e2e-ledger, uninstalled as it is: its ledger stayed with its data  
✅ `10:15:52` …marked inactive: no feed reaches the data until the plugin comes back  
✅ `10:15:52` The kept projection still holds e2e41-carol's name: nothing reached it yet  

## Installed and hosted again: the kept data taken back, the erasure replayed

✅ `10:15:56` @lamalibre/e2e-ledger-server@1.0.0 installed again, approved  
✅ `10:16:07` Hosted on test-agent again ()  
✅ `10:16:07` The agent half took back the data the uninstall kept (instance 1b1e5319727cddfc)  
✅ `10:16:07` …and the relay no longer records it as retained  
✅ `10:16:07` Ready again: the replay since the hosting reached the head  
✅ `10:16:07` Ready, the projection holds e2e41-carol as the bare id, erased: the replay delivered the erasure  
✅ `10:16:07` …erased at 2026-11-03T10:16:06.633Z  
✅ `10:16:07` …and the plugin's anonymiser (onErase) ran for them  
✅ `10:16:07` testuser is still a viewer: Gatekeeper's grants outlived the uninstall  
✅ `10:16:08` GET /api/plugins/e2e-ledger/identity: no erasure pending  
✅ `10:16:08` GET /api/identity/directory: none pending for e2e41-carol  

## An erasure is sticky: the relay's upsert never brings the user back

✅ `10:16:08` As lamaste-app-e2e-ledger: testuser's row scrubbed as an erasure leaves it — one the relay's ledger does not hold  
✅ `10:16:08` Reconcile 1: the relay's upsert of testuser contradicts the erasure — reported (1 mismatch)  
✅ `10:16:08` …the row stays the bare id, erased  
✅ `10:16:08` Reconcile 2: the relay's upsert of testuser contradicts the erasure — reported (1 mismatch)  
✅ `10:16:08` …the row stays the bare id, erased  
✅ `10:16:08` …and no hook ran for it (the plugin's anonymiser was never called for testuser)  

## Uninstalled with purge: no data left anywhere, the ledger goes

✅ `10:16:15` Uninstalled with purge ()  
✅ `10:16:15` The plugin is gone from the relay  
✅ `10:16:16` No agent keeps data of e2e-ledger  
✅ `10:16:16` …its data directory, the projection in it, and its account are gone from the agent VM  
✅ `10:16:16` The relay dropped the plugin's identity ledger (journal: Dropped the identity ledger of a plugin no agent keeps data of)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `10:16:16` Cleaning up test resources...  
