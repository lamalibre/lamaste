# Lamaste E2E: 44 — App plugin web surface: updates and a rollback (Three-VM)

> Started at `2026-11-02 16:41:46 UTC`


## Pre-flight

✅ `16:41:46` Onboarding is complete  
✅ `16:41:47` Agent test-agent is enrolled on the host  
✅ `16:41:47` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `16:41:47` The agent VM's lamaste-agent has the apphost command  
ℹ️ `16:41:47` Hosting agent: test-agent, relay domain test.lamaste.local, web surface e2e44web.test.lamaste.local  
✅ `16:41:47` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `16:41:47` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures; the site created, the plugin approved and hosted; the viewer signed in

✅ `16:41:48` Fixtures built: @lamalibre/e2e-webupd-server 1.0.0, 1.1.0, 1.2.0 (a bad release) with trees v1, v2, v3  
✅ `16:41:52` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-webupd-server, @lamalibre/e2e-webupd-agent )  
✅ `16:41:52` The agent VM reaches it at http://10.13.37.1:4874  
✅ `16:41:53` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-02T16:41:54.319Z"})  
✅ `16:41:53` …through its own OIDC client  
✅ `16:41:54` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `16:41:55` User e2e44-viewer created  
✅ `16:41:57` Installed @lamalibre/e2e-webupd-server@1.0.0  
✅ `16:41:58` POST /api/plugins/e2e-webupd/web-surface: the site e2e44web.test.lamaste.local  
✅ `16:41:59` Approved: its agent half, identity block and web tree  
✅ `16:42:09` Hosted on test-agent ()  
✅ `16:42:09` Served: approved, hosted, tree v1 current  
✅ `16:42:09` The store: current → tree v1, the only tree  
✅ `16:42:10` e2e44-viewer entitled as viewer  
✅ `16:42:10` …an active member of the audience  
✅ `16:42:33` e2e44-viewer signed in from the visitor VM  
✅ `16:42:33` GET / as e2e44-viewer: index.html of tree v1  

## Update to 1.1.0: the paths it changes shown, tree v2 approved with it, v1 kept as previous

✅ `16:42:37` The update waited for approval, showing tree v1 → v2 (5 files)  
✅ `16:42:37` …by path: added, removed, changed  
✅ `16:42:37` …and the page it adds among those to look at closely  
✅ `16:42:37` The update succeeded ()  
✅ `16:42:37` current → tree v2, previous → tree v1  
✅ `16:42:37` GET /: index.html of tree v2  
✅ `16:42:37` A script of tree v2: 200  
✅ `16:42:38` A script only tree v1 has is still served — from the previous tree  
✅ `16:42:38` A page only tree v1 has is not served from the previous tree…  
✅ `16:42:38` …the path gets the current shell  
✅ `16:42:38` Served; the approved tree is v2  

## Update to 1.2.0 rolled back: its tree never served

✅ `16:42:49` 1.2.0 waited for approval with tree v3  
✅ `16:42:49` The update was rolled back (agent install:post-tunnel refused: e2e: release 1.2.0 refuses install:post-tunnel)  
✅ `16:42:49` The plugin is 1.1.0 again  
✅ `16:42:50` current still tree v2, previous v1; tree v3 never entered the store  
✅ `16:42:50` GET /: still tree v2  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `39` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `39` |

ℹ️ `16:42:50` Cleaning up test resources...  
