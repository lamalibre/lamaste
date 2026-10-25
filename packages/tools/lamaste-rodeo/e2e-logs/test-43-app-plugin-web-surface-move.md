# Lamaste E2E: 43 — App plugin web surface: the move from a bound tunnel (Three-VM)

> Started at `2026-10-25 18:35:35 UTC`


## Pre-flight

✅ `18:35:35` Onboarding is complete  
✅ `18:35:35` Agent test-agent is enrolled on the host  
✅ `18:35:35` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `18:35:35` The agent VM's lamaste-agent has the apphost command  
ℹ️ `18:35:35` Hosting agent: test-agent, relay domain test.lamaste.local, bound host e2e43mv.test.lamaste.local  
✅ `18:35:36` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `18:35:36` The visitor VM has oathtool (Authelia's second factor)  

## The plugin hosted; a restricted tunnel with its own backend, bound

✅ `18:35:36` Fixture built: @lamalibre/e2e-webmove-server with web tree m1  
✅ `18:35:39` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-webmove-server, @lamalibre/e2e-webmove-agent )  
✅ `18:35:39` The agent VM reaches it at http://10.13.37.1:4874  
✅ `18:35:40` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-10-25T18:35:40.940Z"})  
✅ `18:35:40` …through its own OIDC client  
✅ `18:35:41` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `18:35:43` User e2e43-viewer created  
✅ `18:35:44` User e2e43-outsider created — with a role, never the tunnel's grant  
✅ `18:35:46` Installed, approved and enabled @lamalibre/e2e-webmove-server@1.0.0  
✅ `18:35:57` Hosted on test-agent ()  
✅ `18:35:57` Ready: its agent half's first complete sync ended at the head  
✅ `18:35:57` Tunnel e2e43mv.test.lamaste.local: restricted  
✅ `18:36:01` The tunnel's own backend answers through chisel  
✅ `18:36:02` Bound as the plugin's user surface, served  
✅ `18:36:02` e2e43-viewer granted the tunnel  
✅ `18:36:02` e2e43-viewer entitled as viewer  
✅ `18:36:02` e2e43-outsider entitled as viewer  
✅ `18:36:02` …both active members of the audience  
✅ `18:36:02` No site, nothing offered: the tunnel is bound — moving is the way  
✅ `18:36:03` Creating a site beside it is refused (409 bound_to_tunnel)  

## Through the tunnel: its backend's shell, the agent half's API

✅ `18:36:33` e2e43-viewer signed in from the visitor VM  
✅ `18:36:34` e2e43-outsider signed in  
✅ `18:36:35` GET / as e2e43-viewer: the tunnel's own backend  
✅ `18:36:35` GET /api/e2e-webmove/app/echo: the agent half, through the binding  
✅ `18:36:35` e2e43-outsider, without the tunnel's grant: 403  

## The move: one reload, no moment without an answer

✅ `18:36:41` POST /api/plugins/e2e-webmove/web-surface/move {tunnelId}  
✅ `18:36:41` …the site on e2e43mv.test.lamaste.local, restricted as the tunnel was, served  
✅ `18:37:00` The probe ran its 25 seconds  
ℹ️ `18:37:01` Probe: 29×200 backend; 91×200 shell;   
✅ `18:37:01` Every answer during the move was a 200, from the backend or the shell  
✅ `18:37:01` …the tunnel's backend answered before it (29)  
✅ `18:37:01` …the relay's shell after it (91)  
✅ `18:37:01` …one switch, never back  

## After the move: the site serves; the tunnel kept, off and unbound

✅ `18:37:01` The tunnel stays, disabled and unbound  
✅ `18:37:01` Its vhost stays installed, unlinked — for a rollback by hand  
✅ `18:37:05` Its port grant is withdrawn: nothing answers on the host VM's port 18443  
✅ `18:37:05` The hosting is up again after the agent's tunnel client restarted  
✅ `18:37:05` Enabling the tunnel while the site holds its name: refused (400)  
✅ `18:37:05` …Domain 'e2e43mv.test.lamaste.local' is already served by a static site ('e2e43mv')  
✅ `18:37:05` The tunnel's grant was copied to the site  
✅ `18:37:05` GET / as e2e43-viewer: the relay's shell (tree m1)  
✅ `18:37:05` GET /api/e2e-webmove/app/echo: the agent half, from the site  
✅ `18:37:05` …as e2e43-viewer  
✅ `18:37:05` e2e43-outsider, still without the grant: 403 on the shell  
✅ `18:37:05` …and on the API  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `50` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `50` |

ℹ️ `18:37:05` Cleaning up test resources...  
