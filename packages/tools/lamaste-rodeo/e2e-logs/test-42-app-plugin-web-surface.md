# Lamaste E2E: 42 — App plugin web surface (Three-VM)

> Started at `2026-11-10 18:36:45 UTC`


## Pre-flight

✅ `18:36:45` Onboarding is complete  
✅ `18:36:46` Agent test-agent is enrolled on the host  
✅ `18:36:46` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `18:36:46` The agent VM's lamaste-agent has the apphost command  
ℹ️ `18:36:46` Hosting agent: test-agent, relay domain test.lamaste.local, web surface e2e42web.test.lamaste.local  
✅ `18:36:46` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `18:36:47` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, the stand-in Feria, the users; the plugin installed, not approved

✅ `18:36:48` Fixture built: @lamalibre/e2e-websurf-server 1.0.0 with tree v1  
✅ `18:36:57` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-websurf-server, @lamalibre/e2e-websurf-agent )  
✅ `18:36:57` The agent VM reaches it at http://10.13.37.1:4874  
✅ `18:36:58` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T18:36:58.788Z"})  
✅ `18:36:58` …through its own OIDC client  
✅ `18:37:03` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `18:37:04` User e2e42-viewer created  
✅ `18:37:04` User e2e42-norole created — to hold no role in the plugin  
✅ `18:37:09` Installed @lamalibre/e2e-websurf-server@1.0.0  
✅ `18:37:09` Its web tree is part of what waits for approval — the digest of tree v1  
✅ `18:37:09` Not served, owns no site: not approved  
✅ `18:37:09` Offered: e2e42web, authenticated, free  
✅ `18:37:09` Nothing of it in the relay's tree store  

## Created: 503 until served; the sites API does not manage it

✅ `18:37:10` POST /api/plugins/e2e-websurf/web-surface  
✅ `18:37:10` …the site e2e42web.test.lamaste.local, authenticated  
✅ `18:37:11` A second one is refused (409 exists)  
✅ `18:37:11` Not approved yet: every request answered 503  
✅ `18:37:11` GET /api/sites lists it with its owner, not served  
✅ `18:37:11` PATCH /api/sites/6d3b15e3-556e-4ead-800c-fca18afef2a4: refused (409)  
✅ `18:37:11` Its files are not listed through the sites API (409)  
✅ `18:37:11` …nor is it deleted there (409)  

## Approved and hosted: the approved tree served

✅ `18:37:12` Approved: its agent half, identity block and web tree  
✅ `18:37:12` The approval served tree v1 from the store (current → its digest)  
✅ `18:37:23` Hosted on test-agent ()  
✅ `18:37:23` Served: approved, hosted, its tree current  
✅ `18:37:23` Ready: its agent half's first complete sync ended at the head  
✅ `18:37:23` Without a session: a page goes to the login  
✅ `18:37:23` …the sign-in portal, back to e2e42web.test.lamaste.local  
✅ `18:37:24` …the API on the same host: a JSON 401, never a redirect  
✅ `18:37:33` e2e42-viewer signed in from the visitor VM  
✅ `18:37:35` e2e42-norole signed in  
✅ `18:37:35` e2e42-norole, without a role in the plugin: 403  
✅ `18:37:35` …the access-request page  
✅ `18:37:35` …never the shell  
✅ `18:37:35` e2e42-viewer entitled as viewer  
✅ `18:37:35` …an active member of the audience  

## Signed in with a role: the shell and the API, one session

✅ `18:37:35` GET / as e2e42-viewer: index.html of tree v1  
✅ `18:37:35` …under the web surface's CSP: nothing from another origin, no inline script  
✅ `18:37:35` …revalidated on every load (no-cache)  
✅ `18:37:35` …never framed  
✅ `18:37:35` …no other host learns from it whether the viewer may use the plugin  
✅ `18:37:35` Its script app-v1.js: 200  
✅ `18:37:36` A deep link is answered with the shell (index.html)  
✅ `18:37:36` POST / to the shell: 405 — GET and HEAD only  
✅ `18:37:36` A service worker's script: 404 — never registered from a plugin's site  
✅ `18:37:36` The API as a script source: 403 — code comes from the approved tree only  
✅ `18:37:36` GET /api/e2e-websurf/app/echo on the same host, the same session: 200  
✅ `18:37:36` …the agent half sees the directory's user and roles  
✅ `18:37:36` …an API answer keeps the user surface's own headers (CSP sandbox)  
✅ `18:37:36` …not the shell's  

## Deleted: the site, its vhost and its trees go

✅ `18:37:36` DELETE /api/plugins/e2e-websurf/web-surface  
✅ `18:37:37` The site is gone from GET /api/sites  
✅ `18:37:37` Its tree store is gone  
✅ `18:37:37` Its vhost is gone  
✅ `18:37:37` Nothing of the shell answers on e2e42web.test.lamaste.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `61` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `61` |

ℹ️ `18:37:37` Cleaning up test resources...  
