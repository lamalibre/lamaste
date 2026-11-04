# Lamaste E2E: 57 — Web surface site grants (Three-VM)

> Started at `2026-11-04 15:04:56 UTC`


## Pre-flight

✅ `15:04:56` Onboarding is complete  
✅ `15:04:56` Agent test-agent is enrolled on the host  
✅ `15:04:57` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `15:04:57` The agent VM's lamaste-agent has the apphost command  
ℹ️ `15:04:57` Hosting agent: test-agent, relay domain test.lamaste.local, web surface e2e57web.test.lamaste.local  
✅ `15:04:57` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `15:04:57` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, users and a group; a restricted web surface, served

✅ `15:04:58` Fixture built: @lamalibre/e2e-sitegrant-server 1.0.0 with a web tree  
✅ `15:05:01` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-sitegrant-server, @lamalibre/e2e-sitegrant-agent )  
✅ `15:05:01` The agent VM reaches it at http://10.13.37.1:4874  
✅ `15:05:02` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T15:05:02.777Z"})  
✅ `15:05:02` …through its own OIDC client  
✅ `15:05:03` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `15:05:04` User e2e57-member created  
✅ `15:05:04` User e2e57-groupie created — to reach the plugin through a Lamaste group  
✅ `15:05:05` Lamaste group e2e57-team created  
✅ `15:05:05` …with e2e57-groupie in it  
✅ `15:05:06` Installed @lamalibre/e2e-sitegrant-server@1.0.0  
✅ `15:05:08` Its web surface created, restricted  
✅ `15:05:08` …on e2e57web.test.lamaste.local, with no grant  
✅ `15:05:08` Approved  
✅ `15:05:19` Hosted on test-agent ()  
✅ `15:05:19` Served: approved, hosted, its tree current  
✅ `15:05:19` Ready: its agent half's first complete sync ended at the head  

## Entitled, no site grant: the status names them, Gatekeeper refuses them

✅ `15:05:19` e2e57-member entitled as viewer  
✅ `15:05:19` Group e2e57-team entitled as viewer  
✅ `15:05:20` Both are active members of the audience  
✅ `15:05:20` GET /api/plugins/e2e-sitegrant/web-surface: no grant on the site  
✅ `15:05:20` …membersWithoutGrant names both, by username  
✅ `15:05:20` …each with their directory id  
✅ `15:05:33` e2e57-member signed in from the visitor VM  
✅ `15:05:35` e2e57-groupie signed in  
✅ `15:05:35` e2e57-member, entitled without a site grant: 403  
✅ `15:05:35` …the access-request page, never the shell  
✅ `15:05:35` e2e57-groupie, entitled through e2e57-team without a site grant: 403  

## The proxy refuses a grant on no site, and on a static site

✅ `15:05:35` A site grant naming no site: 400 unknown_site  
✅ `15:05:37` A static site e2e57static created  
✅ `15:05:37` A site grant on a static site: 400 site_not_grantable — its access is its allowed users  
✅ `15:05:37` …nothing reached Gatekeeper  
✅ `15:05:38` The static site deleted  

## Granted: the CLI to a user, the proxy to a group

✅ `15:05:38` lamaste-server plugins web-surface e2e-sitegrant grant --user e2e57-member  
✅ `15:05:38` e2e57-member reaches the shell (200)  
✅ `15:05:38` …index.html of the plugin's tree  
✅ `15:05:38` e2e57-groupie is still refused: the grant names e2e57-member alone  
✅ `15:05:38` The status lists the grant  
✅ `15:05:39` …and only e2e57-groupie without one  
✅ `15:05:39` A second grant to e2e57-member changes nothing (changed: false)  
✅ `15:05:39` POST /api/gatekeeper/grants: the site to group e2e57-team  
✅ `15:05:39` e2e57-groupie reaches the shell through e2e57-team (200)  
✅ `15:05:39` Nobody of the audience is without a grant  
✅ `15:05:39` lamaste-server plugins web-surface e2e-sitegrant grants --json  
✅ `15:05:40` Audited twice: plugin.web-surface.grant.created  
✅ `15:05:40` …the user by directory id, never by username  
✅ `15:05:40` …the group by name  

## Revoked: the CLI for the group, the bulk route for the user

✅ `15:05:40` lamaste-server plugins web-surface e2e-sitegrant revoke --group e2e57-team  
✅ `15:05:40` e2e57-groupie is refused again (403)  
✅ `15:05:40` e2e57-member keeps the site: their own grant  
✅ `15:05:41` The status names e2e57-groupie without a grant again  
✅ `15:05:41` Audited: plugin.web-surface.grant.revoked, the group  
✅ `15:05:41` Revoking a grant the group no longer holds: refused (no_grant)  
✅ `15:05:41` DELETE /api/gatekeeper/grants?principalType=user&principalId=e2e57-member: every grant of the user  
✅ `15:05:41` e2e57-member is refused (403)  
✅ `15:05:41` Audited: the site grant among them, by directory id  
✅ `15:05:41` No grant left on the site  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `63` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `63` |

ℹ️ `15:05:41` Cleaning up test resources...  
