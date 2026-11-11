# Lamaste E2E: 51 — External members: a plugin's web surface and audience (Three-VM)

> Started at `2026-11-10 18:57:16 UTC`


## Pre-flight

✅ `18:57:17` Onboarding is complete  
✅ `18:57:17` Agent test-agent is enrolled on the host  
✅ `18:57:17` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `18:57:17` The agent VM's lamaste-agent has the apphost command  
✅ `18:57:17` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `18:57:18` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a member and an external member of B

✅ `18:57:19` Domain lamaste-second.local added (201)  
✅ `18:57:19` …pending until activated  
✅ `18:57:19` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `18:57:19` …the one required record is auth.lamaste-second.local  
✅ `18:57:20` lamaste-second.local is active  
✅ `18:57:21` User e2e51-member created, member of lamaste-second.local  
✅ `18:57:22` User e2e51-ext created, member of lamaste-second.local (external)  
✅ `18:57:22` e2e51-ext is an external member of B  

## The plugin installed, approved, hosted, moved to B

✅ `18:57:22` Fixture built: @lamalibre/e2e-xsurf-server (identity: viewer, editor; web surface e2e51web, tree v1)  
✅ `18:57:31` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xsurf-server, @lamalibre/e2e-xsurf-agent )  
✅ `18:57:32` The agent VM reaches it at http://10.13.37.1:4874  
✅ `18:57:33` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T18:57:33.252Z"})  
✅ `18:57:33` …through its own OIDC client  
✅ `18:57:37` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `18:57:42` Installed @lamalibre/e2e-xsurf-server@1.0.0  
✅ `18:57:43` Approved  
✅ `18:57:43` PUT /api/plugins/e2e-xsurf/domain {domain: B} (before any surface)  
✅ `18:57:43` …it belongs to B  
✅ `18:57:54` Hosted on test-agent ()  
✅ `18:58:11` The relay's health of the hosting is up  
✅ `18:58:11` Ready: its agent half's first complete sync ended at the head  

## Both entitled as viewers: an external member counts toward the audience

✅ `18:58:11` e2e51-member entitled as viewer  
✅ `18:58:11` e2e51-ext entitled as viewer  
✅ `18:58:12` The audience holds both, active, as viewers — e2e51-ext too  
✅ `18:58:12` …and the agent half's projection, pushed through the tunnel: the plugin knows e2e51-ext and their role  
✅ `18:58:12` …e2e51-ext: viewer  

## An authenticated web surface: the member, not the external member

✅ `18:58:14` POST /api/plugins/e2e-xsurf/web-surface {accessMode: authenticated}  
✅ `18:58:14` …the site e2e51web.lamaste-second.local, authenticated, on B  
✅ `18:58:14` …served  
✅ `18:58:17` e2e51-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:58:19` e2e51-ext signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:58:19` e2e51-member: the shell (tree v1)  
✅ `18:58:19` e2e51-member: the API, as the directory's user with the viewer role  
✅ `18:58:19` e2e51-ext, entitled, on the authenticated shell: 403  
✅ `18:58:19` …the access-request page  
✅ `18:58:19` …not the domain refusal  
✅ `18:58:19` …never a redirect to a sign-in page  
✅ `18:58:20` …never the shell  
✅ `18:58:20` e2e51-ext, entitled, on the authenticated surface: GET /api/e2e-xsurf/app/echo 403  
✅ `18:58:20` …JSON {error: forbidden} — granted access only, not 'not a member'  
✅ `18:58:20` …never a redirect  
✅ `18:58:20` users.yml names no host for e2e51-ext  

## A restricted web surface: the external member by the site's grant

✅ `18:58:22` POST /api/plugins/e2e-xsurf/web-surface {accessMode: restricted}  
✅ `18:58:22` …the site e2e51web.lamaste-second.local, restricted, on B  
✅ `18:58:22` …served  
✅ `18:58:23` e2e51-ext, without the site's grant, on the restricted shell: 403  
✅ `18:58:23` …the access-request page  
✅ `18:58:23` …not the domain refusal  
✅ `18:58:23` …never a redirect to a sign-in page  
✅ `18:58:23` e2e51-ext, without the site's grant: GET /api/e2e-xsurf/app/echo 403  
✅ `18:58:23` …JSON {error: forbidden} — granted access only, not 'not a member'  
✅ `18:58:23` …never a redirect  
✅ `18:58:23` e2e51-member, a member without the site's grant, on the restricted shell: 403 (restricted names everyone)  
✅ `18:58:23` Granted site b19ea541-c060-4b0f-878a-c8b6f1f1ed47 to user e2e51-ext  
✅ `18:58:23` users.yml gives e2e51-ext the site's hostname as a group  
✅ `18:58:23` e2e51-ext, granted: the shell — the same session  
✅ `18:58:24` e2e51-ext, granted: GET /api/e2e-xsurf/app/echo 200  
✅ `18:58:24` …the agent half sees the directory's user and their role  
✅ `18:58:24` The site's grant revoked  
✅ `18:58:24` users.yml takes the site's group from e2e51-ext  
✅ `18:58:24` e2e51-ext, the grant revoked: 403 on the shell  
✅ `18:58:24` e2e51-ext, the grant revoked: GET /api/e2e-xsurf/app/echo 403  
✅ `18:58:24` …JSON {error: forbidden} — granted access only, not 'not a member'  
✅ `18:58:24` …never a redirect  
✅ `18:58:24` Authelia was not restarted by the grant or its revocation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `71` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `71` |

ℹ️ `18:58:24` Cleaning up test resources...  
