# Lamaste E2E: 42 — App plugin web surface (Three-VM)

> Started at `2026-11-03 10:18:19 UTC`


## Pre-flight

✅ `10:18:19` Onboarding is complete  
✅ `10:18:19` Agent test-agent is enrolled on the host  
✅ `10:18:20` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:18:20` The agent VM's lamaste-agent has the apphost command  
ℹ️ `10:18:20` Hosting agent: test-agent, relay domain test.lamaste.local, web surface e2e42web.test.lamaste.local  
✅ `10:18:20` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `10:18:20` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, the stand-in Feria, the users; the plugin installed, not approved

✅ `10:18:21` Fixture built: @lamalibre/e2e-websurf-server 1.0.0 with tree v1  
✅ `10:18:29` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-websurf-server, @lamalibre/e2e-websurf-agent )  
✅ `10:18:29` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:18:31` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T10:18:31.039Z"})  
✅ `10:18:31` …through its own OIDC client  
✅ `10:18:31` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:18:32` User e2e42-viewer created  
✅ `10:18:33` User e2e42-norole created — to hold no role in the plugin  
✅ `10:18:37` Installed @lamalibre/e2e-websurf-server@1.0.0  
✅ `10:18:37` Its web tree is part of what waits for approval — the digest of tree v1  
✅ `10:18:37` Not served, owns no site: not approved  
✅ `10:18:37` Offered: e2e42web, authenticated, free  
✅ `10:18:37` Nothing of it in the relay's tree store  

## Created: 503 until served; the sites API does not manage it

✅ `10:18:38` POST /api/plugins/e2e-websurf/web-surface  
✅ `10:18:38` …the site e2e42web.test.lamaste.local, authenticated  
✅ `10:18:38` A second one is refused (409 exists)  
✅ `10:18:38` Not approved yet: every request answered 503  
✅ `10:18:38` GET /api/sites lists it with its owner, not served  
✅ `10:18:39` PATCH /api/sites/60ca7dc2-e63f-4532-8068-d22b11bc7740: refused (409)  
✅ `10:18:39` Its files are not listed through the sites API (409)  
✅ `10:18:39` …nor is it deleted there (409)  

## Approved and hosted: the approved tree served

✅ `10:18:39` Approved: its agent half, identity block and web tree  
✅ `10:18:39` The approval served tree v1 from the store (current → its digest)  
✅ `10:18:50` Hosted on test-agent ()  
✅ `10:18:50` Served: approved, hosted, its tree current  
✅ `10:18:50` Ready: its agent half's first complete sync ended at the head  
✅ `10:18:50` Without a session: a page goes to the login  
✅ `10:18:50` …the sign-in portal, back to e2e42web.test.lamaste.local  
✅ `10:18:50` …the API on the same host: a JSON 401, never a redirect  
✅ `10:19:02` e2e42-viewer signed in from the visitor VM  
✅ `10:19:04` e2e42-norole signed in  
✅ `10:19:04` e2e42-norole, without a role in the plugin: 403  
✅ `10:19:04` …the access-request page  
✅ `10:19:04` …never the shell  
✅ `10:19:04` e2e42-viewer entitled as viewer  
✅ `10:19:04` …an active member of the audience  

## Signed in with a role: the shell and the API, one session

✅ `10:19:04` GET / as e2e42-viewer: index.html of tree v1  
✅ `10:19:04` …under the web surface's CSP: nothing from another origin, no inline script  
✅ `10:19:04` …revalidated on every load (no-cache)  
✅ `10:19:04` …never framed  
✅ `10:19:04` …no other host learns from it whether the viewer may use the plugin  
✅ `10:19:04` Its script app-v1.js: 200  
✅ `10:19:04` A deep link is answered with the shell (index.html)  
✅ `10:19:05` POST / to the shell: 405 — GET and HEAD only  
✅ `10:19:05` A service worker's script: 404 — never registered from a plugin's site  
✅ `10:19:05` The API as a script source: 403 — code comes from the approved tree only  
✅ `10:19:05` GET /api/e2e-websurf/app/echo on the same host, the same session: 200  
✅ `10:19:05` …the agent half sees the directory's user and roles  
✅ `10:19:05` …an API answer keeps the user surface's own headers (CSP sandbox)  
✅ `10:19:05` …not the shell's  

## Deleted: the site, its vhost and its trees go

✅ `10:19:05` DELETE /api/plugins/e2e-websurf/web-surface  
✅ `10:19:05` The site is gone from GET /api/sites  
✅ `10:19:05` Its tree store is gone  
✅ `10:19:05` Its vhost is gone  
✅ `10:19:06` Nothing of the shell answers on e2e42web.test.lamaste.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `61` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `61` |

ℹ️ `10:19:06` Cleaning up test resources...  
