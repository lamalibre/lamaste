# Lamaste E2E: 43 — App plugin web surface: the move from a bound tunnel (Three-VM)

> Started at `2026-10-25 18:00:49 UTC`


## Pre-flight

✅ `18:00:49` Onboarding is complete  
✅ `18:00:50` Agent test-agent is enrolled on the host  
✅ `18:00:50` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `18:00:50` The agent VM's lamaste-agent has the apphost command  
ℹ️ `18:00:50` Hosting agent: test-agent, relay domain test.lamaste.local, bound host e2e43mv.test.lamaste.local  
✅ `18:00:50` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `18:00:51` The visitor VM has oathtool (Authelia's second factor)  

## The plugin hosted; a restricted tunnel with its own backend, bound

✅ `18:00:51` Fixture built: @lamalibre/e2e-webmove-server with web tree m1  
✅ `18:00:54` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-webmove-server, @lamalibre/e2e-webmove-agent )  
✅ `18:00:54` The agent VM reaches it at http://10.13.37.1:4874  
✅ `18:00:55` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-10-25T18:00:55.882Z"})  
✅ `18:00:55` …through its own OIDC client  
✅ `18:00:59` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `18:01:01` User e2e43-viewer created  
✅ `18:01:03` User e2e43-outsider created — with a role, never the tunnel's grant  
✅ `18:01:05` Installed, approved and enabled @lamalibre/e2e-webmove-server@1.0.0  
✅ `18:01:15` Hosted on test-agent ()  
✅ `18:01:15` Ready: its agent half's first complete sync ended at the head  
✅ `18:01:16` Tunnel e2e43mv.test.lamaste.local: restricted  
✅ `18:01:20` The tunnel's own backend answers through chisel  
✅ `18:01:21` Bound as the plugin's user surface, served  
✅ `18:01:21` e2e43-viewer granted the tunnel  
✅ `18:01:22` e2e43-viewer entitled as viewer  
✅ `18:01:22` e2e43-outsider entitled as viewer  
✅ `18:01:22` …both active members of the audience  
✅ `18:01:22` No site, nothing offered: the tunnel is bound — moving is the way  
✅ `18:01:22` Creating a site beside it is refused (409 bound_to_tunnel)  

## Through the tunnel: its backend's shell, the agent half's API

✅ `18:01:33` e2e43-viewer signed in from the visitor VM  
✅ `18:01:35` e2e43-outsider signed in  
✅ `18:01:35` GET / as e2e43-viewer: the tunnel's own backend  
✅ `18:01:35` GET /api/e2e-webmove/app/echo: the agent half, through the binding  
✅ `18:01:35` e2e43-outsider, without the tunnel's grant: 403  

## The move: one reload, no moment without an answer

✅ `18:01:41` POST /api/plugins/e2e-webmove/web-surface/move {tunnelId}  
✅ `18:01:41` …the site on e2e43mv.test.lamaste.local, restricted as the tunnel was, served  
✅ `18:02:01` The probe ran its 25 seconds  
ℹ️ `18:02:01` Probe: 25×200 backend; 82×200 shell;   
✅ `18:02:01` Every answer during the move was a 200, from the backend or the shell  
✅ `18:02:01` …the tunnel's backend answered before it (25)  
✅ `18:02:01` …the relay's shell after it (82)  
✅ `18:02:01` …one switch, never back  

## After the move: the site serves; the tunnel kept, off and unbound

✅ `18:02:01` The tunnel stays, disabled and unbound  
✅ `18:02:01` Its vhost stays installed, unlinked — for a rollback by hand  
✅ `18:02:02` Its port grant is withdrawn: nothing answers on the host VM's port 18443  
✅ `18:02:02` The hosting is up again after the agent's tunnel client restarted  
✅ `18:02:02` Enabling the tunnel while the site holds its name: refused (400)  
✅ `18:02:02` …Domain 'e2e43mv.test.lamaste.local' is already served by a static site ('e2e43mv')  
✅ `18:02:02` The tunnel's grant was copied to the site  
✅ `18:02:02` GET / as e2e43-viewer: the relay's shell (tree m1)  
✅ `18:02:02` GET /api/e2e-webmove/app/echo: the agent half, from the site  
✅ `18:02:02` …as e2e43-viewer  
✅ `18:02:02` e2e43-outsider, still without the grant: 403 on the shell  
✅ `18:02:02` …and on the API  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `50` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `50` |

ℹ️ `18:02:02` Cleaning up test resources...  
