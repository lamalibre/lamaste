# Lamaste E2E: 40 — App plugin user surface (Three-VM)

> Started at `2026-10-25 18:48:32 UTC`


## Pre-flight

✅ `18:48:33` Onboarding is complete  
✅ `18:48:33` Agent test-agent is enrolled on the host  
✅ `18:48:33` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `18:48:33` The agent VM's lamaste-agent has the apphost command  
ℹ️ `18:48:33` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local, bound host e2e40us.test.lamaste.local  
✅ `18:48:34` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `18:48:34` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, the stand-in Feria, the users; the plugin installed, not approved

✅ `18:48:34` Fixture built: @lamalibre/e2e-idsurf-server (identity: viewer, editor; displayName, email) and its agent package  
✅ `18:48:37` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-idsurf-server, @lamalibre/e2e-idsurf-agent )  
✅ `18:48:37` The agent VM reaches it at http://10.13.37.1:4874  
✅ `18:48:38` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-10-25T18:48:39.035Z"})  
✅ `18:48:38` …through its own OIDC client  
✅ `18:48:42` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `18:48:44` User e2e40-viewer created  
✅ `18:48:46` User e2e40-norole created — to hold no role in the plugin  
✅ `18:48:46` Both have a directory id  
✅ `18:48:48` Installed @lamalibre/e2e-idsurf-server@1.0.0  
✅ `18:48:48` …its identity block waits for approval  
✅ `18:48:48` Hosting it is refused until it is approved (409)  
✅ `18:48:48` …hooks_not_approved  

## An authenticated app tunnel with its own backend, and two others

✅ `18:48:49` Tunnel e2e40us.test.lamaste.local: authenticated, carried by test-agent  
✅ `18:48:50` Tunnel e2e40pub: public  
✅ `18:48:50` Tunnel e2e40two: authenticated  
✅ `18:48:54` The tunnel's own backend answers through chisel (/api/e2e-idsurf/app/echo is a file of it)  

## Not hosted, not bound: the refusals; requests go down the tunnel

✅ `18:48:54` A route no installed plugin holds cannot be bound (400)  
✅ `18:48:55` Not hosted on the agent carrying the tunnel, the plugin cannot be bound (400)  
✅ `18:48:55` …Plugin 'e2e-idsurf' is not hosted on an agent — host it on the agent that carries this tunnel ('test-agent') first  
✅ `18:48:55` …the tunnel carries no binding  
✅ `18:48:55` Without a session: Authelia's redirect, as for any page of the tunnel  
✅ `18:48:55` …to the sign-in portal  
✅ `18:49:03` e2e40-viewer signed in from the visitor VM (password, TOTP)  
✅ `18:49:04` e2e40-norole signed in from the visitor VM  
✅ `18:49:05` Signed in: 200  
✅ `18:49:05` …from the tunnel's own backend: no user-surface location  
✅ `18:49:05` The viewer's session cookie, read from the visitor's jar  
✅ `18:49:05` Signed in with two other cookies around the session: the backend gets both, never authelia_session  
✅ `18:49:05` …the session first: the other alone  
✅ `18:49:05` …the session alone: no Cookie header at all  

## Approved and hosted on the tunnel's agent; bound, its users are let through

✅ `18:49:05` Approved: its agent half and identity block  
✅ `18:49:16` Hosted on test-agent ()  
✅ `18:49:29` The relay's health of the hosting is up  
✅ `18:49:29` Ready: its agent half's first complete sync ended at the head  
✅ `18:49:30` PUT /api/tunnels/d2cb577e-4b7b-4f3b-bafb-16fb84cad8f8/user-surface {route: e2e-idsurf}  
✅ `18:49:30` …bound  
✅ `18:49:30` …served at once: approved, declares identity, hosted by the tunnel's agent  
✅ `18:49:30` Binding it again changes nothing  
✅ `18:49:30` A public tunnel cannot be bound (400)  
✅ `18:49:30` …A public tunnel has no signed-in user to vouch for — make it authenticated or restricted first  
✅ `18:49:31` A second tunnel for the same route is refused (409)  
✅ `18:49:31` …user_surface_conflict  
✅ `18:49:31` The bound tunnel cannot be made public (409)  
✅ `18:49:31` …it stays authenticated  
✅ `18:49:31` Without a session: 401  
✅ `18:49:31` …JSON (unauthenticated) for the application to act on  
✅ `18:49:31` …never a redirect  
✅ `18:49:31` e2e40-viewer, before any entitlement: 403  
✅ `18:49:31` …not entitled  
✅ `18:49:31` e2e40-viewer entitled as viewer  
✅ `18:49:32` …an active member of the audience  

## Signed in with a role: the agent half sees the directory's user

✅ `18:49:32` GET /api/e2e-idsurf/app/echo as e2e40-viewer: 200  
✅ `18:49:32` The caller the panel signed: user, the directory's id, the username, the roles  
✅ `18:49:32` …for the agent half's /app/echo  
✅ `18:49:32` The application's Set-Cookie never reaches the browser  
✅ `18:49:32` …nor any X-Lamalibre-* header (the responder signature is the relay's)  
✅ `18:49:32` …every answer is a sandboxed document (CSP)  
✅ `18:49:32` …readable by the bound host's own pages only (CORP)  
✅ `18:49:32` …and no CORS header  
✅ `18:49:32` The agent half's projection holds e2e40-viewer (the feed delivered the entitlement)  
✅ `18:49:32` GET /api/e2e-idsurf/app/me: what the agent half's projection holds of them  
✅ `18:49:32` POST /api/e2e-idsurf/app/me: the agent half's own 405, signed, passes  
✅ `18:49:32` /api/e2e-idsurf/app/nothing: the agent half's own 404  
✅ `18:49:32` e2e40-norole, signed in without a role in the plugin: 403  
✅ `18:49:32` …not entitled  

## What a browser cannot do

✅ `18:49:32` A request another site started (Sec-Fetch-Site: cross-site), even a GET: 403  
✅ `18:49:32` …cross-site request refused  
✅ `18:49:33` POST without an Origin: 403  
✅ `18:49:33` …cross-origin request refused  
✅ `18:49:33` POST from a foreign Origin: 403  
✅ `18:49:33` POST from the bound host's Origin: forwarded  
✅ `18:49:33` …the agent half got the POST, its Origin and all 17 bytes  
✅ `18:49:33` Sent with its own X-Lamalibre-Relay-Assertion, Remote-User and X-Lamalibre-Caller: 200  
✅ `18:49:33` …the caller is still the one Gatekeeper vouched for  
✅ `18:49:33` …no Remote-User or relay assertion reached the agent half  
✅ `18:49:33` …while an ordinary header did  
✅ `18:49:33` The viewer's session cookie, read from the visitor's jar  
✅ `18:49:33` That cookie alone, sent as a header: 200  
✅ `18:49:33` authelia_session presented twice (twice): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `18:49:33` …unauthenticated  
✅ `18:49:33` authelia_session presented twice (empty-first): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `18:49:33` …unauthenticated  
✅ `18:49:34` authelia_session presented twice (planted-after): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `18:49:34` …unauthenticated  
✅ `18:49:34` On the host VM, Gatekeeper vouches for that session (/authz/user-surface/e2e40us.test.lamaste.local)  
✅ `18:49:34` Its assertion, sent to the panel's listener: 200  
✅ `18:49:34` …as e2e40-viewer  
✅ `18:49:34` The same assertion again: 401 — replay refused  
✅ `18:49:34` …unauthenticated  
✅ `18:49:34` An assertion for GET does not carry a POST (401)  
✅ `18:49:35` /api/e2e-idsurf/app/../app/echo: refused (403)  
✅ `18:49:35` /api/e2e-idsurf/app/./echo: refused (403)  
✅ `18:49:35` /api/e2e-idsurf/app/%2e/echo: refused (403)  
✅ `18:49:35` /api/e2e-idsurf/app/a%2fb: refused (403)  
✅ `18:49:35` /api/e2e-idsurf/app/a%5cb: refused (403)  
✅ `18:49:35` /api/e2e-idsurf/app/%252e%252e/echo: refused (403)  
✅ `18:49:35` The agent half saw none of them (its request log)  

## Restricted: a grant for the tunnel is needed too

✅ `18:49:36` The bound tunnel made restricted  
✅ `18:49:40` e2e40-viewer, entitled to the plugin but without a grant for the tunnel: 403  
✅ `18:49:40` e2e40-viewer granted the tunnel  
✅ `18:49:40` …200 with the grant  
✅ `18:49:41` The grant revoked, the tunnel authenticated again  
✅ `18:49:45` e2e40-viewer: 200 again  

## Unbound: the location is gone; bound again: served

✅ `18:49:46` DELETE /api/tunnels/d2cb577e-4b7b-4f3b-bafb-16fb84cad8f8/user-surface/e2e-idsurf  
✅ `18:49:46` …the tunnel carries no binding  
✅ `18:49:46` Signed in, /api/e2e-idsurf/app/echo reaches the tunnel's own backend again  
✅ `18:49:46` …and without a session Authelia redirects, as for any page of it  
✅ `18:49:47` Bound again: served at once (approved, hosted)  
✅ `18:49:47` e2e40-viewer: the agent half answers again  

## Disabled: refused at once

✅ `18:49:47` Gatekeeper vouches for e2e40-viewer's session once more  
✅ `18:49:48` e2e40-viewer disabled  
✅ `18:49:48` That assertion, still valid, sent to the panel: 403  
✅ `18:49:48` …This user is disabled  
✅ `18:49:48` From the visitor VM: 401 — the session ended with Authelia's restart, or the panel refuses it  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `121` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `121` |

ℹ️ `18:49:48` Cleaning up test resources...  
