# Lamaste E2E: 42 — App plugin web surface (Three-VM)

> Started at `2026-11-09 13:30:00 UTC`


## Pre-flight

✅ `13:30:00` Onboarding is complete  
✅ `13:30:00` Agent test-agent is enrolled on the host  
✅ `13:30:01` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:30:01` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:30:01` Hosting agent: test-agent, relay domain test.lamaste.local, web surface e2e42web.test.lamaste.local  
✅ `13:30:01` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `13:30:01` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, the stand-in Feria, the users; the plugin installed, not approved

✅ `13:30:02` Fixture built: @lamalibre/e2e-websurf-server 1.0.0 with tree v1  
✅ `13:30:10` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-websurf-server, @lamalibre/e2e-websurf-agent )  
✅ `13:30:10` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:30:11` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T13:30:11.580Z"})  
✅ `13:30:11` …through its own OIDC client  
✅ `13:30:12` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:30:13` User e2e42-viewer created  
✅ `13:30:13` User e2e42-norole created — to hold no role in the plugin  
✅ `13:30:17` Installed @lamalibre/e2e-websurf-server@1.0.0  
✅ `13:30:17` Its web tree is part of what waits for approval — the digest of tree v1  
✅ `13:30:18` Not served, owns no site: not approved  
✅ `13:30:18` Offered: e2e42web, authenticated, free  
✅ `13:30:18` Nothing of it in the relay's tree store  

## Created: 503 until served; the sites API does not manage it

✅ `13:30:19` POST /api/plugins/e2e-websurf/web-surface  
✅ `13:30:19` …the site e2e42web.test.lamaste.local, authenticated  
✅ `13:30:19` A second one is refused (409 exists)  
✅ `13:30:19` Not approved yet: every request answered 503  
✅ `13:30:19` GET /api/sites lists it with its owner, not served  
✅ `13:30:19` PATCH /api/sites/72cf0787-2730-4093-954f-fa071c7f274b: refused (409)  
✅ `13:30:19` Its files are not listed through the sites API (409)  
✅ `13:30:20` …nor is it deleted there (409)  

## Approved and hosted: the approved tree served

✅ `13:30:20` Approved: its agent half, identity block and web tree  
✅ `13:30:20` The approval served tree v1 from the store (current → its digest)  
✅ `13:30:30` Hosted on test-agent ()  
✅ `13:30:31` Served: approved, hosted, its tree current  
✅ `13:30:31` Ready: its agent half's first complete sync ended at the head  
✅ `13:30:31` Without a session: a page goes to the login  
✅ `13:30:31` …the sign-in portal, back to e2e42web.test.lamaste.local  
✅ `13:30:31` …the API on the same host: a JSON 401, never a redirect  
✅ `13:31:03` e2e42-viewer signed in from the visitor VM  
✅ `13:31:04` e2e42-norole signed in  
✅ `13:31:04` e2e42-norole, without a role in the plugin: 403  
✅ `13:31:04` …the access-request page  
✅ `13:31:04` …never the shell  
✅ `13:31:05` e2e42-viewer entitled as viewer  
✅ `13:31:05` …an active member of the audience  

## Signed in with a role: the shell and the API, one session

✅ `13:31:05` GET / as e2e42-viewer: index.html of tree v1  
✅ `13:31:05` …under the web surface's CSP: nothing from another origin, no inline script  
✅ `13:31:05` …revalidated on every load (no-cache)  
✅ `13:31:05` …never framed  
✅ `13:31:05` …no other host learns from it whether the viewer may use the plugin  
✅ `13:31:05` Its script app-v1.js: 200  
✅ `13:31:05` A deep link is answered with the shell (index.html)  
✅ `13:31:05` POST / to the shell: 405 — GET and HEAD only  
✅ `13:31:05` A service worker's script: 404 — never registered from a plugin's site  
✅ `13:31:05` The API as a script source: 403 — code comes from the approved tree only  
✅ `13:31:06` GET /api/e2e-websurf/app/echo on the same host, the same session: 200  
✅ `13:31:06` …the agent half sees the directory's user and roles  
✅ `13:31:06` …an API answer keeps the user surface's own headers (CSP sandbox)  
✅ `13:31:06` …not the shell's  

## Deleted: the site, its vhost and its trees go

✅ `13:31:06` DELETE /api/plugins/e2e-websurf/web-surface  
✅ `13:31:06` The site is gone from GET /api/sites  
✅ `13:31:06` Its tree store is gone  
✅ `13:31:06` Its vhost is gone  
✅ `13:31:06` Nothing of the shell answers on e2e42web.test.lamaste.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `61` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `61` |

ℹ️ `13:31:06` Cleaning up test resources...  
