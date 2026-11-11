# Lamaste E2E: 44 — App plugin web surface: updates and a rollback (Three-VM)

> Started at `2026-11-10 18:43:54 UTC`


## Pre-flight

✅ `18:43:54` Onboarding is complete  
✅ `18:43:54` Agent test-agent is enrolled on the host  
✅ `18:43:55` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `18:43:55` The agent VM's lamaste-agent has the apphost command  
ℹ️ `18:43:55` Hosting agent: test-agent, relay domain test.lamaste.local, web surface e2e44web.test.lamaste.local  
✅ `18:43:55` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `18:43:55` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures; the site created, the plugin approved and hosted; the viewer signed in

✅ `18:43:57` Fixtures built: @lamalibre/e2e-webupd-server 1.0.0, 1.1.0, 1.2.0 (a bad release) with trees v1, v2, v3  
✅ `18:44:19` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-webupd-server, @lamalibre/e2e-webupd-agent )  
✅ `18:44:20` The agent VM reaches it at http://10.13.37.1:4874  
✅ `18:44:21` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T18:44:21.292Z"})  
✅ `18:44:21` …through its own OIDC client  
✅ `18:44:25` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `18:44:26` User e2e44-viewer created  
✅ `18:44:31` Installed @lamalibre/e2e-webupd-server@1.0.0  
✅ `18:44:32` POST /api/plugins/e2e-webupd/web-surface: the site e2e44web.test.lamaste.local  
✅ `18:44:32` Approved: its agent half, identity block and web tree  
✅ `18:44:43` Hosted on test-agent ()  
✅ `18:44:43` Served: approved, hosted, tree v1 current  
✅ `18:44:44` The store: current → tree v1, the only tree  
✅ `18:44:44` e2e44-viewer entitled as viewer  
✅ `18:44:44` …an active member of the audience  
✅ `18:45:03` e2e44-viewer signed in from the visitor VM  
✅ `18:45:04` GET / as e2e44-viewer: index.html of tree v1  

## Update to 1.1.0: the paths it changes shown, tree v2 approved with it, v1 kept as previous

✅ `18:45:12` The update waited for approval, showing tree v1 → v2 (5 files)  
✅ `18:45:12` …by path: added, removed, changed  
✅ `18:45:12` …and the page it adds among those to look at closely  
✅ `18:45:12` The update succeeded ()  
✅ `18:45:12` current → tree v2, previous → tree v1  
✅ `18:45:13` GET /: index.html of tree v2  
✅ `18:45:13` A script of tree v2: 200  
✅ `18:45:13` A script only tree v1 has is still served — from the previous tree  
✅ `18:45:13` A page only tree v1 has is not served from the previous tree…  
✅ `18:45:13` …the path gets the current shell  
✅ `18:45:13` Served; the approved tree is v2  

## Update to 1.2.0 rolled back: its tree never served

✅ `18:45:28` 1.2.0 waited for approval with tree v3  
✅ `18:45:28` The update was rolled back (agent install:post-tunnel refused: e2e: release 1.2.0 refuses install:post-tunnel)  
✅ `18:45:28` The plugin is 1.1.0 again  
✅ `18:45:29` current still tree v2, previous v1; tree v3 never entered the store  
✅ `18:45:29` GET /: still tree v2  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `39` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `39` |

ℹ️ `18:45:29` Cleaning up test resources...  
