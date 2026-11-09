# Lamaste E2E: 44 — App plugin web surface: updates and a rollback (Three-VM)

> Started at `2026-11-09 13:36:43 UTC`


## Pre-flight

✅ `13:36:43` Onboarding is complete  
✅ `13:36:43` Agent test-agent is enrolled on the host  
✅ `13:36:43` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:36:43` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:36:43` Hosting agent: test-agent, relay domain test.lamaste.local, web surface e2e44web.test.lamaste.local  
✅ `13:36:44` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `13:36:44` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures; the site created, the plugin approved and hosted; the viewer signed in

✅ `13:36:45` Fixtures built: @lamalibre/e2e-webupd-server 1.0.0, 1.1.0, 1.2.0 (a bad release) with trees v1, v2, v3  
✅ `13:37:06` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-webupd-server, @lamalibre/e2e-webupd-agent )  
✅ `13:37:06` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:37:07` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T13:37:07.918Z"})  
✅ `13:37:07` …through its own OIDC client  
✅ `13:37:11` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:37:12` User e2e44-viewer created  
✅ `13:37:16` Installed @lamalibre/e2e-webupd-server@1.0.0  
✅ `13:37:17` POST /api/plugins/e2e-webupd/web-surface: the site e2e44web.test.lamaste.local  
✅ `13:37:18` Approved: its agent half, identity block and web tree  
✅ `13:37:28` Hosted on test-agent ()  
✅ `13:37:28` Served: approved, hosted, tree v1 current  
✅ `13:37:28` The store: current → tree v1, the only tree  
✅ `13:37:28` e2e44-viewer entitled as viewer  
✅ `13:37:28` …an active member of the audience  
✅ `13:37:32` e2e44-viewer signed in from the visitor VM  
✅ `13:37:32` GET / as e2e44-viewer: index.html of tree v1  

## Update to 1.1.0: the paths it changes shown, tree v2 approved with it, v1 kept as previous

✅ `13:37:40` The update waited for approval, showing tree v1 → v2 (5 files)  
✅ `13:37:40` …by path: added, removed, changed  
✅ `13:37:40` …and the page it adds among those to look at closely  
✅ `13:37:40` The update succeeded ()  
✅ `13:37:40` current → tree v2, previous → tree v1  
✅ `13:37:40` GET /: index.html of tree v2  
✅ `13:37:40` A script of tree v2: 200  
✅ `13:37:40` A script only tree v1 has is still served — from the previous tree  
✅ `13:37:40` A page only tree v1 has is not served from the previous tree…  
✅ `13:37:40` …the path gets the current shell  
✅ `13:37:41` Served; the approved tree is v2  

## Update to 1.2.0 rolled back: its tree never served

✅ `13:37:55` 1.2.0 waited for approval with tree v3  
✅ `13:37:55` The update was rolled back (agent install:post-tunnel refused: e2e: release 1.2.0 refuses install:post-tunnel)  
✅ `13:37:55` The plugin is 1.1.0 again  
✅ `13:37:55` current still tree v2, previous v1; tree v3 never entered the store  
✅ `13:37:56` GET /: still tree v2  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `39` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `39` |

ℹ️ `13:37:56` Cleaning up test resources...  
