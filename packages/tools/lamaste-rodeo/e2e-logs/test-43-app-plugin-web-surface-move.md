# Lamaste E2E: 43 — App plugin web surface: the move from a bound tunnel (Three-VM)

> Started at `2026-10-25 19:58:42 UTC`


## Pre-flight

✅ `19:58:43` Onboarding is complete  
✅ `19:58:43` Agent test-agent is enrolled on the host  
✅ `19:58:43` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `19:58:43` The agent VM's lamaste-agent has the apphost command  
ℹ️ `19:58:43` Hosting agent: test-agent, relay domain test.lamaste.local, bound host e2e43mv.test.lamaste.local  
✅ `19:58:43` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `19:58:44` The visitor VM has oathtool (Authelia's second factor)  

## The plugin hosted; a restricted tunnel with its own backend, bound

✅ `19:58:44` Fixture built: @lamalibre/e2e-webmove-server with web tree m1  
✅ `19:58:47` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-webmove-server, @lamalibre/e2e-webmove-agent )  
✅ `19:58:47` The agent VM reaches it at http://10.13.37.1:4874  
✅ `19:58:48` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-10-25T19:58:49.095Z"})  
✅ `19:58:49` …through its own OIDC client  
✅ `19:58:49` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `19:58:51` User e2e43-viewer created  
✅ `19:58:53` User e2e43-outsider created — with a role, never the tunnel's grant  
✅ `19:58:55` Installed, approved and enabled @lamalibre/e2e-webmove-server@1.0.0  
✅ `19:59:06` Hosted on test-agent ()  
✅ `19:59:06` Ready: its agent half's first complete sync ended at the head  
✅ `19:59:07` Tunnel e2e43mv.test.lamaste.local: restricted  
✅ `19:59:11` The tunnel's own backend answers through chisel  
✅ `19:59:12` Bound as the plugin's user surface, served  
✅ `19:59:12` e2e43-viewer granted the tunnel  
✅ `19:59:12` e2e43-viewer entitled as viewer  
✅ `19:59:12` e2e43-outsider entitled as viewer  
✅ `19:59:12` …both active members of the audience  
✅ `19:59:13` No site, nothing offered: the tunnel is bound — moving is the way  
✅ `19:59:13` Creating a site beside it is refused (409 bound_to_tunnel)  

## Through the tunnel: its backend's shell, the agent half's API

✅ `19:59:33` e2e43-viewer signed in from the visitor VM  
✅ `19:59:34` e2e43-outsider signed in  
✅ `19:59:35` GET / as e2e43-viewer: the tunnel's own backend  
✅ `19:59:35` GET /api/e2e-webmove/app/echo: the agent half, through the binding  
✅ `19:59:35` e2e43-outsider, without the tunnel's grant: 403  

## The move: one reload, no moment without an answer

✅ `19:59:41` POST /api/plugins/e2e-webmove/web-surface/move {tunnelId}  
✅ `19:59:41` …the site on e2e43mv.test.lamaste.local, restricted as the tunnel was, served  
✅ `20:00:00` The probe ran its 25 seconds  
ℹ️ `20:00:00` Probe: 37×200 backend; 114×200 shell;   
✅ `20:00:00` Every answer during the move was a 200, from the backend or the shell  
✅ `20:00:00` …the tunnel's backend answered before it (37)  
✅ `20:00:00` …the relay's shell after it (114)  
✅ `20:00:00` …one switch, never back  

## After the move: the site serves; the tunnel kept, off and unbound

✅ `20:00:00` The tunnel stays, disabled and unbound  
✅ `20:00:01` Its vhost stays installed, unlinked — for a rollback by hand  
✅ `20:00:01` Its port grant is withdrawn: nothing answers on the host VM's port 18443  
✅ `20:00:01` The hosting is up again after the agent's tunnel client restarted  
✅ `20:00:01` Enabling the tunnel while the site holds its name: refused (400)  
✅ `20:00:01` …Domain 'e2e43mv.test.lamaste.local' is already served by a static site ('e2e43mv')  
✅ `20:00:01` The tunnel's grant was copied to the site  
✅ `20:00:02` GET / as e2e43-viewer: the relay's shell (tree m1)  
✅ `20:00:02` GET /api/e2e-webmove/app/echo: the agent half, from the site  
✅ `20:00:02` …as e2e43-viewer  
✅ `20:00:02` e2e43-outsider, still without the grant: 403 on the shell  
✅ `20:00:02` …and on the API  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `50` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `50` |

ℹ️ `20:00:02` Cleaning up test resources...  
