# Lamaste E2E: 42 — App plugin web surface (Three-VM)

> Started at `2026-11-04 14:22:02 UTC`


## Pre-flight

✅ `14:22:02` Onboarding is complete  
✅ `14:22:02` Agent test-agent is enrolled on the host  
✅ `14:22:03` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:22:03` The agent VM's lamaste-agent has the apphost command  
ℹ️ `14:22:03` Hosting agent: test-agent, relay domain test.lamaste.local, web surface e2e42web.test.lamaste.local  
✅ `14:22:03` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `14:22:04` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, the stand-in Feria, the users; the plugin installed, not approved

✅ `14:22:05` Fixture built: @lamalibre/e2e-websurf-server 1.0.0 with tree v1  
✅ `14:22:13` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-websurf-server, @lamalibre/e2e-websurf-agent )  
✅ `14:22:15` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:22:19` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T14:22:19.330Z"})  
✅ `14:22:19` …through its own OIDC client  
✅ `14:22:24` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:22:25` User e2e42-viewer created  
✅ `14:22:26` User e2e42-norole created — to hold no role in the plugin  
✅ `14:22:27` Installed @lamalibre/e2e-websurf-server@1.0.0  
✅ `14:22:27` Its web tree is part of what waits for approval — the digest of tree v1  
✅ `14:22:27` Not served, owns no site: not approved  
✅ `14:22:27` Offered: e2e42web, authenticated, free  
✅ `14:22:27` Nothing of it in the relay's tree store  

## Created: 503 until served; the sites API does not manage it

✅ `14:22:29` POST /api/plugins/e2e-websurf/web-surface  
✅ `14:22:29` …the site e2e42web.test.lamaste.local, authenticated  
✅ `14:22:29` A second one is refused (409 exists)  
✅ `14:22:29` Not approved yet: every request answered 503  
✅ `14:22:29` GET /api/sites lists it with its owner, not served  
✅ `14:22:29` PATCH /api/sites/53bf2d62-01b9-4e32-b968-620069b727dc: refused (409)  
✅ `14:22:29` Its files are not listed through the sites API (409)  
✅ `14:22:29` …nor is it deleted there (409)  

## Approved and hosted: the approved tree served

✅ `14:22:30` Approved: its agent half, identity block and web tree  
✅ `14:22:30` The approval served tree v1 from the store (current → its digest)  
✅ `14:22:40` Hosted on test-agent ()  
✅ `14:22:40` Served: approved, hosted, its tree current  
✅ `14:22:41` Ready: its agent half's first complete sync ended at the head  
✅ `14:22:41` Without a session: a page goes to the login  
✅ `14:22:41` …the sign-in portal, back to e2e42web.test.lamaste.local  
✅ `14:22:41` …the API on the same host: a JSON 401, never a redirect  
✅ `14:23:03` e2e42-viewer signed in from the visitor VM  
✅ `14:23:05` e2e42-norole signed in  
✅ `14:23:05` e2e42-norole, without a role in the plugin: 403  
✅ `14:23:05` …the access-request page  
✅ `14:23:05` …never the shell  
✅ `14:23:05` e2e42-viewer entitled as viewer  
✅ `14:23:05` …an active member of the audience  

## Signed in with a role: the shell and the API, one session

✅ `14:23:05` GET / as e2e42-viewer: index.html of tree v1  
✅ `14:23:05` …under the web surface's CSP: nothing from another origin, no inline script  
✅ `14:23:05` …revalidated on every load (no-cache)  
✅ `14:23:05` …never framed  
✅ `14:23:05` …no other host learns from it whether the viewer may use the plugin  
✅ `14:23:06` Its script app-v1.js: 200  
✅ `14:23:06` A deep link is answered with the shell (index.html)  
✅ `14:23:06` POST / to the shell: 405 — GET and HEAD only  
✅ `14:23:06` A service worker's script: 404 — never registered from a plugin's site  
✅ `14:23:06` The API as a script source: 403 — code comes from the approved tree only  
✅ `14:23:06` GET /api/e2e-websurf/app/echo on the same host, the same session: 200  
✅ `14:23:06` …the agent half sees the directory's user and roles  
✅ `14:23:06` …an API answer keeps the user surface's own headers (CSP sandbox)  
✅ `14:23:06` …not the shell's  

## Deleted: the site, its vhost and its trees go

✅ `14:23:06` DELETE /api/plugins/e2e-websurf/web-surface  
✅ `14:23:07` The site is gone from GET /api/sites  
✅ `14:23:07` Its tree store is gone  
✅ `14:23:07` Its vhost is gone  
✅ `14:23:07` Nothing of the shell answers on e2e42web.test.lamaste.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `61` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `61` |

ℹ️ `14:23:07` Cleaning up test resources...  
