# Lamaste E2E: 43 — App plugin web surface: the move from a bound tunnel (Three-VM)

> Started at `2026-11-10 13:57:21 UTC`


## Pre-flight

✅ `13:57:21` Onboarding is complete  
✅ `13:57:22` Agent test-agent is enrolled on the host  
✅ `13:57:22` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:57:22` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:57:22` Hosting agent: test-agent, relay domain test.lamaste.local, bound host e2e43mv.test.lamaste.local  
✅ `13:57:22` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `13:57:23` The visitor VM has oathtool (Authelia's second factor)  

## The plugin hosted; a restricted tunnel with its own backend, bound

✅ `13:57:24` Fixture built: @lamalibre/e2e-webmove-server with web tree m1  
✅ `13:57:33` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-webmove-server, @lamalibre/e2e-webmove-agent )  
✅ `13:57:33` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:57:34` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T13:57:34.728Z"})  
✅ `13:57:34` …through its own OIDC client  
✅ `13:57:39` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:57:40` User e2e43-viewer created  
✅ `13:57:41` User e2e43-outsider created — with a role, never the tunnel's grant  
✅ `13:57:45` Installed, approved and enabled @lamalibre/e2e-webmove-server@1.0.0  
✅ `13:57:56` Hosted on test-agent ()  
✅ `13:57:56` Ready: its agent half's first complete sync ended at the head  
✅ `13:57:58` Tunnel e2e43mv.test.lamaste.local: restricted  
✅ `13:58:02` The tunnel's own backend answers through chisel  
✅ `13:58:04` Bound as the plugin's user surface, served  
✅ `13:58:04` e2e43-viewer granted the tunnel  
✅ `13:58:04` e2e43-viewer entitled as viewer  
✅ `13:58:04` e2e43-outsider entitled as viewer  
✅ `13:58:04` …both active members of the audience  
✅ `13:58:05` No site, nothing offered: the tunnel is bound — moving is the way  
✅ `13:58:05` Creating a site beside it is refused (409 bound_to_tunnel)  

## Through the tunnel: its backend's shell, the agent half's API

✅ `13:58:33` e2e43-viewer signed in from the visitor VM  
✅ `13:58:35` e2e43-outsider signed in  
✅ `13:58:35` GET / as e2e43-viewer: the tunnel's own backend  
✅ `13:58:35` GET /api/e2e-webmove/app/echo: the agent half, through the binding  
✅ `13:58:36` e2e43-outsider, without the tunnel's grant: 403  

## The move: one reload, no moment without an answer

✅ `13:58:42` POST /api/plugins/e2e-webmove/web-surface/move {tunnelId}  
✅ `13:58:42` …the site on e2e43mv.test.lamaste.local, restricted as the tunnel was, served  
✅ `13:59:01` The probe ran its 25 seconds  
ℹ️ `13:59:01` Probe: 32×200 backend; 101×200 shell;   
✅ `13:59:01` Every answer during the move was a 200, from the backend or the shell  
✅ `13:59:01` …the tunnel's backend answered before it (32)  
✅ `13:59:01` …the relay's shell after it (101)  
✅ `13:59:01` …one switch, never back  

## After the move: the site serves; the tunnel kept, off and unbound

✅ `13:59:01` The tunnel stays, disabled and unbound  
✅ `13:59:02` Its vhost stays installed, unlinked — for a rollback by hand  
✅ `13:59:06` Its port grant is withdrawn: nothing answers on the host VM's port 18443  
✅ `13:59:06` The hosting is up again after the agent's tunnel client restarted  
✅ `13:59:06` Enabling the tunnel while the site holds its name: refused (400)  
✅ `13:59:06` …Domain 'e2e43mv.test.lamaste.local' is already served by a static site ('e2e43mv')  
✅ `13:59:06` The tunnel's grant was copied to the site  
✅ `13:59:06` GET / as e2e43-viewer: the relay's shell (tree m1)  
✅ `13:59:06` GET /api/e2e-webmove/app/echo: the agent half, from the site  
✅ `13:59:06` …as e2e43-viewer  
✅ `13:59:06` e2e43-outsider, still without the grant: 403 on the shell  
✅ `13:59:07` …and on the API  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `50` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `50` |

ℹ️ `13:59:07` Cleaning up test resources...  
