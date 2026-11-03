# Lamaste E2E: 51 — External members: a plugin's web surface and audience (Three-VM)

> Started at `2026-11-03 10:36:57 UTC`


## Pre-flight

✅ `10:36:57` Onboarding is complete  
✅ `10:36:57` Agent test-agent is enrolled on the host  
✅ `10:36:57` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:36:57` The agent VM's lamaste-agent has the apphost command  
✅ `10:36:57` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `10:36:57` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a member and an external member of B

✅ `10:36:58` Domain lamaste-second.local added (201)  
✅ `10:36:58` …pending until activated  
✅ `10:36:58` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `10:36:58` …the one required record is auth.lamaste-second.local  
✅ `10:36:59` lamaste-second.local is active  
✅ `10:37:00` User e2e51-member created, member of lamaste-second.local  
✅ `10:37:01` User e2e51-ext created, member of lamaste-second.local (external)  
✅ `10:37:01` e2e51-ext is an external member of B  

## The plugin installed, approved, hosted, moved to B

✅ `10:37:01` Fixture built: @lamalibre/e2e-xsurf-server (identity: viewer, editor; web surface e2e51web, tree v1)  
✅ `10:37:09` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xsurf-server, @lamalibre/e2e-xsurf-agent )  
✅ `10:37:09` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:37:10` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T10:37:10.743Z"})  
✅ `10:37:10` …through its own OIDC client  
✅ `10:37:14` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:37:19` Installed @lamalibre/e2e-xsurf-server@1.0.0  
✅ `10:37:20` Approved  
✅ `10:37:20` PUT /api/plugins/e2e-xsurf/domain {domain: B} (before any surface)  
✅ `10:37:20` …it belongs to B  
✅ `10:37:31` Hosted on test-agent ()  
✅ `10:37:44` The relay's health of the hosting is up  
✅ `10:37:44` Ready: its agent half's first complete sync ended at the head  

## Both entitled as viewers: an external member counts toward the audience

✅ `10:37:44` e2e51-member entitled as viewer  
✅ `10:37:44` e2e51-ext entitled as viewer  
✅ `10:37:45` The audience holds both, active, as viewers — e2e51-ext too  
✅ `10:37:45` …and the agent half's projection, pushed through the tunnel: the plugin knows e2e51-ext and their role  
✅ `10:37:45` …e2e51-ext: viewer  

## An authenticated web surface: the member, not the external member

✅ `10:37:47` POST /api/plugins/e2e-xsurf/web-surface {accessMode: authenticated}  
✅ `10:37:47` …the site e2e51web.lamaste-second.local, authenticated, on B  
✅ `10:37:47` …served  
✅ `10:37:49` e2e51-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:37:51` e2e51-ext signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:37:51` e2e51-member: the shell (tree v1)  
✅ `10:37:51` e2e51-member: the API, as the directory's user with the viewer role  
✅ `10:37:51` e2e51-ext, entitled, on the authenticated shell: 403  
✅ `10:37:51` …the access-request page  
✅ `10:37:51` …not the domain refusal  
✅ `10:37:51` …never a redirect to a sign-in page  
✅ `10:37:51` …never the shell  
✅ `10:37:51` e2e51-ext, entitled, on the authenticated surface: GET /api/e2e-xsurf/app/echo 403  
✅ `10:37:51` …JSON {error: forbidden} — granted access only, not 'not a member'  
✅ `10:37:51` …never a redirect  
✅ `10:37:52` users.yml names no host for e2e51-ext  

## A restricted web surface: the external member by the site's grant

✅ `10:37:53` POST /api/plugins/e2e-xsurf/web-surface {accessMode: restricted}  
✅ `10:37:53` …the site e2e51web.lamaste-second.local, restricted, on B  
✅ `10:37:54` …served  
✅ `10:37:54` e2e51-ext, without the site's grant, on the restricted shell: 403  
✅ `10:37:54` …the access-request page  
✅ `10:37:54` …not the domain refusal  
✅ `10:37:54` …never a redirect to a sign-in page  
✅ `10:37:54` e2e51-ext, without the site's grant: GET /api/e2e-xsurf/app/echo 403  
✅ `10:37:54` …JSON {error: forbidden} — granted access only, not 'not a member'  
✅ `10:37:54` …never a redirect  
✅ `10:37:54` e2e51-member, a member without the site's grant, on the restricted shell: 403 (restricted names everyone)  
✅ `10:37:54` Granted site e1e04fef-1f3b-4081-b7d6-9cf61c8ebd92 to user e2e51-ext  
✅ `10:37:54` users.yml gives e2e51-ext the site's hostname as a group  
✅ `10:37:54` e2e51-ext, granted: the shell — the same session  
✅ `10:37:55` e2e51-ext, granted: GET /api/e2e-xsurf/app/echo 200  
✅ `10:37:55` …the agent half sees the directory's user and their role  
✅ `10:37:55` The site's grant revoked  
✅ `10:37:55` users.yml takes the site's group from e2e51-ext  
✅ `10:37:55` e2e51-ext, the grant revoked: 403 on the shell  
✅ `10:37:55` e2e51-ext, the grant revoked: GET /api/e2e-xsurf/app/echo 403  
✅ `10:37:55` …JSON {error: forbidden} — granted access only, not 'not a member'  
✅ `10:37:55` …never a redirect  
✅ `10:37:55` Authelia was not restarted by the grant or its revocation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `71` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `71` |

ℹ️ `10:37:55` Cleaning up test resources...  
