# Lamaste E2E: 42 — App plugin web surface (Three-VM)

> Started at `2026-11-11 11:14:11 UTC`


## Pre-flight

✅ `11:14:11` Onboarding is complete  
✅ `11:14:11` Agent test-agent is enrolled on the host  
✅ `11:14:12` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `11:14:12` The agent VM's lamaste-agent has the apphost command  
ℹ️ `11:14:12` Hosting agent: test-agent, relay domain test.lamaste.local, web surface e2e42web.test.lamaste.local  
✅ `11:14:12` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `11:14:12` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, the stand-in Feria, the users; the plugin installed, not approved

✅ `11:14:13` Fixture built: @lamalibre/e2e-websurf-server 1.0.0 with tree v1  
✅ `11:14:23` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-websurf-server, @lamalibre/e2e-websurf-agent )  
✅ `11:14:23` The agent VM reaches it at http://10.13.37.1:4874  
✅ `11:14:24` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T11:14:24.518Z"})  
✅ `11:14:24` …through its own OIDC client  
✅ `11:14:25` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `11:14:26` User e2e42-viewer created  
✅ `11:14:27` User e2e42-norole created — to hold no role in the plugin  
✅ `11:14:31` Installed @lamalibre/e2e-websurf-server@1.0.0  
✅ `11:14:31` Its web tree is part of what waits for approval — the digest of tree v1  
✅ `11:14:31` Not served, owns no site: not approved  
✅ `11:14:31` Offered: e2e42web, authenticated, free  
✅ `11:14:31` Nothing of it in the relay's tree store  

## Created: 503 until served; the sites API does not manage it

✅ `11:14:34` POST /api/plugins/e2e-websurf/web-surface  
✅ `11:14:34` …the site e2e42web.test.lamaste.local, authenticated  
✅ `11:14:34` A second one is refused (409 exists)  
✅ `11:14:35` Not approved yet: every request answered 503  
✅ `11:14:35` GET /api/sites lists it with its owner, not served  
✅ `11:14:35` PATCH /api/sites/332e249e-2d5f-4d54-b413-d4811f515c3d: refused (409)  
✅ `11:14:35` Its files are not listed through the sites API (409)  
✅ `11:14:35` …nor is it deleted there (409)  

## Approved and hosted: the approved tree served

✅ `11:14:36` Approved: its agent half, identity block and web tree  
✅ `11:14:36` The approval served tree v1 from the store (current → its digest)  
✅ `11:14:47` Hosted on test-agent ()  
✅ `11:14:47` Served: approved, hosted, its tree current  
✅ `11:14:48` Ready: its agent half's first complete sync ended at the head  
✅ `11:14:48` Without a session: a page goes to the login  
✅ `11:14:48` …the sign-in portal, back to e2e42web.test.lamaste.local  
✅ `11:14:48` …the API on the same host: a JSON 401, never a redirect  
✅ `11:15:03` e2e42-viewer signed in from the visitor VM  
✅ `11:15:05` e2e42-norole signed in  
✅ `11:15:05` e2e42-norole, without a role in the plugin: 403  
✅ `11:15:05` …the access-request page  
✅ `11:15:05` …never the shell  
✅ `11:15:05` e2e42-viewer entitled as viewer  
✅ `11:15:05` …an active member of the audience  

## Signed in with a role: the shell and the API, one session

✅ `11:15:05` GET / as e2e42-viewer: index.html of tree v1  
✅ `11:15:06` …under the web surface's CSP: nothing from another origin, no inline script  
✅ `11:15:06` …revalidated on every load (no-cache)  
✅ `11:15:06` …never framed  
✅ `11:15:06` …no other host learns from it whether the viewer may use the plugin  
✅ `11:15:06` Its script app-v1.js: 200  
✅ `11:15:06` A deep link is answered with the shell (index.html)  
✅ `11:15:06` POST / to the shell: 405 — GET and HEAD only  
✅ `11:15:06` A service worker's script: 404 — never registered from a plugin's site  
✅ `11:15:06` The API as a script source: 403 — code comes from the approved tree only  
✅ `11:15:06` GET /api/e2e-websurf/app/echo on the same host, the same session: 200  
✅ `11:15:06` …the agent half sees the directory's user and roles  
✅ `11:15:06` …an API answer keeps the user surface's own headers (CSP sandbox)  
✅ `11:15:06` …not the shell's  

## Deleted: the site, its vhost and its trees go

✅ `11:15:07` DELETE /api/plugins/e2e-websurf/web-surface  
✅ `11:15:07` The site is gone from GET /api/sites  
✅ `11:15:07` Its tree store is gone  
✅ `11:15:07` Its vhost is gone  
✅ `11:15:07` Nothing of the shell answers on e2e42web.test.lamaste.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `61` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `61` |

ℹ️ `11:15:07` Cleaning up test resources...  
