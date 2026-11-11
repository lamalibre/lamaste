# Lamaste E2E: 41 — App plugin identity ledger across an uninstall (Three-VM)

> Started at `2026-11-11 11:10:09 UTC`


## Pre-flight

✅ `11:10:10` Onboarding is complete  
✅ `11:10:10` Agent test-agent is enrolled on the host  
✅ `11:10:10` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `11:10:10` The agent VM's lamaste-agent has the apphost command  
ℹ️ `11:10:10` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  
✅ `11:10:11` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `11:10:11` testuser has a directory id (355c0187-bb20-498c-bed5-f85644febbec)  

## Entitled before it is hosted; the moment it is ready, its projection holds them

✅ `11:12:14` Fixture built: @lamalibre/e2e-ledger-server (identity: viewer, editor; displayName, email) and its agent package  
✅ `11:12:35` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-ledger-server, @lamalibre/e2e-ledger-agent )  
✅ `11:12:35` The agent VM reaches it at http://10.13.37.1:4874  
✅ `11:12:37` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T11:12:37.904Z"})  
✅ `11:12:38` …through its own OIDC client  
✅ `11:12:39` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `11:12:41` User e2e41-carol created  
✅ `11:12:41` …with a directory id (a4173ae5-6aea-440a-8290-10f6491754d0)  
✅ `11:12:47` Installed @lamalibre/e2e-ledger-server@1.0.0, which declares identity; approved  
✅ `11:12:48` e2e41-carol entitled as viewer, before the plugin is hosted  
✅ `11:12:48` testuser entitled as viewer, before the plugin is hosted  
✅ `11:12:59` Hosted on test-agent ()  
✅ `11:12:59` The agent half answers through the tunnel (its data: instance fe0e3d599018b4d4)  
✅ `11:13:16` The relay's health of the hosting is up  
✅ `11:13:16` Ready: its agent half's first complete sync ended at the head of the audience  
✅ `11:13:21` 1.0.0 is ready, nothing behind  
✅ `11:13:27` The projection already holds e2e41-carol: active, viewer  
✅ `11:13:27` …and testuser  

## Uninstalled without purge: the data stays on the agent

✅ `11:13:37` Uninstalled without purge ()  
✅ `11:13:37` The plugin is gone from the relay  
✅ `11:13:37` GET /api/plugins/e2e-ledger/retained-data: test-agent keeps its agent half's data  
✅ `11:13:37` The projection in that data holds e2e41-carol, active  

## Deleted and erased while no agent half runs: the erasure waits for the kept data

✅ `11:13:38` e2e41-carol deleted  
✅ `11:13:38` …and erased by their id  
✅ `11:13:38` The directory scrubbed the tombstone to the bare id  
✅ `11:13:38` The erasure is pending for e2e-ledger, uninstalled as it is: its ledger stayed with its data  
✅ `11:13:38` …marked inactive: no feed reaches the data until the plugin comes back  
✅ `11:13:38` The kept projection still holds e2e41-carol's name: nothing reached it yet  

## Installed and hosted again: the kept data taken back, the erasure replayed

✅ `11:13:43` @lamalibre/e2e-ledger-server@1.0.0 installed again, approved  
✅ `11:13:54` Hosted on test-agent again ()  
✅ `11:13:54` The agent half took back the data the uninstall kept (instance fe0e3d599018b4d4)  
✅ `11:13:54` …and the relay no longer records it as retained  
✅ `11:13:55` Ready again: the replay since the hosting reached the head  
✅ `11:13:55` Ready, the projection holds e2e41-carol as the bare id, erased: the replay delivered the erasure  
✅ `11:13:55` …erased at 2026-11-11T11:13:53.938Z  
✅ `11:13:55` …and the plugin's anonymiser (onErase) ran for them  
✅ `11:13:55` testuser is still a viewer: Gatekeeper's grants outlived the uninstall  
✅ `11:13:55` GET /api/plugins/e2e-ledger/identity: no erasure pending  
✅ `11:13:55` GET /api/identity/directory: none pending for e2e41-carol  

## An erasure is sticky: the relay's upsert never brings the user back

✅ `11:13:55` As lamaste-app-e2e-ledger: testuser's row scrubbed as an erasure leaves it — one the relay's ledger does not hold  
✅ `11:13:55` Reconcile 1: the relay's upsert of testuser contradicts the erasure — reported (1 mismatch)  
✅ `11:13:56` …the row stays the bare id, erased  
✅ `11:13:56` Reconcile 2: the relay's upsert of testuser contradicts the erasure — reported (1 mismatch)  
✅ `11:13:56` …the row stays the bare id, erased  
✅ `11:13:56` …and no hook ran for it (the plugin's anonymiser was never called for testuser)  

## Uninstalled with purge: no data left anywhere, the ledger goes

✅ `11:14:07` Uninstalled with purge ()  
✅ `11:14:07` The plugin is gone from the relay  
✅ `11:14:07` No agent keeps data of e2e-ledger  
✅ `11:14:07` …its data directory, the projection in it, and its account are gone from the agent VM  
✅ `11:14:08` The relay dropped the plugin's identity ledger (journal: Dropped the identity ledger of a plugin no agent keeps data of)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `11:14:08` Cleaning up test resources...  
