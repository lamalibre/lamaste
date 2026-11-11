# Lamaste E2E: 57 — Web surface site grants (Three-VM)

> Started at `2026-11-11 10:18:06 UTC`


## Pre-flight

✅ `10:18:06` Onboarding is complete  
✅ `10:18:07` Agent test-agent is enrolled on the host  
✅ `10:18:07` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:18:07` The agent VM's lamaste-agent has the apphost command  
ℹ️ `10:18:07` Hosting agent: test-agent, relay domain test.lamaste.local, web surface e2e57web.test.lamaste.local  
✅ `10:18:08` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `10:18:08` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, users and a group; a restricted web surface, served

✅ `10:18:09` Fixture built: @lamalibre/e2e-sitegrant-server 1.0.0 with a web tree  
✅ `10:18:19` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-sitegrant-server, @lamalibre/e2e-sitegrant-agent )  
✅ `10:18:19` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:18:20` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T10:18:20.381Z"})  
✅ `10:18:20` …through its own OIDC client  
✅ `10:18:21` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:18:22` User e2e57-member created  
✅ `10:18:23` User e2e57-groupie created — to reach the plugin through a Lamaste group  
✅ `10:18:23` Lamaste group e2e57-team created  
✅ `10:18:23` …with e2e57-groupie in it  
✅ `10:18:28` Installed @lamalibre/e2e-sitegrant-server@1.0.0  
✅ `10:18:30` Its web surface created, restricted  
✅ `10:18:30` …on e2e57web.test.lamaste.local, with no grant  
✅ `10:18:31` Approved  
✅ `10:18:42` Hosted on test-agent ()  
✅ `10:18:42` Served: approved, hosted, its tree current  
✅ `10:18:42` Ready: its agent half's first complete sync ended at the head  

## Entitled, no site grant: the status names them, Gatekeeper refuses them

✅ `10:18:42` e2e57-member entitled as viewer  
✅ `10:18:42` Group e2e57-team entitled as viewer  
✅ `10:18:43` Both are active members of the audience  
✅ `10:18:43` GET /api/plugins/e2e-sitegrant/web-surface: no grant on the site  
✅ `10:18:43` …membersWithoutGrant names both, by username  
✅ `10:18:43` …each with their directory id  
✅ `10:19:03` e2e57-member signed in from the visitor VM  
✅ `10:19:04` e2e57-groupie signed in  
✅ `10:19:05` e2e57-member, entitled without a site grant: 403  
✅ `10:19:05` …the access-request page, never the shell  
✅ `10:19:05` e2e57-groupie, entitled through e2e57-team without a site grant: 403  

## The proxy refuses a grant on no site, and on a static site

✅ `10:19:05` A site grant naming no site: 400 unknown_site  
✅ `10:19:07` A static site e2e57static created  
✅ `10:19:08` A site grant on a static site: 400 site_not_grantable — its access is its allowed users  
✅ `10:19:08` …nothing reached Gatekeeper  
✅ `10:19:08` The static site deleted  

## Granted: the CLI to a user, the proxy to a group

✅ `10:19:08` lamaste-server plugins web-surface e2e-sitegrant grant --user e2e57-member  
✅ `10:19:09` e2e57-member reaches the shell (200)  
✅ `10:19:09` …index.html of the plugin's tree  
✅ `10:19:09` e2e57-groupie is still refused: the grant names e2e57-member alone  
✅ `10:19:09` The status lists the grant  
✅ `10:19:09` …and only e2e57-groupie without one  
✅ `10:19:10` A second grant to e2e57-member changes nothing (changed: false)  
✅ `10:19:10` POST /api/gatekeeper/grants: the site to group e2e57-team  
✅ `10:19:10` e2e57-groupie reaches the shell through e2e57-team (200)  
✅ `10:19:10` Nobody of the audience is without a grant  
✅ `10:19:11` lamaste-server plugins web-surface e2e-sitegrant grants --json  
✅ `10:19:11` Audited twice: plugin.web-surface.grant.created  
✅ `10:19:11` …the user by directory id, never by username  
✅ `10:19:11` …the group by name  

## Revoked: the CLI for the group, the bulk route for the user

✅ `10:19:11` lamaste-server plugins web-surface e2e-sitegrant revoke --group e2e57-team  
✅ `10:19:12` e2e57-groupie is refused again (403)  
✅ `10:19:12` e2e57-member keeps the site: their own grant  
✅ `10:19:12` The status names e2e57-groupie without a grant again  
✅ `10:19:12` Audited: plugin.web-surface.grant.revoked, the group  
✅ `10:19:12` Revoking a grant the group no longer holds: refused (no_grant)  
✅ `10:19:13` DELETE /api/gatekeeper/grants?principalType=user&principalId=e2e57-member: every grant of the user  
✅ `10:19:13` e2e57-member is refused (403)  
✅ `10:19:13` Audited: the site grant among them, by directory id  
✅ `10:19:13` No grant left on the site  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `63` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `63` |

ℹ️ `10:19:13` Cleaning up test resources...  
