# Lamaste E2E: 42 — App plugin web surface (Three-VM)

> Started at `2026-11-10 08:10:09 UTC`


## Pre-flight

✅ `08:10:09` Onboarding is complete  
✅ `08:10:10` Agent test-agent is enrolled on the host  
✅ `08:10:10` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `08:10:10` The agent VM's lamaste-agent has the apphost command  
ℹ️ `08:10:10` Hosting agent: test-agent, relay domain test.lamaste.local, web surface e2e42web.test.lamaste.local  
✅ `08:10:10` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `08:10:11` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, the stand-in Feria, the users; the plugin installed, not approved

✅ `08:10:12` Fixture built: @lamalibre/e2e-websurf-server 1.0.0 with tree v1  
✅ `08:10:21` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-websurf-server, @lamalibre/e2e-websurf-agent )  
✅ `08:10:21` The agent VM reaches it at http://10.13.37.1:4874  
✅ `08:10:22` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T08:10:22.752Z"})  
✅ `08:10:22` …through its own OIDC client  
✅ `08:10:27` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `08:10:28` User e2e42-viewer created  
✅ `08:10:29` User e2e42-norole created — to hold no role in the plugin  
✅ `08:10:33` Installed @lamalibre/e2e-websurf-server@1.0.0  
✅ `08:10:33` Its web tree is part of what waits for approval — the digest of tree v1  
✅ `08:10:33` Not served, owns no site: not approved  
✅ `08:10:33` Offered: e2e42web, authenticated, free  
✅ `08:10:33` Nothing of it in the relay's tree store  

## Created: 503 until served; the sites API does not manage it

✅ `08:10:34` POST /api/plugins/e2e-websurf/web-surface  
✅ `08:10:34` …the site e2e42web.test.lamaste.local, authenticated  
✅ `08:10:34` A second one is refused (409 exists)  
✅ `08:10:34` Not approved yet: every request answered 503  
✅ `08:10:35` GET /api/sites lists it with its owner, not served  
✅ `08:10:35` PATCH /api/sites/eb28bbc0-9841-4f3d-b08c-c7dd1601bc76: refused (409)  
✅ `08:10:35` Its files are not listed through the sites API (409)  
✅ `08:10:35` …nor is it deleted there (409)  

## Approved and hosted: the approved tree served

✅ `08:10:35` Approved: its agent half, identity block and web tree  
✅ `08:10:36` The approval served tree v1 from the store (current → its digest)  
✅ `08:10:47` Hosted on test-agent ()  
✅ `08:10:47` Served: approved, hosted, its tree current  
✅ `08:10:47` Ready: its agent half's first complete sync ended at the head  
✅ `08:10:47` Without a session: a page goes to the login  
✅ `08:10:47` …the sign-in portal, back to e2e42web.test.lamaste.local  
✅ `08:10:47` …the API on the same host: a JSON 401, never a redirect  
✅ `08:11:03` e2e42-viewer signed in from the visitor VM  
✅ `08:11:04` e2e42-norole signed in  
✅ `08:11:04` e2e42-norole, without a role in the plugin: 403  
✅ `08:11:04` …the access-request page  
✅ `08:11:04` …never the shell  
✅ `08:11:05` e2e42-viewer entitled as viewer  
✅ `08:11:05` …an active member of the audience  

## Signed in with a role: the shell and the API, one session

✅ `08:11:05` GET / as e2e42-viewer: index.html of tree v1  
✅ `08:11:05` …under the web surface's CSP: nothing from another origin, no inline script  
✅ `08:11:05` …revalidated on every load (no-cache)  
✅ `08:11:05` …never framed  
✅ `08:11:05` …no other host learns from it whether the viewer may use the plugin  
✅ `08:11:05` Its script app-v1.js: 200  
✅ `08:11:05` A deep link is answered with the shell (index.html)  
✅ `08:11:05` POST / to the shell: 405 — GET and HEAD only  
✅ `08:11:06` A service worker's script: 404 — never registered from a plugin's site  
✅ `08:11:06` The API as a script source: 403 — code comes from the approved tree only  
✅ `08:11:06` GET /api/e2e-websurf/app/echo on the same host, the same session: 200  
✅ `08:11:06` …the agent half sees the directory's user and roles  
✅ `08:11:06` …an API answer keeps the user surface's own headers (CSP sandbox)  
✅ `08:11:06` …not the shell's  

## Deleted: the site, its vhost and its trees go

✅ `08:11:06` DELETE /api/plugins/e2e-websurf/web-surface  
✅ `08:11:06` The site is gone from GET /api/sites  
✅ `08:11:07` Its tree store is gone  
✅ `08:11:07` Its vhost is gone  
✅ `08:11:07` Nothing of the shell answers on e2e42web.test.lamaste.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `61` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `61` |

ℹ️ `08:11:07` Cleaning up test resources...  
