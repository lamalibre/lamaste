# Lamaste E2E: 44 — App plugin web surface: updates and a rollback (Three-VM)

> Started at `2026-11-10 14:01:21 UTC`


## Pre-flight

✅ `14:01:21` Onboarding is complete  
✅ `14:01:21` Agent test-agent is enrolled on the host  
✅ `14:01:21` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:01:22` The agent VM's lamaste-agent has the apphost command  
ℹ️ `14:01:22` Hosting agent: test-agent, relay domain test.lamaste.local, web surface e2e44web.test.lamaste.local  
✅ `14:01:22` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `14:01:22` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures; the site created, the plugin approved and hosted; the viewer signed in

✅ `14:01:24` Fixtures built: @lamalibre/e2e-webupd-server 1.0.0, 1.1.0, 1.2.0 (a bad release) with trees v1, v2, v3  
✅ `14:01:46` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-webupd-server, @lamalibre/e2e-webupd-agent )  
✅ `14:01:46` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:01:47` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T14:01:47.367Z"})  
✅ `14:01:47` …through its own OIDC client  
✅ `14:01:51` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:01:53` User e2e44-viewer created  
✅ `14:01:57` Installed @lamalibre/e2e-webupd-server@1.0.0  
✅ `14:01:58` POST /api/plugins/e2e-webupd/web-surface: the site e2e44web.test.lamaste.local  
✅ `14:01:59` Approved: its agent half, identity block and web tree  
✅ `14:02:10` Hosted on test-agent ()  
✅ `14:02:10` Served: approved, hosted, tree v1 current  
✅ `14:02:11` The store: current → tree v1, the only tree  
✅ `14:02:11` e2e44-viewer entitled as viewer  
✅ `14:02:11` …an active member of the audience  
✅ `14:02:33` e2e44-viewer signed in from the visitor VM  
✅ `14:02:33` GET / as e2e44-viewer: index.html of tree v1  

## Update to 1.1.0: the paths it changes shown, tree v2 approved with it, v1 kept as previous

✅ `14:02:42` The update waited for approval, showing tree v1 → v2 (5 files)  
✅ `14:02:42` …by path: added, removed, changed  
✅ `14:02:42` …and the page it adds among those to look at closely  
✅ `14:02:42` The update succeeded ()  
✅ `14:02:42` current → tree v2, previous → tree v1  
✅ `14:02:42` GET /: index.html of tree v2  
✅ `14:02:43` A script of tree v2: 200  
✅ `14:02:43` A script only tree v1 has is still served — from the previous tree  
✅ `14:02:43` A page only tree v1 has is not served from the previous tree…  
✅ `14:02:43` …the path gets the current shell  
✅ `14:02:43` Served; the approved tree is v2  

## Update to 1.2.0 rolled back: its tree never served

✅ `14:02:58` 1.2.0 waited for approval with tree v3  
✅ `14:02:58` The update was rolled back (agent install:post-tunnel refused: e2e: release 1.2.0 refuses install:post-tunnel)  
✅ `14:02:58` The plugin is 1.1.0 again  
✅ `14:02:59` current still tree v2, previous v1; tree v3 never entered the store  
✅ `14:02:59` GET /: still tree v2  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `39` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `39` |

ℹ️ `14:02:59` Cleaning up test resources...  
