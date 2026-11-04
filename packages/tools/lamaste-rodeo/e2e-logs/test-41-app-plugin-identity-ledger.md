# Lamaste E2E: 41 — App plugin identity ledger across an uninstall (Three-VM)

> Started at `2026-11-04 14:18:47 UTC`


## Pre-flight

✅ `14:18:48` Onboarding is complete  
✅ `14:18:48` Agent test-agent is enrolled on the host  
✅ `14:18:48` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:18:48` The agent VM's lamaste-agent has the apphost command  
ℹ️ `14:18:48` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  
✅ `14:18:48` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `14:18:49` testuser has a directory id (1147b52f-3100-420a-9e0c-15ca839e1edf)  

## Entitled before it is hosted; the moment it is ready, its projection holds them

✅ `14:18:50` Fixture built: @lamalibre/e2e-ledger-server (identity: viewer, editor; displayName, email) and its agent package  
✅ `14:18:53` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-ledger-server, @lamalibre/e2e-ledger-agent )  
✅ `14:18:53` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:18:54` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T14:18:54.471Z"})  
✅ `14:18:54` …through its own OIDC client  
✅ `14:18:55` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:18:56` User e2e41-carol created  
✅ `14:18:56` …with a directory id (f904936d-110b-4598-bb55-99a3197af1f8)  
✅ `14:18:57` Installed @lamalibre/e2e-ledger-server@1.0.0, which declares identity; approved  
✅ `14:18:57` e2e41-carol entitled as viewer, before the plugin is hosted  
✅ `14:18:57` testuser entitled as viewer, before the plugin is hosted  
✅ `14:19:08` Hosted on test-agent ()  
✅ `14:19:08` The agent half answers through the tunnel (its data: instance 191f3f55e6f513b3)  
✅ `14:19:28` The relay's health of the hosting is up  
✅ `14:19:28` Ready: its agent half's first complete sync ended at the head of the audience  
✅ `14:19:28` 1.0.0 is ready, nothing behind  
✅ `14:19:28` The projection already holds e2e41-carol: active, viewer  
✅ `14:19:28` …and testuser  

## Uninstalled without purge: the data stays on the agent

✅ `14:19:36` Uninstalled without purge ()  
✅ `14:19:36` The plugin is gone from the relay  
✅ `14:19:36` GET /api/plugins/e2e-ledger/retained-data: test-agent keeps its agent half's data  
✅ `14:19:36` The projection in that data holds e2e41-carol, active  

## Deleted and erased while no agent half runs: the erasure waits for the kept data

✅ `14:19:36` e2e41-carol deleted  
✅ `14:19:37` …and erased by their id  
✅ `14:19:37` The directory scrubbed the tombstone to the bare id  
✅ `14:19:37` The erasure is pending for e2e-ledger, uninstalled as it is: its ledger stayed with its data  
✅ `14:19:37` …marked inactive: no feed reaches the data until the plugin comes back  
✅ `14:19:37` The kept projection still holds e2e41-carol's name: nothing reached it yet  

## Installed and hosted again: the kept data taken back, the erasure replayed

✅ `14:19:38` @lamalibre/e2e-ledger-server@1.0.0 installed again, approved  
✅ `14:19:49` Hosted on test-agent again ()  
✅ `14:19:49` The agent half took back the data the uninstall kept (instance 191f3f55e6f513b3)  
✅ `14:19:49` …and the relay no longer records it as retained  
✅ `14:19:49` Ready again: the replay since the hosting reached the head  
✅ `14:19:49` Ready, the projection holds e2e41-carol as the bare id, erased: the replay delivered the erasure  
✅ `14:19:49` …erased at 2026-11-04T14:19:48.623Z  
✅ `14:19:49` …and the plugin's anonymiser (onErase) ran for them  
✅ `14:19:49` testuser is still a viewer: Gatekeeper's grants outlived the uninstall  
✅ `14:19:50` GET /api/plugins/e2e-ledger/identity: no erasure pending  
✅ `14:19:50` GET /api/identity/directory: none pending for e2e41-carol  

## An erasure is sticky: the relay's upsert never brings the user back

✅ `14:19:50` As lamaste-app-e2e-ledger: testuser's row scrubbed as an erasure leaves it — one the relay's ledger does not hold  
✅ `14:19:50` Reconcile 1: the relay's upsert of testuser contradicts the erasure — reported (1 mismatch)  
✅ `14:19:50` …the row stays the bare id, erased  
✅ `14:19:50` Reconcile 2: the relay's upsert of testuser contradicts the erasure — reported (1 mismatch)  
✅ `14:19:50` …the row stays the bare id, erased  
✅ `14:19:50` …and no hook ran for it (the plugin's anonymiser was never called for testuser)  

## Uninstalled with purge: no data left anywhere, the ledger goes

✅ `14:19:58` Uninstalled with purge ()  
✅ `14:19:58` The plugin is gone from the relay  
✅ `14:19:58` No agent keeps data of e2e-ledger  
✅ `14:19:58` …its data directory, the projection in it, and its account are gone from the agent VM  
✅ `14:19:58` The relay dropped the plugin's identity ledger (journal: Dropped the identity ledger of a plugin no agent keeps data of)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `14:19:58` Cleaning up test resources...  
