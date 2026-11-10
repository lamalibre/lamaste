# Lamaste E2E: 41 — App plugin identity ledger across an uninstall (Three-VM)

> Started at `2026-11-10 13:50:37 UTC`


## Pre-flight

✅ `13:50:37` Onboarding is complete  
✅ `13:50:37` Agent test-agent is enrolled on the host  
✅ `13:50:38` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:50:38` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:50:38` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  
✅ `13:50:38` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `13:50:38` testuser has a directory id (9145b465-0d30-4f0a-95d4-1a5407a52c18)  

## Entitled before it is hosted; the moment it is ready, its projection holds them

✅ `13:50:39` Fixture built: @lamalibre/e2e-ledger-server (identity: viewer, editor; displayName, email) and its agent package  
✅ `13:50:48` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-ledger-server, @lamalibre/e2e-ledger-agent )  
✅ `13:50:49` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:50:50` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T13:50:50.159Z"})  
✅ `13:50:50` …through its own OIDC client  
✅ `13:50:54` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:50:55` User e2e41-carol created  
✅ `13:50:55` …with a directory id (24a5b2a8-a219-4672-ade3-00e7c2eecbea)  
✅ `13:51:00` Installed @lamalibre/e2e-ledger-server@1.0.0, which declares identity; approved  
✅ `13:51:00` e2e41-carol entitled as viewer, before the plugin is hosted  
✅ `13:51:01` testuser entitled as viewer, before the plugin is hosted  
✅ `13:51:11` Hosted on test-agent ()  
✅ `13:51:11` The agent half answers through the tunnel (its data: instance f4bf3f1538ffc464)  
✅ `13:51:24` The relay's health of the hosting is up  
✅ `13:51:25` Ready: its agent half's first complete sync ended at the head of the audience  
✅ `13:51:25` 1.0.0 is ready, nothing behind  
✅ `13:51:25` The projection already holds e2e41-carol: active, viewer  
✅ `13:51:25` …and testuser  

## Uninstalled without purge: the data stays on the agent

✅ `13:51:33` Uninstalled without purge ()  
✅ `13:51:33` The plugin is gone from the relay  
✅ `13:51:33` GET /api/plugins/e2e-ledger/retained-data: test-agent keeps its agent half's data  
✅ `13:51:34` The projection in that data holds e2e41-carol, active  

## Deleted and erased while no agent half runs: the erasure waits for the kept data

✅ `13:51:34` e2e41-carol deleted  
✅ `13:51:35` …and erased by their id  
✅ `13:51:35` The directory scrubbed the tombstone to the bare id  
✅ `13:51:35` The erasure is pending for e2e-ledger, uninstalled as it is: its ledger stayed with its data  
✅ `13:51:35` …marked inactive: no feed reaches the data until the plugin comes back  
✅ `13:51:35` The kept projection still holds e2e41-carol's name: nothing reached it yet  

## Installed and hosted again: the kept data taken back, the erasure replayed

✅ `13:51:39` @lamalibre/e2e-ledger-server@1.0.0 installed again, approved  
✅ `13:51:50` Hosted on test-agent again ()  
✅ `13:51:50` The agent half took back the data the uninstall kept (instance f4bf3f1538ffc464)  
✅ `13:51:51` …and the relay no longer records it as retained  
✅ `13:51:51` Ready again: the replay since the hosting reached the head  
✅ `13:51:51` Ready, the projection holds e2e41-carol as the bare id, erased: the replay delivered the erasure  
✅ `13:51:51` …erased at 2026-11-10T13:51:50.288Z  
✅ `13:51:51` …and the plugin's anonymiser (onErase) ran for them  
✅ `13:51:51` testuser is still a viewer: Gatekeeper's grants outlived the uninstall  
✅ `13:51:51` GET /api/plugins/e2e-ledger/identity: no erasure pending  
✅ `13:51:51` GET /api/identity/directory: none pending for e2e41-carol  

## An erasure is sticky: the relay's upsert never brings the user back

✅ `13:51:51` As lamaste-app-e2e-ledger: testuser's row scrubbed as an erasure leaves it — one the relay's ledger does not hold  
✅ `13:51:52` Reconcile 1: the relay's upsert of testuser contradicts the erasure — reported (1 mismatch)  
✅ `13:51:52` …the row stays the bare id, erased  
✅ `13:51:52` Reconcile 2: the relay's upsert of testuser contradicts the erasure — reported (1 mismatch)  
✅ `13:51:52` …the row stays the bare id, erased  
✅ `13:51:52` …and no hook ran for it (the plugin's anonymiser was never called for testuser)  

## Uninstalled with purge: no data left anywhere, the ledger goes

✅ `13:52:00` Uninstalled with purge ()  
✅ `13:52:00` The plugin is gone from the relay  
✅ `13:52:00` No agent keeps data of e2e-ledger  
✅ `13:52:01` …its data directory, the projection in it, and its account are gone from the agent VM  
✅ `13:52:01` The relay dropped the plugin's identity ledger (journal: Dropped the identity ledger of a plugin no agent keeps data of)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `56` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `56` |

ℹ️ `13:52:01` Cleaning up test resources...  
