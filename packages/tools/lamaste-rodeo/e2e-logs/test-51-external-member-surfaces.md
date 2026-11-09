# Lamaste E2E: 51 — External members: a plugin's web surface and audience (Three-VM)

> Started at `2026-11-09 13:48:17 UTC`


## Pre-flight

✅ `13:48:17` Onboarding is complete  
✅ `13:48:17` Agent test-agent is enrolled on the host  
✅ `13:48:18` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:48:18` The agent VM's lamaste-agent has the apphost command  
✅ `13:48:18` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `13:48:18` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a member and an external member of B

✅ `13:48:19` Domain lamaste-second.local added (201)  
✅ `13:48:19` …pending until activated  
✅ `13:48:19` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `13:48:19` …the one required record is auth.lamaste-second.local  
✅ `13:48:20` lamaste-second.local is active  
✅ `13:48:21` User e2e51-member created, member of lamaste-second.local  
✅ `13:48:21` User e2e51-ext created, member of lamaste-second.local (external)  
✅ `13:48:22` e2e51-ext is an external member of B  

## The plugin installed, approved, hosted, moved to B

✅ `13:48:22` Fixture built: @lamalibre/e2e-xsurf-server (identity: viewer, editor; web surface e2e51web, tree v1)  
✅ `13:48:30` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xsurf-server, @lamalibre/e2e-xsurf-agent )  
✅ `13:48:30` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:48:31` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T13:48:31.334Z"})  
✅ `13:48:31` …through its own OIDC client  
✅ `13:48:35` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:48:39` Installed @lamalibre/e2e-xsurf-server@1.0.0  
✅ `13:48:39` Approved  
✅ `13:48:39` PUT /api/plugins/e2e-xsurf/domain {domain: B} (before any surface)  
✅ `13:48:40` …it belongs to B  
✅ `13:48:50` Hosted on test-agent ()  
✅ `13:49:09` The relay's health of the hosting is up  
✅ `13:49:09` Ready: its agent half's first complete sync ended at the head  

## Both entitled as viewers: an external member counts toward the audience

✅ `13:49:09` e2e51-member entitled as viewer  
✅ `13:49:10` e2e51-ext entitled as viewer  
✅ `13:49:10` The audience holds both, active, as viewers — e2e51-ext too  
✅ `13:49:10` …and the agent half's projection, pushed through the tunnel: the plugin knows e2e51-ext and their role  
✅ `13:49:10` …e2e51-ext: viewer  

## An authenticated web surface: the member, not the external member

✅ `13:49:12` POST /api/plugins/e2e-xsurf/web-surface {accessMode: authenticated}  
✅ `13:49:12` …the site e2e51web.lamaste-second.local, authenticated, on B  
✅ `13:49:12` …served  
✅ `13:49:14` e2e51-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:49:15` e2e51-ext signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:49:16` e2e51-member: the shell (tree v1)  
✅ `13:49:16` e2e51-member: the API, as the directory's user with the viewer role  
✅ `13:49:16` e2e51-ext, entitled, on the authenticated shell: 403  
✅ `13:49:16` …the access-request page  
✅ `13:49:16` …not the domain refusal  
✅ `13:49:16` …never a redirect to a sign-in page  
✅ `13:49:16` …never the shell  
✅ `13:49:16` e2e51-ext, entitled, on the authenticated surface: GET /api/e2e-xsurf/app/echo 403  
✅ `13:49:16` …JSON {error: forbidden} — granted access only, not 'not a member'  
✅ `13:49:16` …never a redirect  
✅ `13:49:16` users.yml names no host for e2e51-ext  

## A restricted web surface: the external member by the site's grant

✅ `13:49:18` POST /api/plugins/e2e-xsurf/web-surface {accessMode: restricted}  
✅ `13:49:18` …the site e2e51web.lamaste-second.local, restricted, on B  
✅ `13:49:18` …served  
✅ `13:49:18` e2e51-ext, without the site's grant, on the restricted shell: 403  
✅ `13:49:18` …the access-request page  
✅ `13:49:18` …not the domain refusal  
✅ `13:49:18` …never a redirect to a sign-in page  
✅ `13:49:19` e2e51-ext, without the site's grant: GET /api/e2e-xsurf/app/echo 403  
✅ `13:49:19` …JSON {error: forbidden} — granted access only, not 'not a member'  
✅ `13:49:19` …never a redirect  
✅ `13:49:19` e2e51-member, a member without the site's grant, on the restricted shell: 403 (restricted names everyone)  
✅ `13:49:19` Granted site fda0cc77-3f5b-4692-8820-cedcd75ff9e6 to user e2e51-ext  
✅ `13:49:19` users.yml gives e2e51-ext the site's hostname as a group  
✅ `13:49:19` e2e51-ext, granted: the shell — the same session  
✅ `13:49:19` e2e51-ext, granted: GET /api/e2e-xsurf/app/echo 200  
✅ `13:49:19` …the agent half sees the directory's user and their role  
✅ `13:49:19` The site's grant revoked  
✅ `13:49:19` users.yml takes the site's group from e2e51-ext  
✅ `13:49:19` e2e51-ext, the grant revoked: 403 on the shell  
✅ `13:49:19` e2e51-ext, the grant revoked: GET /api/e2e-xsurf/app/echo 403  
✅ `13:49:20` …JSON {error: forbidden} — granted access only, not 'not a member'  
✅ `13:49:20` …never a redirect  
✅ `13:49:20` Authelia was not restarted by the grant or its revocation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `71` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `71` |

ℹ️ `13:49:20` Cleaning up test resources...  
