# Lamaste E2E: 41 — App plugin identity ledger across an uninstall (Three-VM)

> Started at `2026-11-10 18:33:16 UTC`


## Pre-flight

✅ `18:33:16` Onboarding is complete  
✅ `18:33:16` Agent test-agent is enrolled on the host  
✅ `18:33:17` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `18:33:17` The agent VM's lamaste-agent has the apphost command  
ℹ️ `18:33:17` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  
✅ `18:33:17` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `18:33:17` testuser has a directory id (2ffd9f57-e9f3-4f6f-a9ed-cdc01426ff28)  

## Entitled before it is hosted; the moment it is ready, its projection holds them

✅ `18:33:18` Fixture built: @lamalibre/e2e-ledger-server (identity: viewer, editor; displayName, email) and its agent package  
✅ `18:33:28` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-ledger-server, @lamalibre/e2e-ledger-agent )  
✅ `18:33:28` The agent VM reaches it at http://10.13.37.1:4874  
✅ `18:33:29` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T18:33:29.679Z"})  
✅ `18:33:29` …through its own OIDC client  
✅ `18:33:33` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `18:33:35` User e2e41-carol created  
✅ `18:33:35` …with a directory id (9cdc34c7-0ad3-4fb1-a99a-b26f73bffe8a)  
✅ `18:33:39` Installed @lamalibre/e2e-ledger-server@1.0.0, which declares identity; approved  
✅ `18:33:39` e2e41-carol entitled as viewer, before the plugin is hosted  
✅ `18:33:39` testuser entitled as viewer, before the plugin is hosted  
✅ `18:33:50` Hosted on test-agent ()  
✅ `18:33:50` The agent half answers through the tunnel (its data: instance 50e8b37f26df9ce0)  
✅ `18:34:00` The relay's health of the hosting is up  
✅ `18:34:00` Ready: its agent half's first complete sync ended at the head of the audience  
✅ `18:34:00` 1.0.0 is ready, nothing behind  
✅ `18:34:01` The projection already holds e2e41-carol: active, viewer  
✅ `18:34:01` …and testuser  

## Uninstalled without purge: the data stays on the agent

✅ `18:34:11` Uninstalled without purge ()  
✅ `18:34:11` The plugin is gone from the relay  
✅ `18:34:12` GET /api/plugins/e2e-ledger/retained-data: test-agent keeps its agent half's data  
✅ `18:34:12` The projection in that data holds e2e41-carol, active  

## Deleted and erased while no agent half runs: the erasure waits for the kept data

✅ `18:34:12` e2e41-carol deleted  
✅ `18:34:12` …and erased by their id  
✅ `18:34:12` The directory scrubbed the tombstone to the bare id  
✅ `18:34:13` The erasure is pending for e2e-ledger, uninstalled as it is: its ledger stayed with its data  
✅ `18:34:13` …marked inactive: no feed reaches the data until the plugin comes back  
✅ `18:34:13` The kept projection still holds e2e41-carol's name: nothing reached it yet  

## Installed and hosted again: the kept data taken back, the erasure replayed

✅ `18:34:17` @lamalibre/e2e-ledger-server@1.0.0 installed again, approved  
✅ `18:34:28` Hosted on test-agent again ()  
✅ `18:34:28` The agent half took back the data the uninstall kept (instance 50e8b37f26df9ce0)  
✅ `18:34:28` …and the relay no longer records it as retained  
✅ `18:34:28` Ready again: the replay since the hosting reached the head  
✅ `18:34:29` Ready, the projection holds e2e41-carol as the bare id, erased: the replay delivered the erasure  
✅ `18:34:29` …erased at 2026-11-10T18:34:28.059Z  
✅ `18:34:29` …and the plugin's anonymiser (onErase) ran for them  
✅ `18:34:29` testuser is still a viewer: Gatekeeper's grants outlived the uninstall  
✅ `18:34:29` GET /api/plugins/e2e-ledger/identity: no erasure pending  
✅ `18:34:29` GET /api/identity/directory: none pending for e2e41-carol  

## An erasure is sticky: the relay's upsert never brings the user back

✅ `18:34:29` As lamaste-app-e2e-ledger: testuser's row scrubbed as an erasure leaves it — one the relay's ledger does not hold  
✅ `18:34:29` Reconcile 1: the relay's upsert of testuser contradicts the erasure — reported (1 mismatch)  
✅ `18:34:29` …the row stays the bare id, erased  
✅ `18:34:30` Reconcile 2: the relay's upsert of testuser contradicts the erasure — reported (1 mismatch)  
✅ `18:34:30` …the row stays the bare id, erased  
✅ `18:34:30` …and no hook ran for it (the plugin's anonymiser was never called for testuser)  

## Uninstalled with purge: no data left anywhere, the ledger goes

✅ `18:34:41` Uninstalled with purge ()  
✅ `18:34:41` The plugin is gone from the relay  
✅ `18:34:41` No agent keeps data of e2e-ledger  
✅ `18:34:41` …its data directory, the projection in it, and its account are gone from the agent VM  
✅ `18:34:41` The relay dropped the plugin's identity ledger (journal: Dropped the identity ledger of a plugin no agent keeps data of)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `18:34:41` Cleaning up test resources...  
