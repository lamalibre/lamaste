# Lamaste E2E: 42 — App plugin web surface (Three-VM)

> Started at `2026-11-02 16:35:15 UTC`


## Pre-flight

✅ `16:35:15` Onboarding is complete  
✅ `16:35:15` Agent test-agent is enrolled on the host  
✅ `16:35:16` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `16:35:16` The agent VM's lamaste-agent has the apphost command  
ℹ️ `16:35:16` Hosting agent: test-agent, relay domain test.lamaste.local, web surface e2e42web.test.lamaste.local  
✅ `16:35:16` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `16:35:16` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, the stand-in Feria, the users; the plugin installed, not approved

✅ `16:35:17` Fixture built: @lamalibre/e2e-websurf-server 1.0.0 with tree v1  
✅ `16:35:19` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-websurf-server, @lamalibre/e2e-websurf-agent )  
✅ `16:35:19` The agent VM reaches it at http://10.13.37.1:4874  
✅ `16:35:21` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-02T16:35:21.429Z"})  
✅ `16:35:21` …through its own OIDC client  
✅ `16:35:21` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `16:35:22` User e2e42-viewer created  
✅ `16:35:23` User e2e42-norole created — to hold no role in the plugin  
✅ `16:35:25` Installed @lamalibre/e2e-websurf-server@1.0.0  
✅ `16:35:25` Its web tree is part of what waits for approval — the digest of tree v1  
✅ `16:35:25` Not served, owns no site: not approved  
✅ `16:35:25` Offered: e2e42web, authenticated, free  
✅ `16:35:25` Nothing of it in the relay's tree store  

## Created: 503 until served; the sites API does not manage it

✅ `16:35:26` POST /api/plugins/e2e-websurf/web-surface  
✅ `16:35:26` …the site e2e42web.test.lamaste.local, authenticated  
✅ `16:35:26` A second one is refused (409 exists)  
✅ `16:35:26` Not approved yet: every request answered 503  
✅ `16:35:27` GET /api/sites lists it with its owner, not served  
✅ `16:35:27` PATCH /api/sites/20f37325-a039-47ac-9a71-c24f2c80d5e9: refused (409)  
✅ `16:35:27` Its files are not listed through the sites API (409)  
✅ `16:35:27` …nor is it deleted there (409)  

## Approved and hosted: the approved tree served

✅ `16:35:27` Approved: its agent half, identity block and web tree  
✅ `16:35:27` The approval served tree v1 from the store (current → its digest)  
✅ `16:35:38` Hosted on test-agent ()  
✅ `16:35:38` Served: approved, hosted, its tree current  
✅ `16:35:38` Ready: its agent half's first complete sync ended at the head  
✅ `16:35:38` Without a session: a page goes to the login  
✅ `16:35:38` …the sign-in portal, back to e2e42web.test.lamaste.local  
✅ `16:35:38` …the API on the same host: a JSON 401, never a redirect  
✅ `16:36:02` e2e42-viewer signed in from the visitor VM  
✅ `16:36:04` e2e42-norole signed in  
✅ `16:36:04` e2e42-norole, without a role in the plugin: 403  
✅ `16:36:04` …the access-request page  
✅ `16:36:04` …never the shell  
✅ `16:36:04` e2e42-viewer entitled as viewer  
✅ `16:36:04` …an active member of the audience  

## Signed in with a role: the shell and the API, one session

✅ `16:36:04` GET / as e2e42-viewer: index.html of tree v1  
✅ `16:36:04` …under the web surface's CSP: nothing from another origin, no inline script  
✅ `16:36:04` …revalidated on every load (no-cache)  
✅ `16:36:04` …never framed  
✅ `16:36:04` …no other host learns from it whether the viewer may use the plugin  
✅ `16:36:04` Its script app-v1.js: 200  
✅ `16:36:04` A deep link is answered with the shell (index.html)  
✅ `16:36:05` POST / to the shell: 405 — GET and HEAD only  
✅ `16:36:05` A service worker's script: 404 — never registered from a plugin's site  
✅ `16:36:05` The API as a script source: 403 — code comes from the approved tree only  
✅ `16:36:05` GET /api/e2e-websurf/app/echo on the same host, the same session: 200  
✅ `16:36:05` …the agent half sees the directory's user and roles  
✅ `16:36:05` …an API answer keeps the user surface's own headers (CSP sandbox)  
✅ `16:36:05` …not the shell's  

## Deleted: the site, its vhost and its trees go

✅ `16:36:05` DELETE /api/plugins/e2e-websurf/web-surface  
✅ `16:36:05` The site is gone from GET /api/sites  
✅ `16:36:05` Its tree store is gone  
✅ `16:36:05` Its vhost is gone  
✅ `16:36:06` Nothing of the shell answers on e2e42web.test.lamaste.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `61` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `61` |

ℹ️ `16:36:06` Cleaning up test resources...  
