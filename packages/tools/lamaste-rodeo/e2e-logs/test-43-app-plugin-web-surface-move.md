# Lamaste E2E: 43 — App plugin web surface: the move from a bound tunnel (Three-VM)

> Started at `2026-11-04 14:25:19 UTC`


## Pre-flight

✅ `14:25:19` Onboarding is complete  
✅ `14:25:19` Agent test-agent is enrolled on the host  
✅ `14:25:19` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:25:19` The agent VM's lamaste-agent has the apphost command  
ℹ️ `14:25:19` Hosting agent: test-agent, relay domain test.lamaste.local, bound host e2e43mv.test.lamaste.local  
✅ `14:25:20` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `14:25:20` The visitor VM has oathtool (Authelia's second factor)  

## The plugin hosted; a restricted tunnel with its own backend, bound

✅ `14:25:21` Fixture built: @lamalibre/e2e-webmove-server with web tree m1  
✅ `14:25:23` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-webmove-server, @lamalibre/e2e-webmove-agent )  
✅ `14:25:23` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:25:25` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T14:25:25.128Z"})  
✅ `14:25:25` …through its own OIDC client  
✅ `14:25:25` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:25:26` User e2e43-viewer created  
✅ `14:25:32` User e2e43-outsider created — with a role, never the tunnel's grant  
✅ `14:25:38` Installed, approved and enabled @lamalibre/e2e-webmove-server@1.0.0  
✅ `14:25:49` Hosted on test-agent ()  
✅ `14:25:49` Ready: its agent half's first complete sync ended at the head  
✅ `14:25:50` Tunnel e2e43mv.test.lamaste.local: restricted  
✅ `14:25:54` The tunnel's own backend answers through chisel  
✅ `14:25:55` Bound as the plugin's user surface, served  
✅ `14:25:55` e2e43-viewer granted the tunnel  
✅ `14:25:55` e2e43-viewer entitled as viewer  
✅ `14:25:56` e2e43-outsider entitled as viewer  
✅ `14:25:56` …both active members of the audience  
✅ `14:25:56` No site, nothing offered: the tunnel is bound — moving is the way  
✅ `14:25:56` Creating a site beside it is refused (409 bound_to_tunnel)  

## Through the tunnel: its backend's shell, the agent half's API

✅ `14:26:03` e2e43-viewer signed in from the visitor VM  
✅ `14:26:05` e2e43-outsider signed in  
✅ `14:26:05` GET / as e2e43-viewer: the tunnel's own backend  
✅ `14:26:05` GET /api/e2e-webmove/app/echo: the agent half, through the binding  
✅ `14:26:05` e2e43-outsider, without the tunnel's grant: 403  

## The move: one reload, no moment without an answer

✅ `14:26:11` POST /api/plugins/e2e-webmove/web-surface/move {tunnelId}  
✅ `14:26:11` …the site on e2e43mv.test.lamaste.local, restricted as the tunnel was, served  
✅ `14:26:30` The probe ran its 25 seconds  
ℹ️ `14:26:31` Probe: 37×200 backend; 137×200 shell;   
✅ `14:26:31` Every answer during the move was a 200, from the backend or the shell  
✅ `14:26:31` …the tunnel's backend answered before it (37)  
✅ `14:26:31` …the relay's shell after it (137)  
✅ `14:26:31` …one switch, never back  

## After the move: the site serves; the tunnel kept, off and unbound

✅ `14:26:32` The tunnel stays, disabled and unbound  
✅ `14:26:32` Its vhost stays installed, unlinked — for a rollback by hand  
✅ `14:26:32` Its port grant is withdrawn: nothing answers on the host VM's port 18443  
✅ `14:26:32` The hosting is up again after the agent's tunnel client restarted  
✅ `14:26:33` Enabling the tunnel while the site holds its name: refused (400)  
✅ `14:26:33` …Domain 'e2e43mv.test.lamaste.local' is already served by a static site ('e2e43mv')  
✅ `14:26:33` The tunnel's grant was copied to the site  
✅ `14:26:33` GET / as e2e43-viewer: the relay's shell (tree m1)  
✅ `14:26:33` GET /api/e2e-webmove/app/echo: the agent half, from the site  
✅ `14:26:33` …as e2e43-viewer  
✅ `14:26:34` e2e43-outsider, still without the grant: 403 on the shell  
✅ `14:26:34` …and on the API  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `50` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `50` |

ℹ️ `14:26:34` Cleaning up test resources...  
