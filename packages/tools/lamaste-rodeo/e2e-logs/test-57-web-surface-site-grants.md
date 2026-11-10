# Lamaste E2E: 57 — Web surface site grants (Three-VM)

> Started at `2026-11-10 14:38:26 UTC`


## Pre-flight

✅ `14:38:26` Onboarding is complete  
✅ `14:38:27` Agent test-agent is enrolled on the host  
✅ `14:38:27` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:38:27` The agent VM's lamaste-agent has the apphost command  
ℹ️ `14:38:27` Hosting agent: test-agent, relay domain test.lamaste.local, web surface e2e57web.test.lamaste.local  
✅ `14:38:27` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `14:38:28` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, users and a group; a restricted web surface, served

✅ `14:38:29` Fixture built: @lamalibre/e2e-sitegrant-server 1.0.0 with a web tree  
✅ `14:38:38` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-sitegrant-server, @lamalibre/e2e-sitegrant-agent )  
✅ `14:38:38` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:38:39` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T14:38:39.478Z"})  
✅ `14:38:39` …through its own OIDC client  
✅ `14:38:43` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:38:45` User e2e57-member created  
✅ `14:38:46` User e2e57-groupie created — to reach the plugin through a Lamaste group  
✅ `14:38:46` Lamaste group e2e57-team created  
✅ `14:38:46` …with e2e57-groupie in it  
✅ `14:38:50` Installed @lamalibre/e2e-sitegrant-server@1.0.0  
✅ `14:38:53` Its web surface created, restricted  
✅ `14:38:53` …on e2e57web.test.lamaste.local, with no grant  
✅ `14:38:53` Approved  
✅ `14:39:04` Hosted on test-agent ()  
✅ `14:39:04` Served: approved, hosted, its tree current  
✅ `14:39:04` Ready: its agent half's first complete sync ended at the head  

## Entitled, no site grant: the status names them, Gatekeeper refuses them

✅ `14:39:05` e2e57-member entitled as viewer  
✅ `14:39:05` Group e2e57-team entitled as viewer  
✅ `14:39:05` Both are active members of the audience  
✅ `14:39:05` GET /api/plugins/e2e-sitegrant/web-surface: no grant on the site  
✅ `14:39:05` …membersWithoutGrant names both, by username  
✅ `14:39:06` …each with their directory id  
✅ `14:39:33` e2e57-member signed in from the visitor VM  
✅ `14:39:35` e2e57-groupie signed in  
✅ `14:39:35` e2e57-member, entitled without a site grant: 403  
✅ `14:39:35` …the access-request page, never the shell  
✅ `14:39:35` e2e57-groupie, entitled through e2e57-team without a site grant: 403  

## The proxy refuses a grant on no site, and on a static site

✅ `14:39:35` A site grant naming no site: 400 unknown_site  
✅ `14:39:38` A static site e2e57static created  
✅ `14:39:38` A site grant on a static site: 400 site_not_grantable — its access is its allowed users  
✅ `14:39:38` …nothing reached Gatekeeper  
✅ `14:39:39` The static site deleted  

## Granted: the CLI to a user, the proxy to a group

✅ `14:39:39` lamaste-server plugins web-surface e2e-sitegrant grant --user e2e57-member  
✅ `14:39:39` e2e57-member reaches the shell (200)  
✅ `14:39:39` …index.html of the plugin's tree  
✅ `14:39:39` e2e57-groupie is still refused: the grant names e2e57-member alone  
✅ `14:39:40` The status lists the grant  
✅ `14:39:40` …and only e2e57-groupie without one  
✅ `14:39:40` A second grant to e2e57-member changes nothing (changed: false)  
✅ `14:39:40` POST /api/gatekeeper/grants: the site to group e2e57-team  
✅ `14:39:40` e2e57-groupie reaches the shell through e2e57-team (200)  
✅ `14:39:41` Nobody of the audience is without a grant  
✅ `14:39:41` lamaste-server plugins web-surface e2e-sitegrant grants --json  
✅ `14:39:41` Audited twice: plugin.web-surface.grant.created  
✅ `14:39:41` …the user by directory id, never by username  
✅ `14:39:41` …the group by name  

## Revoked: the CLI for the group, the bulk route for the user

✅ `14:39:42` lamaste-server plugins web-surface e2e-sitegrant revoke --group e2e57-team  
✅ `14:39:42` e2e57-groupie is refused again (403)  
✅ `14:39:42` e2e57-member keeps the site: their own grant  
✅ `14:39:42` The status names e2e57-groupie without a grant again  
✅ `14:39:42` Audited: plugin.web-surface.grant.revoked, the group  
✅ `14:39:43` Revoking a grant the group no longer holds: refused (no_grant)  
✅ `14:39:43` DELETE /api/gatekeeper/grants?principalType=user&principalId=e2e57-member: every grant of the user  
✅ `14:39:43` e2e57-member is refused (403)  
✅ `14:39:43` Audited: the site grant among them, by directory id  
✅ `14:39:43` No grant left on the site  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `63` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `63` |

ℹ️ `14:39:43` Cleaning up test resources...  
