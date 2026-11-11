# Lamaste E2E: 57 — Web surface site grants (Three-VM)

> Started at `2026-11-10 19:22:06 UTC`


## Pre-flight

✅ `19:22:06` Onboarding is complete  
✅ `19:22:07` Agent test-agent is enrolled on the host  
✅ `19:22:07` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `19:22:07` The agent VM's lamaste-agent has the apphost command  
ℹ️ `19:22:07` Hosting agent: test-agent, relay domain test.lamaste.local, web surface e2e57web.test.lamaste.local  
✅ `19:22:07` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `19:22:08` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, users and a group; a restricted web surface, served

✅ `19:22:09` Fixture built: @lamalibre/e2e-sitegrant-server 1.0.0 with a web tree  
✅ `19:22:18` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-sitegrant-server, @lamalibre/e2e-sitegrant-agent )  
✅ `19:22:18` The agent VM reaches it at http://10.13.37.1:4874  
✅ `19:22:19` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T19:22:19.942Z"})  
✅ `19:22:19` …through its own OIDC client  
✅ `19:22:24` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `19:22:25` User e2e57-member created  
✅ `19:22:26` User e2e57-groupie created — to reach the plugin through a Lamaste group  
✅ `19:22:26` Lamaste group e2e57-team created  
✅ `19:22:26` …with e2e57-groupie in it  
✅ `19:22:30` Installed @lamalibre/e2e-sitegrant-server@1.0.0  
✅ `19:22:33` Its web surface created, restricted  
✅ `19:22:33` …on e2e57web.test.lamaste.local, with no grant  
✅ `19:22:33` Approved  
✅ `19:22:44` Hosted on test-agent ()  
✅ `19:22:44` Served: approved, hosted, its tree current  
✅ `19:22:45` Ready: its agent half's first complete sync ended at the head  

## Entitled, no site grant: the status names them, Gatekeeper refuses them

✅ `19:22:45` e2e57-member entitled as viewer  
✅ `19:22:45` Group e2e57-team entitled as viewer  
✅ `19:22:45` Both are active members of the audience  
✅ `19:22:45` GET /api/plugins/e2e-sitegrant/web-surface: no grant on the site  
✅ `19:22:46` …membersWithoutGrant names both, by username  
✅ `19:22:46` …each with their directory id  
✅ `19:23:03` e2e57-member signed in from the visitor VM  
✅ `19:23:05` e2e57-groupie signed in  
✅ `19:23:05` e2e57-member, entitled without a site grant: 403  
✅ `19:23:05` …the access-request page, never the shell  
✅ `19:23:05` e2e57-groupie, entitled through e2e57-team without a site grant: 403  

## The proxy refuses a grant on no site, and on a static site

✅ `19:23:05` A site grant naming no site: 400 unknown_site  
✅ `19:23:08` A static site e2e57static created  
✅ `19:23:08` A site grant on a static site: 400 site_not_grantable — its access is its allowed users  
✅ `19:23:09` …nothing reached Gatekeeper  
✅ `19:23:09` The static site deleted  

## Granted: the CLI to a user, the proxy to a group

✅ `19:23:09` lamaste-server plugins web-surface e2e-sitegrant grant --user e2e57-member  
✅ `19:23:09` e2e57-member reaches the shell (200)  
✅ `19:23:10` …index.html of the plugin's tree  
✅ `19:23:10` e2e57-groupie is still refused: the grant names e2e57-member alone  
✅ `19:23:10` The status lists the grant  
✅ `19:23:10` …and only e2e57-groupie without one  
✅ `19:23:10` A second grant to e2e57-member changes nothing (changed: false)  
✅ `19:23:11` POST /api/gatekeeper/grants: the site to group e2e57-team  
✅ `19:23:11` e2e57-groupie reaches the shell through e2e57-team (200)  
✅ `19:23:11` Nobody of the audience is without a grant  
✅ `19:23:11` lamaste-server plugins web-surface e2e-sitegrant grants --json  
✅ `19:23:11` Audited twice: plugin.web-surface.grant.created  
✅ `19:23:12` …the user by directory id, never by username  
✅ `19:23:12` …the group by name  

## Revoked: the CLI for the group, the bulk route for the user

✅ `19:23:12` lamaste-server plugins web-surface e2e-sitegrant revoke --group e2e57-team  
✅ `19:23:12` e2e57-groupie is refused again (403)  
✅ `19:23:12` e2e57-member keeps the site: their own grant  
✅ `19:23:13` The status names e2e57-groupie without a grant again  
✅ `19:23:13` Audited: plugin.web-surface.grant.revoked, the group  
✅ `19:23:13` Revoking a grant the group no longer holds: refused (no_grant)  
✅ `19:23:13` DELETE /api/gatekeeper/grants?principalType=user&principalId=e2e57-member: every grant of the user  
✅ `19:23:13` e2e57-member is refused (403)  
✅ `19:23:14` Audited: the site grant among them, by directory id  
✅ `19:23:14` No grant left on the site  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `63` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `63` |

ℹ️ `19:23:14` Cleaning up test resources...  
