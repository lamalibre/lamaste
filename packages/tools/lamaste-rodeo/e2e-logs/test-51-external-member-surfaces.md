# Lamaste E2E: 51 — External members: a plugin's web surface and audience (Three-VM)

> Started at `2026-11-11 11:27:11 UTC`


## Pre-flight

✅ `11:27:12` Onboarding is complete  
✅ `11:27:12` Agent test-agent is enrolled on the host  
✅ `11:27:12` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `11:27:13` The agent VM's lamaste-agent has the apphost command  
✅ `11:27:13` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `11:27:13` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a member and an external member of B

✅ `11:27:14` Domain lamaste-second.local added (201)  
✅ `11:27:14` …pending until activated  
✅ `11:27:14` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `11:27:14` …the one required record is auth.lamaste-second.local  
✅ `11:27:15` lamaste-second.local is active  
✅ `11:27:16` User e2e51-member created, member of lamaste-second.local  
✅ `11:27:17` User e2e51-ext created, member of lamaste-second.local (external)  
✅ `11:27:17` e2e51-ext is an external member of B  

## The plugin installed, approved, hosted, moved to B

✅ `11:27:17` Fixture built: @lamalibre/e2e-xsurf-server (identity: viewer, editor; web surface e2e51web, tree v1)  
✅ `11:27:26` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xsurf-server, @lamalibre/e2e-xsurf-agent )  
✅ `11:27:26` The agent VM reaches it at http://10.13.37.1:4874  
✅ `11:27:27` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T11:27:27.433Z"})  
✅ `11:27:27` …through its own OIDC client  
✅ `11:27:28` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `11:27:33` Installed @lamalibre/e2e-xsurf-server@1.0.0  
✅ `11:27:33` Approved  
✅ `11:27:33` PUT /api/plugins/e2e-xsurf/domain {domain: B} (before any surface)  
✅ `11:27:33` …it belongs to B  
✅ `11:27:44` Hosted on test-agent ()  
✅ `11:27:58` The relay's health of the hosting is up  
✅ `11:27:58` Ready: its agent half's first complete sync ended at the head  

## Both entitled as viewers: an external member counts toward the audience

✅ `11:27:58` e2e51-member entitled as viewer  
✅ `11:27:58` e2e51-ext entitled as viewer  
✅ `11:27:58` The audience holds both, active, as viewers — e2e51-ext too  
✅ `11:27:58` …and the agent half's projection, pushed through the tunnel: the plugin knows e2e51-ext and their role  
✅ `11:27:59` …e2e51-ext: viewer  

## An authenticated web surface: the member, not the external member

✅ `11:28:02` POST /api/plugins/e2e-xsurf/web-surface {accessMode: authenticated}  
✅ `11:28:02` …the site e2e51web.lamaste-second.local, authenticated, on B  
✅ `11:28:02` …served  
✅ `11:28:05` e2e51-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `11:28:07` e2e51-ext signed in at auth.lamaste-second.local (password, TOTP)  
✅ `11:28:07` e2e51-member: the shell (tree v1)  
✅ `11:28:07` e2e51-member: the API, as the directory's user with the viewer role  
✅ `11:28:08` e2e51-ext, entitled, on the authenticated shell: 403  
✅ `11:28:08` …the access-request page  
✅ `11:28:08` …not the domain refusal  
✅ `11:28:08` …never a redirect to a sign-in page  
✅ `11:28:08` …never the shell  
✅ `11:28:08` e2e51-ext, entitled, on the authenticated surface: GET /api/e2e-xsurf/app/echo 403  
✅ `11:28:08` …JSON {error: forbidden} — granted access only, not 'not a member'  
✅ `11:28:08` …never a redirect  
✅ `11:28:08` users.yml names no host for e2e51-ext  

## A restricted web surface: the external member by the site's grant

✅ `11:28:11` POST /api/plugins/e2e-xsurf/web-surface {accessMode: restricted}  
✅ `11:28:11` …the site e2e51web.lamaste-second.local, restricted, on B  
✅ `11:28:12` …served  
✅ `11:28:12` e2e51-ext, without the site's grant, on the restricted shell: 403  
✅ `11:28:12` …the access-request page  
✅ `11:28:12` …not the domain refusal  
✅ `11:28:12` …never a redirect to a sign-in page  
✅ `11:28:12` e2e51-ext, without the site's grant: GET /api/e2e-xsurf/app/echo 403  
✅ `11:28:12` …JSON {error: forbidden} — granted access only, not 'not a member'  
✅ `11:28:12` …never a redirect  
✅ `11:28:12` e2e51-member, a member without the site's grant, on the restricted shell: 403 (restricted names everyone)  
✅ `11:28:12` Granted site f138a402-d44c-4291-aa29-4e24c9804607 to user e2e51-ext  
✅ `11:28:12` users.yml gives e2e51-ext the site's hostname as a group  
✅ `11:28:13` e2e51-ext, granted: the shell — the same session  
✅ `11:28:13` e2e51-ext, granted: GET /api/e2e-xsurf/app/echo 200  
✅ `11:28:13` …the agent half sees the directory's user and their role  
✅ `11:28:13` The site's grant revoked  
✅ `11:28:13` users.yml takes the site's group from e2e51-ext  
✅ `11:28:13` e2e51-ext, the grant revoked: 403 on the shell  
✅ `11:28:13` e2e51-ext, the grant revoked: GET /api/e2e-xsurf/app/echo 403  
✅ `11:28:13` …JSON {error: forbidden} — granted access only, not 'not a member'  
✅ `11:28:13` …never a redirect  
✅ `11:28:13` Authelia was not restarted by the grant or its revocation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `71` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `71` |

ℹ️ `11:28:13` Cleaning up test resources...  
