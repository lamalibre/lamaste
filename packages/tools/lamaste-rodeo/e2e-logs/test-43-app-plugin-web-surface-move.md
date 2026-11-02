# Lamaste E2E: 43 — App plugin web surface: the move from a bound tunnel (Three-VM)

> Started at `2026-11-02 16:38:17 UTC`


## Pre-flight

✅ `16:38:17` Onboarding is complete  
✅ `16:38:17` Agent test-agent is enrolled on the host  
✅ `16:38:18` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `16:38:18` The agent VM's lamaste-agent has the apphost command  
ℹ️ `16:38:18` Hosting agent: test-agent, relay domain test.lamaste.local, bound host e2e43mv.test.lamaste.local  
✅ `16:38:18` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `16:38:18` The visitor VM has oathtool (Authelia's second factor)  

## The plugin hosted; a restricted tunnel with its own backend, bound

✅ `16:38:19` Fixture built: @lamalibre/e2e-webmove-server with web tree m1  
✅ `16:38:21` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-webmove-server, @lamalibre/e2e-webmove-agent )  
✅ `16:38:21` The agent VM reaches it at http://10.13.37.1:4874  
✅ `16:38:23` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-02T16:38:23.286Z"})  
✅ `16:38:23` …through its own OIDC client  
✅ `16:38:23` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `16:38:24` User e2e43-viewer created  
✅ `16:38:25` User e2e43-outsider created — with a role, never the tunnel's grant  
✅ `16:38:27` Installed, approved and enabled @lamalibre/e2e-webmove-server@1.0.0  
✅ `16:38:37` Hosted on test-agent ()  
✅ `16:38:38` Ready: its agent half's first complete sync ended at the head  
✅ `16:38:39` Tunnel e2e43mv.test.lamaste.local: restricted  
✅ `16:38:42` The tunnel's own backend answers through chisel  
✅ `16:38:44` Bound as the plugin's user surface, served  
✅ `16:38:44` e2e43-viewer granted the tunnel  
✅ `16:38:44` e2e43-viewer entitled as viewer  
✅ `16:38:44` e2e43-outsider entitled as viewer  
✅ `16:38:44` …both active members of the audience  
✅ `16:38:44` No site, nothing offered: the tunnel is bound — moving is the way  
✅ `16:38:44` Creating a site beside it is refused (409 bound_to_tunnel)  

## Through the tunnel: its backend's shell, the agent half's API

✅ `16:39:02` e2e43-viewer signed in from the visitor VM  
✅ `16:39:04` e2e43-outsider signed in  
✅ `16:39:04` GET / as e2e43-viewer: the tunnel's own backend  
✅ `16:39:04` GET /api/e2e-webmove/app/echo: the agent half, through the binding  
✅ `16:39:04` e2e43-outsider, without the tunnel's grant: 403  

## The move: one reload, no moment without an answer

✅ `16:39:10` POST /api/plugins/e2e-webmove/web-surface/move {tunnelId}  
✅ `16:39:10` …the site on e2e43mv.test.lamaste.local, restricted as the tunnel was, served  
✅ `16:39:32` The probe ran its 25 seconds  
ℹ️ `16:39:32` Probe: 41×200 backend; 137×200 shell;   
✅ `16:39:32` Every answer during the move was a 200, from the backend or the shell  
✅ `16:39:32` …the tunnel's backend answered before it (41)  
✅ `16:39:32` …the relay's shell after it (137)  
✅ `16:39:32` …one switch, never back  

## After the move: the site serves; the tunnel kept, off and unbound

✅ `16:39:33` The tunnel stays, disabled and unbound  
✅ `16:39:33` Its vhost stays installed, unlinked — for a rollback by hand  
✅ `16:39:33` Its port grant is withdrawn: nothing answers on the host VM's port 18443  
✅ `16:39:33` The hosting is up again after the agent's tunnel client restarted  
✅ `16:39:33` Enabling the tunnel while the site holds its name: refused (400)  
✅ `16:39:33` …Domain 'e2e43mv.test.lamaste.local' is already served by a static site ('e2e43mv')  
✅ `16:39:33` The tunnel's grant was copied to the site  
✅ `16:39:34` GET / as e2e43-viewer: the relay's shell (tree m1)  
✅ `16:39:34` GET /api/e2e-webmove/app/echo: the agent half, from the site  
✅ `16:39:34` …as e2e43-viewer  
✅ `16:39:34` e2e43-outsider, still without the grant: 403 on the shell  
✅ `16:39:34` …and on the API  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `50` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `50` |

ℹ️ `16:39:34` Cleaning up test resources...  
