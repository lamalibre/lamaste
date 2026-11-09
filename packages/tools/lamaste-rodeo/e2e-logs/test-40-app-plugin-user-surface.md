# Lamaste E2E: 40 — App plugin user surface (Three-VM)

> Started at `2026-11-09 13:23:04 UTC`


## Pre-flight

✅ `13:23:04` Onboarding is complete  
✅ `13:23:04` Agent test-agent is enrolled on the host  
✅ `13:23:04` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:23:04` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:23:04` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local, bound host e2e40us.test.lamaste.local  
✅ `13:23:04` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `13:23:05` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, the stand-in Feria, the users; the plugin installed, not approved

✅ `13:23:05` Fixture built: @lamalibre/e2e-idsurf-server (identity: viewer, editor; displayName, email) and its agent package  
✅ `13:23:14` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-idsurf-server, @lamalibre/e2e-idsurf-agent )  
✅ `13:23:14` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:23:15` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T13:23:15.171Z"})  
✅ `13:23:15` …through its own OIDC client  
✅ `13:23:15` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:23:16` User e2e40-viewer created  
✅ `13:23:17` User e2e40-norole created — to hold no role in the plugin  
✅ `13:23:17` Both have a directory id  
✅ `13:23:21` Installed @lamalibre/e2e-idsurf-server@1.0.0  
✅ `13:23:21` …its identity block waits for approval  
✅ `13:23:21` Hosting it is refused until it is approved (409)  
✅ `13:23:21` …hooks_not_approved  

## An authenticated app tunnel with its own backend, and two others

✅ `13:23:22` Tunnel e2e40us.test.lamaste.local: authenticated, carried by test-agent  
✅ `13:23:23` Tunnel e2e40pub: public  
✅ `13:23:24` Tunnel e2e40two: authenticated  
✅ `13:23:27` The tunnel's own backend answers through chisel (/api/e2e-idsurf/app/echo is a file of it)  

## Not hosted, not bound: the refusals; requests go down the tunnel

✅ `13:23:28` A route no installed plugin holds cannot be bound (400)  
✅ `13:23:28` Not hosted on the agent carrying the tunnel, the plugin cannot be bound (400)  
✅ `13:23:28` …Plugin 'e2e-idsurf' is not hosted on an agent — host it on the agent that carries this tunnel ('test-agent') first  
✅ `13:23:28` …the tunnel carries no binding  
✅ `13:23:28` Without a session: Authelia's redirect, as for any page of the tunnel  
✅ `13:23:28` …to the sign-in portal  
✅ `13:23:33` e2e40-viewer signed in from the visitor VM (password, TOTP)  
✅ `13:23:34` e2e40-norole signed in from the visitor VM  
✅ `13:23:34` Signed in: 200  
✅ `13:23:34` …from the tunnel's own backend: no user-surface location  
✅ `13:23:35` The viewer's session cookie, read from the visitor's jar  
✅ `13:23:35` Signed in with two other cookies around the session: the backend gets both, never authelia_session  
✅ `13:23:35` …the session first: the other alone  
✅ `13:23:35` …the session alone: no Cookie header at all  

## Approved and hosted on the tunnel's agent; bound, its users are let through

✅ `13:23:35` Approved: its agent half and identity block  
✅ `13:23:45` Hosted on test-agent ()  
✅ `13:24:05` The relay's health of the hosting is up  
✅ `13:24:05` Ready: its agent half's first complete sync ended at the head  
✅ `13:24:06` PUT /api/tunnels/018f717f-55c3-4e2c-bddd-75a3dbd7c30c/user-surface {route: e2e-idsurf}  
✅ `13:24:06` …bound  
✅ `13:24:06` …served at once: approved, declares identity, hosted by the tunnel's agent  
✅ `13:24:06` Binding it again changes nothing  
✅ `13:24:06` A public tunnel cannot be bound (400)  
✅ `13:24:06` …A public tunnel has no signed-in user to vouch for — make it authenticated or restricted first  
✅ `13:24:06` A second tunnel for the same route is refused (409)  
✅ `13:24:06` …user_surface_conflict  
✅ `13:24:06` The bound tunnel cannot be made public (409)  
✅ `13:24:06` …it stays authenticated  
✅ `13:24:07` Without a session: 401  
✅ `13:24:07` …JSON (unauthenticated) for the application to act on  
✅ `13:24:07` …never a redirect  
✅ `13:24:07` e2e40-viewer, before any entitlement: 403  
✅ `13:24:07` …not entitled  
✅ `13:24:07` e2e40-viewer entitled as viewer  
✅ `13:24:07` …an active member of the audience  

## Signed in with a role: the agent half sees the directory's user

✅ `13:24:07` GET /api/e2e-idsurf/app/echo as e2e40-viewer: 200  
✅ `13:24:07` The caller the panel signed: user, the directory's id, the username, the roles  
✅ `13:24:07` …for the agent half's /app/echo  
✅ `13:24:07` The application's Set-Cookie never reaches the browser  
✅ `13:24:07` …nor any X-Lamalibre-* header (the responder signature is the relay's)  
✅ `13:24:07` …every answer is a sandboxed document (CSP)  
✅ `13:24:07` …readable by the bound host's own pages only (CORP)  
✅ `13:24:07` …and no CORS header  
✅ `13:24:07` The agent half's projection holds e2e40-viewer (the feed delivered the entitlement)  
✅ `13:24:08` GET /api/e2e-idsurf/app/me: what the agent half's projection holds of them  
✅ `13:24:08` POST /api/e2e-idsurf/app/me: the agent half's own 405, signed, passes  
✅ `13:24:08` /api/e2e-idsurf/app/nothing: the agent half's own 404  
✅ `13:24:08` e2e40-norole, signed in without a role in the plugin: 403  
✅ `13:24:08` …not entitled  

## What a browser cannot do

✅ `13:24:08` A request another site started (Sec-Fetch-Site: cross-site), even a GET: 403  
✅ `13:24:08` …cross-site request refused  
✅ `13:24:08` POST without an Origin: 403  
✅ `13:24:08` …cross-origin request refused  
✅ `13:24:08` POST from a foreign Origin: 403  
✅ `13:24:08` POST from the bound host's Origin: forwarded  
✅ `13:24:08` …the agent half got the POST, its Origin and all 17 bytes  
✅ `13:24:08` Sent with its own X-Lamalibre-Relay-Assertion, Remote-User and X-Lamalibre-Caller: 200  
✅ `13:24:08` …the caller is still the one Gatekeeper vouched for  
✅ `13:24:08` …no Remote-User or relay assertion reached the agent half  
✅ `13:24:08` …while an ordinary header did  
✅ `13:24:09` The viewer's session cookie, read from the visitor's jar  
✅ `13:24:09` That cookie alone, sent as a header: 200  
✅ `13:24:09` authelia_session presented twice (twice): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `13:24:09` …unauthenticated  
✅ `13:24:09` authelia_session presented twice (empty-first): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `13:24:09` …unauthenticated  
✅ `13:24:09` authelia_session presented twice (planted-after): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `13:24:09` …unauthenticated  
✅ `13:24:09` On the host VM, Gatekeeper vouches for that session (/authz/user-surface/e2e40us.test.lamaste.local)  
✅ `13:24:09` Its assertion, sent to the panel's listener: 200  
✅ `13:24:09` …as e2e40-viewer  
✅ `13:24:09` The same assertion again: 401 — replay refused  
✅ `13:24:09` …unauthenticated  
✅ `13:24:09` An assertion for GET does not carry a POST (401)  
✅ `13:24:10` /api/e2e-idsurf/app/../app/echo: refused (403)  
✅ `13:24:10` /api/e2e-idsurf/app/./echo: refused (403)  
✅ `13:24:10` /api/e2e-idsurf/app/%2e/echo: refused (403)  
✅ `13:24:10` /api/e2e-idsurf/app/a%2fb: refused (403)  
✅ `13:24:10` /api/e2e-idsurf/app/a%5cb: refused (403)  
✅ `13:24:10` /api/e2e-idsurf/app/%252e%252e/echo: refused (403)  
✅ `13:24:10` The agent half saw none of them (its request log)  

## Restricted: a grant for the tunnel is needed too

✅ `13:24:11` The bound tunnel made restricted  
✅ `13:24:14` e2e40-viewer, entitled to the plugin but without a grant for the tunnel: 403  
✅ `13:24:15` e2e40-viewer granted the tunnel  
✅ `13:24:15` …200 with the grant  
✅ `13:24:16` The grant revoked, the tunnel authenticated again  
✅ `13:24:19` e2e40-viewer: 200 again  

## Unbound: the location is gone; bound again: served

✅ `13:24:20` DELETE /api/tunnels/018f717f-55c3-4e2c-bddd-75a3dbd7c30c/user-surface/e2e-idsurf  
✅ `13:24:20` …the tunnel carries no binding  
✅ `13:24:20` Signed in, /api/e2e-idsurf/app/echo reaches the tunnel's own backend again  
✅ `13:24:20` …and without a session Authelia redirects, as for any page of it  
✅ `13:24:21` Bound again: served at once (approved, hosted)  
✅ `13:24:24` e2e40-viewer: the agent half answers again  

## Disabled: refused at once

✅ `13:24:25` Gatekeeper vouches for e2e40-viewer's session once more  
✅ `13:24:25` e2e40-viewer disabled  
✅ `13:24:25` That assertion, still valid, sent to the panel: 403  
✅ `13:24:25` …This user is disabled  
✅ `13:24:25` From the visitor VM: 401 — Authelia ended the disabled user's session, or the panel refuses it  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `121` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `121` |

ℹ️ `13:24:25` Cleaning up test resources...  
