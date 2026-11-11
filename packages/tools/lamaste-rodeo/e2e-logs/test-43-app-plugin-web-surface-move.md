# Lamaste E2E: 43 — App plugin web surface: the move from a bound tunnel (Three-VM)

> Started at `2026-11-10 18:39:55 UTC`


## Pre-flight

✅ `18:39:55` Onboarding is complete  
✅ `18:39:55` Agent test-agent is enrolled on the host  
✅ `18:39:55` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `18:39:56` The agent VM's lamaste-agent has the apphost command  
ℹ️ `18:39:56` Hosting agent: test-agent, relay domain test.lamaste.local, bound host e2e43mv.test.lamaste.local  
✅ `18:39:56` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `18:39:56` The visitor VM has oathtool (Authelia's second factor)  

## The plugin hosted; a restricted tunnel with its own backend, bound

✅ `18:39:57` Fixture built: @lamalibre/e2e-webmove-server with web tree m1  
✅ `18:40:05` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-webmove-server, @lamalibre/e2e-webmove-agent )  
✅ `18:40:05` The agent VM reaches it at http://10.13.37.1:4874  
✅ `18:40:06` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T18:40:06.881Z"})  
✅ `18:40:06` …through its own OIDC client  
✅ `18:40:11` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `18:40:12` User e2e43-viewer created  
✅ `18:40:13` User e2e43-outsider created — with a role, never the tunnel's grant  
✅ `18:40:17` Installed, approved and enabled @lamalibre/e2e-webmove-server@1.0.0  
✅ `18:40:28` Hosted on test-agent ()  
✅ `18:40:28` Ready: its agent half's first complete sync ended at the head  
✅ `18:40:29` Tunnel e2e43mv.test.lamaste.local: restricted  
✅ `18:40:33` The tunnel's own backend answers through chisel  
✅ `18:40:35` Bound as the plugin's user surface, served  
✅ `18:40:35` e2e43-viewer granted the tunnel  
✅ `18:40:35` e2e43-viewer entitled as viewer  
✅ `18:40:35` e2e43-outsider entitled as viewer  
✅ `18:40:36` …both active members of the audience  
✅ `18:40:36` No site, nothing offered: the tunnel is bound — moving is the way  
✅ `18:40:36` Creating a site beside it is refused (409 bound_to_tunnel)  

## Through the tunnel: its backend's shell, the agent half's API

✅ `18:41:03` e2e43-viewer signed in from the visitor VM  
✅ `18:41:04` e2e43-outsider signed in  
✅ `18:41:05` GET / as e2e43-viewer: the tunnel's own backend  
✅ `18:41:05` GET /api/e2e-webmove/app/echo: the agent half, through the binding  
✅ `18:41:05` e2e43-outsider, without the tunnel's grant: 403  

## The move: one reload, no moment without an answer

✅ `18:41:11` POST /api/plugins/e2e-webmove/web-surface/move {tunnelId}  
✅ `18:41:11` …the site on e2e43mv.test.lamaste.local, restricted as the tunnel was, served  
✅ `18:41:31` The probe ran its 25 seconds  
ℹ️ `18:41:31` Probe: 37×200 backend; 115×200 shell;   
✅ `18:41:31` Every answer during the move was a 200, from the backend or the shell  
✅ `18:41:31` …the tunnel's backend answered before it (37)  
✅ `18:41:31` …the relay's shell after it (115)  
✅ `18:41:31` …one switch, never back  

## After the move: the site serves; the tunnel kept, off and unbound

✅ `18:41:31` The tunnel stays, disabled and unbound  
✅ `18:41:31` Its vhost stays installed, unlinked — for a rollback by hand  
✅ `18:41:35` Its port grant is withdrawn: nothing answers on the host VM's port 18443  
✅ `18:41:35` The hosting is up again after the agent's tunnel client restarted  
✅ `18:41:35` Enabling the tunnel while the site holds its name: refused (400)  
✅ `18:41:35` …Domain 'e2e43mv.test.lamaste.local' is already served by a static site ('e2e43mv')  
✅ `18:41:35` The tunnel's grant was copied to the site  
✅ `18:41:36` GET / as e2e43-viewer: the relay's shell (tree m1)  
✅ `18:41:36` GET /api/e2e-webmove/app/echo: the agent half, from the site  
✅ `18:41:36` …as e2e43-viewer  
✅ `18:41:36` e2e43-outsider, still without the grant: 403 on the shell  
✅ `18:41:36` …and on the API  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `50` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `50` |

ℹ️ `18:41:36` Cleaning up test resources...  
