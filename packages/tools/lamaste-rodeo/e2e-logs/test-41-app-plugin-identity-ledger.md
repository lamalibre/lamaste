# Lamaste E2E: 41 — App plugin identity ledger across an uninstall (Three-VM)

> Started at `2026-11-09 13:26:37 UTC`


## Pre-flight

✅ `13:26:37` Onboarding is complete  
✅ `13:26:37` Agent test-agent is enrolled on the host  
✅ `13:26:38` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:26:38` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:26:38` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  
✅ `13:26:38` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `13:26:38` testuser has a directory id (a4ea9be9-a804-4853-bcab-a5f64ac9ee43)  

## Entitled before it is hosted; the moment it is ready, its projection holds them

✅ `13:26:39` Fixture built: @lamalibre/e2e-ledger-server (identity: viewer, editor; displayName, email) and its agent package  
✅ `13:26:47` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-ledger-server, @lamalibre/e2e-ledger-agent )  
✅ `13:26:48` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:26:49` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T13:26:49.184Z"})  
✅ `13:26:49` …through its own OIDC client  
✅ `13:26:49` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:26:50` User e2e41-carol created  
✅ `13:26:50` …with a directory id (93a8ec43-cfba-4ac5-a1bc-aae9d180f198)  
✅ `13:26:55` Installed @lamalibre/e2e-ledger-server@1.0.0, which declares identity; approved  
✅ `13:26:55` e2e41-carol entitled as viewer, before the plugin is hosted  
✅ `13:26:55` testuser entitled as viewer, before the plugin is hosted  
✅ `13:27:05` Hosted on test-agent ()  
✅ `13:27:05` The agent half answers through the tunnel (its data: instance 57fbd2e8541a23c9)  
✅ `13:27:25` The relay's health of the hosting is up  
✅ `13:27:25` Ready: its agent half's first complete sync ended at the head of the audience  
✅ `13:27:25` 1.0.0 is ready, nothing behind  
✅ `13:27:25` The projection already holds e2e41-carol: active, viewer  
✅ `13:27:25` …and testuser  

## Uninstalled without purge: the data stays on the agent

✅ `13:27:32` Uninstalled without purge ()  
✅ `13:27:32` The plugin is gone from the relay  
✅ `13:27:32` GET /api/plugins/e2e-ledger/retained-data: test-agent keeps its agent half's data  
✅ `13:27:33` The projection in that data holds e2e41-carol, active  

## Deleted and erased while no agent half runs: the erasure waits for the kept data

✅ `13:27:33` e2e41-carol deleted  
✅ `13:27:33` …and erased by their id  
✅ `13:27:33` The directory scrubbed the tombstone to the bare id  
✅ `13:27:33` The erasure is pending for e2e-ledger, uninstalled as it is: its ledger stayed with its data  
✅ `13:27:33` …marked inactive: no feed reaches the data until the plugin comes back  
✅ `13:27:33` The kept projection still holds e2e41-carol's name: nothing reached it yet  

## Installed and hosted again: the kept data taken back, the erasure replayed

✅ `13:27:37` @lamalibre/e2e-ledger-server@1.0.0 installed again, approved  
✅ `13:27:48` Hosted on test-agent again ()  
✅ `13:27:48` The agent half took back the data the uninstall kept (instance 57fbd2e8541a23c9)  
✅ `13:27:48` …and the relay no longer records it as retained  
✅ `13:27:48` Ready again: the replay since the hosting reached the head  
✅ `13:27:48` Ready, the projection holds e2e41-carol as the bare id, erased: the replay delivered the erasure  
✅ `13:27:48` …erased at 2026-11-09T13:27:47.980Z  
✅ `13:27:48` …and the plugin's anonymiser (onErase) ran for them  
✅ `13:27:48` testuser is still a viewer: Gatekeeper's grants outlived the uninstall  
✅ `13:27:48` GET /api/plugins/e2e-ledger/identity: no erasure pending  
✅ `13:27:49` GET /api/identity/directory: none pending for e2e41-carol  

## An erasure is sticky: the relay's upsert never brings the user back

✅ `13:27:49` As lamaste-app-e2e-ledger: testuser's row scrubbed as an erasure leaves it — one the relay's ledger does not hold  
✅ `13:27:49` Reconcile 1: the relay's upsert of testuser contradicts the erasure — reported (1 mismatch)  
✅ `13:27:49` …the row stays the bare id, erased  
✅ `13:27:49` Reconcile 2: the relay's upsert of testuser contradicts the erasure — reported (1 mismatch)  
✅ `13:27:49` …the row stays the bare id, erased  
✅ `13:27:49` …and no hook ran for it (the plugin's anonymiser was never called for testuser)  

## Uninstalled with purge: no data left anywhere, the ledger goes

✅ `13:27:56` Uninstalled with purge ()  
✅ `13:27:57` The plugin is gone from the relay  
✅ `13:27:57` No agent keeps data of e2e-ledger  
✅ `13:27:57` …its data directory, the projection in it, and its account are gone from the agent VM  
✅ `13:27:57` The relay dropped the plugin's identity ledger (journal: Dropped the identity ledger of a plugin no agent keeps data of)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `13:27:57` Cleaning up test resources...  
