# Lamaste E2E: 40 — App plugin user surface (Three-VM)

> Started at `2026-11-04 14:15:02 UTC`


## Pre-flight

✅ `14:15:02` Onboarding is complete  
✅ `14:15:02` Agent test-agent is enrolled on the host  
✅ `14:15:02` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:15:03` The agent VM's lamaste-agent has the apphost command  
ℹ️ `14:15:03` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local, bound host e2e40us.test.lamaste.local  
✅ `14:15:03` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `14:15:03` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, the stand-in Feria, the users; the plugin installed, not approved

✅ `14:15:04` Fixture built: @lamalibre/e2e-idsurf-server (identity: viewer, editor; displayName, email) and its agent package  
✅ `14:15:07` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-idsurf-server, @lamalibre/e2e-idsurf-agent )  
✅ `14:15:07` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:15:08` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T14:15:08.539Z"})  
✅ `14:15:08` …through its own OIDC client  
✅ `14:15:09` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:15:10` User e2e40-viewer created  
✅ `14:15:11` User e2e40-norole created — to hold no role in the plugin  
✅ `14:15:11` Both have a directory id  
✅ `14:15:12` Installed @lamalibre/e2e-idsurf-server@1.0.0  
✅ `14:15:12` …its identity block waits for approval  
✅ `14:15:12` Hosting it is refused until it is approved (409)  
✅ `14:15:12` …hooks_not_approved  

## An authenticated app tunnel with its own backend, and two others

✅ `14:15:13` Tunnel e2e40us.test.lamaste.local: authenticated, carried by test-agent  
✅ `14:15:14` Tunnel e2e40pub: public  
✅ `14:15:16` Tunnel e2e40two: authenticated  
✅ `14:15:20` The tunnel's own backend answers through chisel (/api/e2e-idsurf/app/echo is a file of it)  

## Not hosted, not bound: the refusals; requests go down the tunnel

✅ `14:15:20` A route no installed plugin holds cannot be bound (400)  
✅ `14:15:20` Not hosted on the agent carrying the tunnel, the plugin cannot be bound (400)  
✅ `14:15:20` …Plugin 'e2e-idsurf' is not hosted on an agent — host it on the agent that carries this tunnel ('test-agent') first  
✅ `14:15:20` …the tunnel carries no binding  
✅ `14:15:20` Without a session: Authelia's redirect, as for any page of the tunnel  
✅ `14:15:20` …to the sign-in portal  
✅ `14:15:33` e2e40-viewer signed in from the visitor VM (password, TOTP)  
✅ `14:15:34` e2e40-norole signed in from the visitor VM  
✅ `14:15:35` Signed in: 200  
✅ `14:15:35` …from the tunnel's own backend: no user-surface location  
✅ `14:15:35` The viewer's session cookie, read from the visitor's jar  
✅ `14:15:35` Signed in with two other cookies around the session: the backend gets both, never authelia_session  
✅ `14:15:35` …the session first: the other alone  
✅ `14:15:35` …the session alone: no Cookie header at all  

## Approved and hosted on the tunnel's agent; bound, its users are let through

✅ `14:15:35` Approved: its agent half and identity block  
✅ `14:15:46` Hosted on test-agent ()  
✅ `14:16:06` The relay's health of the hosting is up  
✅ `14:16:07` Ready: its agent half's first complete sync ended at the head  
✅ `14:16:08` PUT /api/tunnels/edb9dfda-8159-4c4e-8f87-69c68054e7fd/user-surface {route: e2e-idsurf}  
✅ `14:16:08` …bound  
✅ `14:16:08` …served at once: approved, declares identity, hosted by the tunnel's agent  
✅ `14:16:08` Binding it again changes nothing  
✅ `14:16:08` A public tunnel cannot be bound (400)  
✅ `14:16:08` …A public tunnel has no signed-in user to vouch for — make it authenticated or restricted first  
✅ `14:16:08` A second tunnel for the same route is refused (409)  
✅ `14:16:08` …user_surface_conflict  
✅ `14:16:08` The bound tunnel cannot be made public (409)  
✅ `14:16:09` …it stays authenticated  
✅ `14:16:09` Without a session: 401  
✅ `14:16:09` …JSON (unauthenticated) for the application to act on  
✅ `14:16:10` …never a redirect  
✅ `14:16:10` e2e40-viewer, before any entitlement: 403  
✅ `14:16:10` …not entitled  
✅ `14:16:10` e2e40-viewer entitled as viewer  
✅ `14:16:10` …an active member of the audience  

## Signed in with a role: the agent half sees the directory's user

✅ `14:16:10` GET /api/e2e-idsurf/app/echo as e2e40-viewer: 200  
✅ `14:16:10` The caller the panel signed: user, the directory's id, the username, the roles  
✅ `14:16:10` …for the agent half's /app/echo  
✅ `14:16:10` The application's Set-Cookie never reaches the browser  
✅ `14:16:10` …nor any X-Lamalibre-* header (the responder signature is the relay's)  
✅ `14:16:10` …every answer is a sandboxed document (CSP)  
✅ `14:16:10` …readable by the bound host's own pages only (CORP)  
✅ `14:16:10` …and no CORS header  
✅ `14:16:10` The agent half's projection holds e2e40-viewer (the feed delivered the entitlement)  
✅ `14:16:11` GET /api/e2e-idsurf/app/me: what the agent half's projection holds of them  
✅ `14:16:11` POST /api/e2e-idsurf/app/me: the agent half's own 405, signed, passes  
✅ `14:16:12` /api/e2e-idsurf/app/nothing: the agent half's own 404  
✅ `14:16:12` e2e40-norole, signed in without a role in the plugin: 403  
✅ `14:16:12` …not entitled  

## What a browser cannot do

✅ `14:16:12` A request another site started (Sec-Fetch-Site: cross-site), even a GET: 403  
✅ `14:16:12` …cross-site request refused  
✅ `14:16:12` POST without an Origin: 403  
✅ `14:16:12` …cross-origin request refused  
✅ `14:16:13` POST from a foreign Origin: 403  
✅ `14:16:13` POST from the bound host's Origin: forwarded  
✅ `14:16:13` …the agent half got the POST, its Origin and all 17 bytes  
✅ `14:16:13` Sent with its own X-Lamalibre-Relay-Assertion, Remote-User and X-Lamalibre-Caller: 200  
✅ `14:16:13` …the caller is still the one Gatekeeper vouched for  
✅ `14:16:13` …no Remote-User or relay assertion reached the agent half  
✅ `14:16:13` …while an ordinary header did  
✅ `14:16:13` The viewer's session cookie, read from the visitor's jar  
✅ `14:16:13` That cookie alone, sent as a header: 200  
✅ `14:16:13` authelia_session presented twice (twice): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `14:16:13` …unauthenticated  
✅ `14:16:14` authelia_session presented twice (empty-first): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `14:16:14` …unauthenticated  
✅ `14:16:14` authelia_session presented twice (planted-after): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `14:16:14` …unauthenticated  
✅ `14:16:14` On the host VM, Gatekeeper vouches for that session (/authz/user-surface/e2e40us.test.lamaste.local)  
✅ `14:16:14` Its assertion, sent to the panel's listener: 200  
✅ `14:16:14` …as e2e40-viewer  
✅ `14:16:14` The same assertion again: 401 — replay refused  
✅ `14:16:14` …unauthenticated  
✅ `14:16:15` An assertion for GET does not carry a POST (401)  
✅ `14:16:15` /api/e2e-idsurf/app/../app/echo: refused (403)  
✅ `14:16:15` /api/e2e-idsurf/app/./echo: refused (403)  
✅ `14:16:16` /api/e2e-idsurf/app/%2e/echo: refused (403)  
✅ `14:16:16` /api/e2e-idsurf/app/a%2fb: refused (403)  
✅ `14:16:16` /api/e2e-idsurf/app/a%5cb: refused (403)  
✅ `14:16:16` /api/e2e-idsurf/app/%252e%252e/echo: refused (403)  
✅ `14:16:16` The agent half saw none of them (its request log)  

## Restricted: a grant for the tunnel is needed too

✅ `14:16:17` The bound tunnel made restricted  
✅ `14:16:21` e2e40-viewer, entitled to the plugin but without a grant for the tunnel: 403  
✅ `14:16:21` e2e40-viewer granted the tunnel  
✅ `14:16:21` …200 with the grant  
✅ `14:16:23` The grant revoked, the tunnel authenticated again  
✅ `14:16:26` e2e40-viewer: 200 again  

## Unbound: the location is gone; bound again: served

✅ `14:16:28` DELETE /api/tunnels/edb9dfda-8159-4c4e-8f87-69c68054e7fd/user-surface/e2e-idsurf  
✅ `14:16:28` …the tunnel carries no binding  
✅ `14:16:28` Signed in, /api/e2e-idsurf/app/echo reaches the tunnel's own backend again  
✅ `14:16:28` …and without a session Authelia redirects, as for any page of it  
✅ `14:16:30` Bound again: served at once (approved, hosted)  
✅ `14:16:33` e2e40-viewer: the agent half answers again  

## Disabled: refused at once

✅ `14:16:33` Gatekeeper vouches for e2e40-viewer's session once more  
✅ `14:16:33` e2e40-viewer disabled  
✅ `14:16:34` That assertion, still valid, sent to the panel: 403  
✅ `14:16:34` …This user is disabled  
✅ `14:16:34` From the visitor VM: 401 — Authelia ended the disabled user's session, or the panel refuses it  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `121` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `121` |

ℹ️ `14:16:34` Cleaning up test resources...  
