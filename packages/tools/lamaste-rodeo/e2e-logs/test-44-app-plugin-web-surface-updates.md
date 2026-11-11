# Lamaste E2E: 44 — App plugin web surface: updates and a rollback (Three-VM)

> Started at `2026-11-11 11:17:53 UTC`


## Pre-flight

✅ `11:17:53` Onboarding is complete  
✅ `11:17:53` Agent test-agent is enrolled on the host  
✅ `11:17:54` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `11:17:54` The agent VM's lamaste-agent has the apphost command  
ℹ️ `11:17:54` Hosting agent: test-agent, relay domain test.lamaste.local, web surface e2e44web.test.lamaste.local  
✅ `11:17:54` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `11:17:54` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures; the site created, the plugin approved and hosted; the viewer signed in

✅ `11:17:56` Fixtures built: @lamalibre/e2e-webupd-server 1.0.0, 1.1.0, 1.2.0 (a bad release) with trees v1, v2, v3  
✅ `11:18:18` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-webupd-server, @lamalibre/e2e-webupd-agent )  
✅ `11:18:18` The agent VM reaches it at http://10.13.37.1:4874  
✅ `11:18:19` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T11:18:19.834Z"})  
✅ `11:18:19` …through its own OIDC client  
✅ `11:18:20` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `11:18:21` User e2e44-viewer created  
✅ `11:18:26` Installed @lamalibre/e2e-webupd-server@1.0.0  
✅ `11:18:29` POST /api/plugins/e2e-webupd/web-surface: the site e2e44web.test.lamaste.local  
✅ `11:18:29` Approved: its agent half, identity block and web tree  
✅ `11:18:41` Hosted on test-agent ()  
✅ `11:18:41` Served: approved, hosted, tree v1 current  
✅ `11:18:41` The store: current → tree v1, the only tree  
✅ `11:18:41` e2e44-viewer entitled as viewer  
✅ `11:18:41` …an active member of the audience  
✅ `11:19:03` e2e44-viewer signed in from the visitor VM  
✅ `11:19:03` GET / as e2e44-viewer: index.html of tree v1  

## Update to 1.1.0: the paths it changes shown, tree v2 approved with it, v1 kept as previous

✅ `11:19:11` The update waited for approval, showing tree v1 → v2 (5 files)  
✅ `11:19:11` …by path: added, removed, changed  
✅ `11:19:11` …and the page it adds among those to look at closely  
✅ `11:19:11` The update succeeded ()  
✅ `11:19:11` current → tree v2, previous → tree v1  
✅ `11:19:11` GET /: index.html of tree v2  
✅ `11:19:11` A script of tree v2: 200  
✅ `11:19:12` A script only tree v1 has is still served — from the previous tree  
✅ `11:19:12` A page only tree v1 has is not served from the previous tree…  
✅ `11:19:12` …the path gets the current shell  
✅ `11:19:12` Served; the approved tree is v2  

## Update to 1.2.0 rolled back: its tree never served

✅ `11:19:27` 1.2.0 waited for approval with tree v3  
✅ `11:19:27` The update was rolled back (agent install:post-tunnel refused: e2e: release 1.2.0 refuses install:post-tunnel)  
✅ `11:19:27` The plugin is 1.1.0 again  
✅ `11:19:28` current still tree v2, previous v1; tree v3 never entered the store  
✅ `11:19:28` GET /: still tree v2  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `39` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `39` |

ℹ️ `11:19:28` Cleaning up test resources...  
