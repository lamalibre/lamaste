# Lamaste E2E: 43 — App plugin web surface: the move from a bound tunnel (Three-VM)

> Started at `2026-11-11 11:15:24 UTC`


## Pre-flight

✅ `11:15:24` Onboarding is complete  
✅ `11:15:24` Agent test-agent is enrolled on the host  
✅ `11:15:25` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `11:15:25` The agent VM's lamaste-agent has the apphost command  
ℹ️ `11:15:25` Hosting agent: test-agent, relay domain test.lamaste.local, bound host e2e43mv.test.lamaste.local  
✅ `11:15:25` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `11:15:25` The visitor VM has oathtool (Authelia's second factor)  

## The plugin hosted; a restricted tunnel with its own backend, bound

✅ `11:15:26` Fixture built: @lamalibre/e2e-webmove-server with web tree m1  
✅ `11:15:35` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-webmove-server, @lamalibre/e2e-webmove-agent )  
✅ `11:15:36` The agent VM reaches it at http://10.13.37.1:4874  
✅ `11:15:37` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T11:15:37.823Z"})  
✅ `11:15:37` …through its own OIDC client  
✅ `11:15:40` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `11:15:44` User e2e43-viewer created  
✅ `11:15:45` User e2e43-outsider created — with a role, never the tunnel's grant  
✅ `11:16:08` Installed, approved and enabled @lamalibre/e2e-webmove-server@1.0.0  
✅ `11:16:27` Hosted on test-agent ()  
✅ `11:16:28` Ready: its agent half's first complete sync ended at the head  
✅ `11:16:31` Tunnel e2e43mv.test.lamaste.local: restricted  
✅ `11:16:35` The tunnel's own backend answers through chisel  
✅ `11:16:38` Bound as the plugin's user surface, served  
✅ `11:16:38` e2e43-viewer granted the tunnel  
✅ `11:16:38` e2e43-viewer entitled as viewer  
✅ `11:16:38` e2e43-outsider entitled as viewer  
✅ `11:16:38` …both active members of the audience  
✅ `11:16:38` No site, nothing offered: the tunnel is bound — moving is the way  
✅ `11:16:39` Creating a site beside it is refused (409 bound_to_tunnel)  

## Through the tunnel: its backend's shell, the agent half's API

✅ `11:17:03` e2e43-viewer signed in from the visitor VM  
✅ `11:17:05` e2e43-outsider signed in  
✅ `11:17:05` GET / as e2e43-viewer: the tunnel's own backend  
✅ `11:17:05` GET /api/e2e-webmove/app/echo: the agent half, through the binding  
✅ `11:17:05` e2e43-outsider, without the tunnel's grant: 403  

## The move: one reload, no moment without an answer

✅ `11:17:11` POST /api/plugins/e2e-webmove/web-surface/move {tunnelId}  
✅ `11:17:11` …the site on e2e43mv.test.lamaste.local, restricted as the tunnel was, served  
✅ `11:17:30` The probe ran its 25 seconds  
ℹ️ `11:17:30` Probe: 40×200 backend; 118×200 shell;   
✅ `11:17:30` Every answer during the move was a 200, from the backend or the shell  
✅ `11:17:30` …the tunnel's backend answered before it (40)  
✅ `11:17:30` …the relay's shell after it (118)  
✅ `11:17:30` …one switch, never back  

## After the move: the site serves; the tunnel kept, off and unbound

✅ `11:17:31` The tunnel stays, disabled and unbound  
✅ `11:17:31` Its vhost stays installed, unlinked — for a rollback by hand  
✅ `11:17:35` Its port grant is withdrawn: nothing answers on the host VM's port 18443  
✅ `11:17:35` The hosting is up again after the agent's tunnel client restarted  
✅ `11:17:35` Enabling the tunnel while the site holds its name: refused (400)  
✅ `11:17:35` …Domain 'e2e43mv.test.lamaste.local' is already served by a static site ('e2e43mv')  
✅ `11:17:35` The tunnel's grant was copied to the site  
✅ `11:17:36` GET / as e2e43-viewer: the relay's shell (tree m1)  
✅ `11:17:36` GET /api/e2e-webmove/app/echo: the agent half, from the site  
✅ `11:17:36` …as e2e43-viewer  
✅ `11:17:36` e2e43-outsider, still without the grant: 403 on the shell  
✅ `11:17:36` …and on the API  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `50` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `50` |

ℹ️ `11:17:36` Cleaning up test resources...  
