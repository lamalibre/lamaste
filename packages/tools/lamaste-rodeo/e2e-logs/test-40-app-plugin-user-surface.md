# Lamaste E2E: 40 — App plugin user surface (Three-VM)

> Started at `2026-11-02 16:28:28 UTC`


## Pre-flight

✅ `16:28:28` Onboarding is complete  
✅ `16:28:28` Agent test-agent is enrolled on the host  
✅ `16:28:28` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `16:28:29` The agent VM's lamaste-agent has the apphost command  
ℹ️ `16:28:29` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local, bound host e2e40us.test.lamaste.local  
✅ `16:28:29` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `16:28:29` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, the stand-in Feria, the users; the plugin installed, not approved

✅ `16:28:29` Fixture built: @lamalibre/e2e-idsurf-server (identity: viewer, editor; displayName, email) and its agent package  
✅ `16:28:32` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-idsurf-server, @lamalibre/e2e-idsurf-agent )  
✅ `16:28:32` The agent VM reaches it at http://10.13.37.1:4874  
✅ `16:28:33` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-02T16:28:34.055Z"})  
✅ `16:28:33` …through its own OIDC client  
✅ `16:28:34` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `16:28:35` User e2e40-viewer created  
✅ `16:28:35` User e2e40-norole created — to hold no role in the plugin  
✅ `16:28:35` Both have a directory id  
✅ `16:28:37` Installed @lamalibre/e2e-idsurf-server@1.0.0  
✅ `16:28:37` …its identity block waits for approval  
✅ `16:28:37` Hosting it is refused until it is approved (409)  
✅ `16:28:37` …hooks_not_approved  

## An authenticated app tunnel with its own backend, and two others

✅ `16:28:38` Tunnel e2e40us.test.lamaste.local: authenticated, carried by test-agent  
✅ `16:28:39` Tunnel e2e40pub: public  
✅ `16:28:40` Tunnel e2e40two: authenticated  
✅ `16:28:44` The tunnel's own backend answers through chisel (/api/e2e-idsurf/app/echo is a file of it)  

## Not hosted, not bound: the refusals; requests go down the tunnel

✅ `16:28:44` A route no installed plugin holds cannot be bound (400)  
✅ `16:28:44` Not hosted on the agent carrying the tunnel, the plugin cannot be bound (400)  
✅ `16:28:44` …Plugin 'e2e-idsurf' is not hosted on an agent — host it on the agent that carries this tunnel ('test-agent') first  
✅ `16:28:45` …the tunnel carries no binding  
✅ `16:28:45` Without a session: Authelia's redirect, as for any page of the tunnel  
✅ `16:28:45` …to the sign-in portal  
✅ `16:29:03` e2e40-viewer signed in from the visitor VM (password, TOTP)  
✅ `16:29:04` e2e40-norole signed in from the visitor VM  
✅ `16:29:04` Signed in: 200  
✅ `16:29:04` …from the tunnel's own backend: no user-surface location  
✅ `16:29:04` The viewer's session cookie, read from the visitor's jar  
✅ `16:29:05` Signed in with two other cookies around the session: the backend gets both, never authelia_session  
✅ `16:29:05` …the session first: the other alone  
✅ `16:29:05` …the session alone: no Cookie header at all  

## Approved and hosted on the tunnel's agent; bound, its users are let through

✅ `16:29:05` Approved: its agent half and identity block  
✅ `16:29:16` Hosted on test-agent ()  
✅ `16:29:29` The relay's health of the hosting is up  
✅ `16:29:29` Ready: its agent half's first complete sync ended at the head  
✅ `16:29:30` PUT /api/tunnels/d88af10c-06f1-4f3f-97bb-76f80758fb5f/user-surface {route: e2e-idsurf}  
✅ `16:29:30` …bound  
✅ `16:29:30` …served at once: approved, declares identity, hosted by the tunnel's agent  
✅ `16:29:30` Binding it again changes nothing  
✅ `16:29:30` A public tunnel cannot be bound (400)  
✅ `16:29:30` …A public tunnel has no signed-in user to vouch for — make it authenticated or restricted first  
✅ `16:29:30` A second tunnel for the same route is refused (409)  
✅ `16:29:30` …user_surface_conflict  
✅ `16:29:31` The bound tunnel cannot be made public (409)  
✅ `16:29:31` …it stays authenticated  
✅ `16:29:31` Without a session: 401  
✅ `16:29:31` …JSON (unauthenticated) for the application to act on  
✅ `16:29:31` …never a redirect  
✅ `16:29:31` e2e40-viewer, before any entitlement: 403  
✅ `16:29:31` …not entitled  
✅ `16:29:31` e2e40-viewer entitled as viewer  
✅ `16:29:31` …an active member of the audience  

## Signed in with a role: the agent half sees the directory's user

✅ `16:29:31` GET /api/e2e-idsurf/app/echo as e2e40-viewer: 200  
✅ `16:29:31` The caller the panel signed: user, the directory's id, the username, the roles  
✅ `16:29:31` …for the agent half's /app/echo  
✅ `16:29:31` The application's Set-Cookie never reaches the browser  
✅ `16:29:32` …nor any X-Lamalibre-* header (the responder signature is the relay's)  
✅ `16:29:32` …every answer is a sandboxed document (CSP)  
✅ `16:29:32` …readable by the bound host's own pages only (CORP)  
✅ `16:29:32` …and no CORS header  
✅ `16:29:32` The agent half's projection holds e2e40-viewer (the feed delivered the entitlement)  
✅ `16:29:32` GET /api/e2e-idsurf/app/me: what the agent half's projection holds of them  
✅ `16:29:32` POST /api/e2e-idsurf/app/me: the agent half's own 405, signed, passes  
✅ `16:29:32` /api/e2e-idsurf/app/nothing: the agent half's own 404  
✅ `16:29:32` e2e40-norole, signed in without a role in the plugin: 403  
✅ `16:29:32` …not entitled  

## What a browser cannot do

✅ `16:29:32` A request another site started (Sec-Fetch-Site: cross-site), even a GET: 403  
✅ `16:29:32` …cross-site request refused  
✅ `16:29:32` POST without an Origin: 403  
✅ `16:29:32` …cross-origin request refused  
✅ `16:29:32` POST from a foreign Origin: 403  
✅ `16:29:32` POST from the bound host's Origin: forwarded  
✅ `16:29:32` …the agent half got the POST, its Origin and all 17 bytes  
✅ `16:29:33` Sent with its own X-Lamalibre-Relay-Assertion, Remote-User and X-Lamalibre-Caller: 200  
✅ `16:29:33` …the caller is still the one Gatekeeper vouched for  
✅ `16:29:33` …no Remote-User or relay assertion reached the agent half  
✅ `16:29:33` …while an ordinary header did  
✅ `16:29:33` The viewer's session cookie, read from the visitor's jar  
✅ `16:29:33` That cookie alone, sent as a header: 200  
✅ `16:29:33` authelia_session presented twice (twice): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `16:29:33` …unauthenticated  
✅ `16:29:33` authelia_session presented twice (empty-first): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `16:29:33` …unauthenticated  
✅ `16:29:33` authelia_session presented twice (planted-after): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `16:29:33` …unauthenticated  
✅ `16:29:33` On the host VM, Gatekeeper vouches for that session (/authz/user-surface/e2e40us.test.lamaste.local)  
✅ `16:29:33` Its assertion, sent to the panel's listener: 200  
✅ `16:29:33` …as e2e40-viewer  
✅ `16:29:33` The same assertion again: 401 — replay refused  
✅ `16:29:33` …unauthenticated  
✅ `16:29:34` An assertion for GET does not carry a POST (401)  
✅ `16:29:34` /api/e2e-idsurf/app/../app/echo: refused (403)  
✅ `16:29:34` /api/e2e-idsurf/app/./echo: refused (403)  
✅ `16:29:34` /api/e2e-idsurf/app/%2e/echo: refused (403)  
✅ `16:29:34` /api/e2e-idsurf/app/a%2fb: refused (403)  
✅ `16:29:34` /api/e2e-idsurf/app/a%5cb: refused (403)  
✅ `16:29:34` /api/e2e-idsurf/app/%252e%252e/echo: refused (403)  
✅ `16:29:35` The agent half saw none of them (its request log)  

## Restricted: a grant for the tunnel is needed too

✅ `16:29:35` The bound tunnel made restricted  
✅ `16:29:39` e2e40-viewer, entitled to the plugin but without a grant for the tunnel: 403  
✅ `16:29:39` e2e40-viewer granted the tunnel  
✅ `16:29:39` …200 with the grant  
✅ `16:29:40` The grant revoked, the tunnel authenticated again  
✅ `16:29:43` e2e40-viewer: 200 again  

## Unbound: the location is gone; bound again: served

✅ `16:29:44` DELETE /api/tunnels/d88af10c-06f1-4f3f-97bb-76f80758fb5f/user-surface/e2e-idsurf  
✅ `16:29:44` …the tunnel carries no binding  
✅ `16:29:45` Signed in, /api/e2e-idsurf/app/echo reaches the tunnel's own backend again  
✅ `16:29:45` …and without a session Authelia redirects, as for any page of it  
✅ `16:29:46` Bound again: served at once (approved, hosted)  
✅ `16:29:49` e2e40-viewer: the agent half answers again  

## Disabled: refused at once

✅ `16:29:49` Gatekeeper vouches for e2e40-viewer's session once more  
✅ `16:29:49` e2e40-viewer disabled  
✅ `16:29:49` That assertion, still valid, sent to the panel: 403  
✅ `16:29:49` …This user is disabled  
✅ `16:29:49` From the visitor VM: 401 — Authelia ended the disabled user's session, or the panel refuses it  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `121` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `121` |

ℹ️ `16:29:49` Cleaning up test resources...  
