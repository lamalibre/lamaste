# Lamaste E2E: 51 — External members: a plugin's web surface and audience (Three-VM)

> Started at `2026-11-10 14:14:11 UTC`


## Pre-flight

✅ `14:14:11` Onboarding is complete  
✅ `14:14:11` Agent test-agent is enrolled on the host  
✅ `14:14:12` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:14:12` The agent VM's lamaste-agent has the apphost command  
✅ `14:14:12` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `14:14:13` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a member and an external member of B

✅ `14:14:14` Domain lamaste-second.local added (201)  
✅ `14:14:14` …pending until activated  
✅ `14:14:14` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:14:14` …the one required record is auth.lamaste-second.local  
✅ `14:14:15` lamaste-second.local is active  
✅ `14:14:16` User e2e51-member created, member of lamaste-second.local  
✅ `14:14:17` User e2e51-ext created, member of lamaste-second.local (external)  
✅ `14:14:17` e2e51-ext is an external member of B  

## The plugin installed, approved, hosted, moved to B

✅ `14:14:18` Fixture built: @lamalibre/e2e-xsurf-server (identity: viewer, editor; web surface e2e51web, tree v1)  
✅ `14:14:27` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xsurf-server, @lamalibre/e2e-xsurf-agent )  
✅ `14:14:27` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:14:28` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T14:14:28.485Z"})  
✅ `14:14:28` …through its own OIDC client  
✅ `14:14:32` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:14:37` Installed @lamalibre/e2e-xsurf-server@1.0.0  
✅ `14:14:37` Approved  
✅ `14:14:38` PUT /api/plugins/e2e-xsurf/domain {domain: B} (before any surface)  
✅ `14:14:38` …it belongs to B  
✅ `14:14:48` Hosted on test-agent ()  
✅ `14:14:59` The relay's health of the hosting is up  
✅ `14:14:59` Ready: its agent half's first complete sync ended at the head  

## Both entitled as viewers: an external member counts toward the audience

✅ `14:14:59` e2e51-member entitled as viewer  
✅ `14:14:59` e2e51-ext entitled as viewer  
✅ `14:14:59` The audience holds both, active, as viewers — e2e51-ext too  
✅ `14:14:59` …and the agent half's projection, pushed through the tunnel: the plugin knows e2e51-ext and their role  
✅ `14:15:00` …e2e51-ext: viewer  

## An authenticated web surface: the member, not the external member

✅ `14:15:02` POST /api/plugins/e2e-xsurf/web-surface {accessMode: authenticated}  
✅ `14:15:02` …the site e2e51web.lamaste-second.local, authenticated, on B  
✅ `14:15:02` …served  
✅ `14:15:05` e2e51-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:15:07` e2e51-ext signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:15:07` e2e51-member: the shell (tree v1)  
✅ `14:15:07` e2e51-member: the API, as the directory's user with the viewer role  
✅ `14:15:07` e2e51-ext, entitled, on the authenticated shell: 403  
✅ `14:15:07` …the access-request page  
✅ `14:15:07` …not the domain refusal  
✅ `14:15:07` …never a redirect to a sign-in page  
✅ `14:15:07` …never the shell  
✅ `14:15:08` e2e51-ext, entitled, on the authenticated surface: GET /api/e2e-xsurf/app/echo 403  
✅ `14:15:08` …JSON {error: forbidden} — granted access only, not 'not a member'  
✅ `14:15:08` …never a redirect  
✅ `14:15:08` users.yml names no host for e2e51-ext  

## A restricted web surface: the external member by the site's grant

✅ `14:15:10` POST /api/plugins/e2e-xsurf/web-surface {accessMode: restricted}  
✅ `14:15:10` …the site e2e51web.lamaste-second.local, restricted, on B  
✅ `14:15:10` …served  
✅ `14:15:11` e2e51-ext, without the site's grant, on the restricted shell: 403  
✅ `14:15:11` …the access-request page  
✅ `14:15:11` …not the domain refusal  
✅ `14:15:11` …never a redirect to a sign-in page  
✅ `14:15:11` e2e51-ext, without the site's grant: GET /api/e2e-xsurf/app/echo 403  
✅ `14:15:11` …JSON {error: forbidden} — granted access only, not 'not a member'  
✅ `14:15:11` …never a redirect  
✅ `14:15:11` e2e51-member, a member without the site's grant, on the restricted shell: 403 (restricted names everyone)  
✅ `14:15:11` Granted site 226ab583-ff9e-4e5e-ae4e-f3aaa26ce4cd to user e2e51-ext  
✅ `14:15:11` users.yml gives e2e51-ext the site's hostname as a group  
✅ `14:15:11` e2e51-ext, granted: the shell — the same session  
✅ `14:15:11` e2e51-ext, granted: GET /api/e2e-xsurf/app/echo 200  
✅ `14:15:11` …the agent half sees the directory's user and their role  
✅ `14:15:12` The site's grant revoked  
✅ `14:15:12` users.yml takes the site's group from e2e51-ext  
✅ `14:15:12` e2e51-ext, the grant revoked: 403 on the shell  
✅ `14:15:12` e2e51-ext, the grant revoked: GET /api/e2e-xsurf/app/echo 403  
✅ `14:15:12` …JSON {error: forbidden} — granted access only, not 'not a member'  
✅ `14:15:12` …never a redirect  
✅ `14:15:12` Authelia was not restarted by the grant or its revocation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `71` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `71` |

ℹ️ `14:15:12` Cleaning up test resources...  
