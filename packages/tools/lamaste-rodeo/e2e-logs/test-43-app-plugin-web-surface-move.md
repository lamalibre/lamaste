# Lamaste E2E: 43 — App plugin web surface: the move from a bound tunnel (Three-VM)

> Started at `2026-11-03 10:21:17 UTC`


## Pre-flight

✅ `10:21:17` Onboarding is complete  
✅ `10:21:17` Agent test-agent is enrolled on the host  
✅ `10:21:18` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:21:18` The agent VM's lamaste-agent has the apphost command  
ℹ️ `10:21:18` Hosting agent: test-agent, relay domain test.lamaste.local, bound host e2e43mv.test.lamaste.local  
✅ `10:21:18` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `10:21:18` The visitor VM has oathtool (Authelia's second factor)  

## The plugin hosted; a restricted tunnel with its own backend, bound

✅ `10:21:19` Fixture built: @lamalibre/e2e-webmove-server with web tree m1  
✅ `10:21:27` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-webmove-server, @lamalibre/e2e-webmove-agent )  
✅ `10:21:27` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:21:28` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T10:21:28.951Z"})  
✅ `10:21:28` …through its own OIDC client  
✅ `10:21:29` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:21:30` User e2e43-viewer created  
✅ `10:21:31` User e2e43-outsider created — with a role, never the tunnel's grant  
✅ `10:21:35` Installed, approved and enabled @lamalibre/e2e-webmove-server@1.0.0  
✅ `10:21:46` Hosted on test-agent ()  
✅ `10:21:46` Ready: its agent half's first complete sync ended at the head  
✅ `10:21:47` Tunnel e2e43mv.test.lamaste.local: restricted  
✅ `10:21:51` The tunnel's own backend answers through chisel  
✅ `10:21:52` Bound as the plugin's user surface, served  
✅ `10:21:52` e2e43-viewer granted the tunnel  
✅ `10:21:52` e2e43-viewer entitled as viewer  
✅ `10:21:52` e2e43-outsider entitled as viewer  
✅ `10:21:53` …both active members of the audience  
✅ `10:21:53` No site, nothing offered: the tunnel is bound — moving is the way  
✅ `10:21:53` Creating a site beside it is refused (409 bound_to_tunnel)  

## Through the tunnel: its backend's shell, the agent half's API

✅ `10:22:03` e2e43-viewer signed in from the visitor VM  
✅ `10:22:05` e2e43-outsider signed in  
✅ `10:22:05` GET / as e2e43-viewer: the tunnel's own backend  
✅ `10:22:05` GET /api/e2e-webmove/app/echo: the agent half, through the binding  
✅ `10:22:05` e2e43-outsider, without the tunnel's grant: 403  

## The move: one reload, no moment without an answer

✅ `10:22:11` POST /api/plugins/e2e-webmove/web-surface/move {tunnelId}  
✅ `10:22:11` …the site on e2e43mv.test.lamaste.local, restricted as the tunnel was, served  
✅ `10:22:30` The probe ran its 25 seconds  
ℹ️ `10:22:30` Probe: 32×200 backend; 106×200 shell;   
✅ `10:22:30` Every answer during the move was a 200, from the backend or the shell  
✅ `10:22:30` …the tunnel's backend answered before it (32)  
✅ `10:22:30` …the relay's shell after it (106)  
✅ `10:22:30` …one switch, never back  

## After the move: the site serves; the tunnel kept, off and unbound

✅ `10:22:31` The tunnel stays, disabled and unbound  
✅ `10:22:31` Its vhost stays installed, unlinked — for a rollback by hand  
✅ `10:22:31` Its port grant is withdrawn: nothing answers on the host VM's port 18443  
✅ `10:22:31` The hosting is up again after the agent's tunnel client restarted  
✅ `10:22:31` Enabling the tunnel while the site holds its name: refused (400)  
✅ `10:22:31` …Domain 'e2e43mv.test.lamaste.local' is already served by a static site ('e2e43mv')  
✅ `10:22:32` The tunnel's grant was copied to the site  
✅ `10:22:32` GET / as e2e43-viewer: the relay's shell (tree m1)  
✅ `10:22:32` GET /api/e2e-webmove/app/echo: the agent half, from the site  
✅ `10:22:32` …as e2e43-viewer  
✅ `10:22:32` e2e43-outsider, still without the grant: 403 on the shell  
✅ `10:22:32` …and on the API  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `50` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `50` |

ℹ️ `10:22:32` Cleaning up test resources...  
