# Lamaste E2E: 40 — App plugin user surface (Three-VM)

> Started at `2026-11-10 08:06:05 UTC`


## Pre-flight

✅ `08:06:06` Onboarding is complete  
✅ `08:06:06` Agent test-agent is enrolled on the host  
✅ `08:06:06` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `08:06:06` The agent VM's lamaste-agent has the apphost command  
ℹ️ `08:06:06` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local, bound host e2e40us.test.lamaste.local  
✅ `08:06:07` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `08:06:07` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, the stand-in Feria, the users; the plugin installed, not approved

✅ `08:06:08` Fixture built: @lamalibre/e2e-idsurf-server (identity: viewer, editor; displayName, email) and its agent package  
✅ `08:06:16` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-idsurf-server, @lamalibre/e2e-idsurf-agent )  
✅ `08:06:17` The agent VM reaches it at http://10.13.37.1:4874  
✅ `08:06:18` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T08:06:18.264Z"})  
✅ `08:06:18` …through its own OIDC client  
✅ `08:06:22` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `08:06:23` User e2e40-viewer created  
✅ `08:06:24` User e2e40-norole created — to hold no role in the plugin  
✅ `08:06:24` Both have a directory id  
✅ `08:06:29` Installed @lamalibre/e2e-idsurf-server@1.0.0  
✅ `08:06:29` …its identity block waits for approval  
✅ `08:06:29` Hosting it is refused until it is approved (409)  
✅ `08:06:29` …hooks_not_approved  

## An authenticated app tunnel with its own backend, and two others

✅ `08:06:30` Tunnel e2e40us.test.lamaste.local: authenticated, carried by test-agent  
✅ `08:06:30` Tunnel e2e40pub: public  
✅ `08:06:31` Tunnel e2e40two: authenticated  
✅ `08:06:35` The tunnel's own backend answers through chisel (/api/e2e-idsurf/app/echo is a file of it)  

## Not hosted, not bound: the refusals; requests go down the tunnel

✅ `08:06:35` A route no installed plugin holds cannot be bound (400)  
✅ `08:06:36` Not hosted on the agent carrying the tunnel, the plugin cannot be bound (400)  
✅ `08:06:36` …Plugin 'e2e-idsurf' is not hosted on an agent — host it on the agent that carries this tunnel ('test-agent') first  
✅ `08:06:36` …the tunnel carries no binding  
✅ `08:06:36` Without a session: Authelia's redirect, as for any page of the tunnel  
✅ `08:06:36` …to the sign-in portal  
✅ `08:07:03` e2e40-viewer signed in from the visitor VM (password, TOTP)  
✅ `08:07:05` e2e40-norole signed in from the visitor VM  
✅ `08:07:05` Signed in: 200  
✅ `08:07:05` …from the tunnel's own backend: no user-surface location  
✅ `08:07:05` The viewer's session cookie, read from the visitor's jar  
✅ `08:07:05` Signed in with two other cookies around the session: the backend gets both, never authelia_session  
✅ `08:07:05` …the session first: the other alone  
✅ `08:07:05` …the session alone: no Cookie header at all  

## Approved and hosted on the tunnel's agent; bound, its users are let through

✅ `08:07:06` Approved: its agent half and identity block  
✅ `08:07:17` Hosted on test-agent ()  
✅ `08:07:33` The relay's health of the hosting is up  
✅ `08:07:33` Ready: its agent half's first complete sync ended at the head  
✅ `08:07:34` PUT /api/tunnels/6d5265b7-2d4e-4047-a73c-fcbbf5ab9876/user-surface {route: e2e-idsurf}  
✅ `08:07:34` …bound  
✅ `08:07:34` …served at once: approved, declares identity, hosted by the tunnel's agent  
✅ `08:07:34` Binding it again changes nothing  
✅ `08:07:34` A public tunnel cannot be bound (400)  
✅ `08:07:34` …A public tunnel has no signed-in user to vouch for — make it authenticated or restricted first  
✅ `08:07:34` A second tunnel for the same route is refused (409)  
✅ `08:07:34` …user_surface_conflict  
✅ `08:07:34` The bound tunnel cannot be made public (409)  
✅ `08:07:34` …it stays authenticated  
✅ `08:07:35` Without a session: 401  
✅ `08:07:35` …JSON (unauthenticated) for the application to act on  
✅ `08:07:35` …never a redirect  
✅ `08:07:35` e2e40-viewer, before any entitlement: 403  
✅ `08:07:35` …not entitled  
✅ `08:07:36` e2e40-viewer entitled as viewer  
✅ `08:07:36` …an active member of the audience  

## Signed in with a role: the agent half sees the directory's user

✅ `08:07:36` GET /api/e2e-idsurf/app/echo as e2e40-viewer: 200  
✅ `08:07:36` The caller the panel signed: user, the directory's id, the username, the roles  
✅ `08:07:36` …for the agent half's /app/echo  
✅ `08:07:36` The application's Set-Cookie never reaches the browser  
✅ `08:07:36` …nor any X-Lamalibre-* header (the responder signature is the relay's)  
✅ `08:07:36` …every answer is a sandboxed document (CSP)  
✅ `08:07:36` …readable by the bound host's own pages only (CORP)  
✅ `08:07:36` …and no CORS header  
✅ `08:07:36` The agent half's projection holds e2e40-viewer (the feed delivered the entitlement)  
✅ `08:07:36` GET /api/e2e-idsurf/app/me: what the agent half's projection holds of them  
✅ `08:07:36` POST /api/e2e-idsurf/app/me: the agent half's own 405, signed, passes  
✅ `08:07:37` /api/e2e-idsurf/app/nothing: the agent half's own 404  
✅ `08:07:37` e2e40-norole, signed in without a role in the plugin: 403  
✅ `08:07:37` …not entitled  

## What a browser cannot do

✅ `08:07:37` A request another site started (Sec-Fetch-Site: cross-site), even a GET: 403  
✅ `08:07:37` …cross-site request refused  
✅ `08:07:37` POST without an Origin: 403  
✅ `08:07:37` …cross-origin request refused  
✅ `08:07:37` POST from a foreign Origin: 403  
✅ `08:07:37` POST from the bound host's Origin: forwarded  
✅ `08:07:37` …the agent half got the POST, its Origin and all 17 bytes  
✅ `08:07:37` Sent with its own X-Lamalibre-Relay-Assertion, Remote-User and X-Lamalibre-Caller: 200  
✅ `08:07:37` …the caller is still the one Gatekeeper vouched for  
✅ `08:07:37` …no Remote-User or relay assertion reached the agent half  
✅ `08:07:38` …while an ordinary header did  
✅ `08:07:38` The viewer's session cookie, read from the visitor's jar  
✅ `08:07:38` That cookie alone, sent as a header: 200  
✅ `08:07:38` authelia_session presented twice (twice): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `08:07:38` …unauthenticated  
✅ `08:07:38` authelia_session presented twice (empty-first): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `08:07:38` …unauthenticated  
✅ `08:07:38` authelia_session presented twice (planted-after): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `08:07:38` …unauthenticated  
✅ `08:07:38` On the host VM, Gatekeeper vouches for that session (/authz/user-surface/e2e40us.test.lamaste.local)  
✅ `08:07:39` Its assertion, sent to the panel's listener: 200  
✅ `08:07:39` …as e2e40-viewer  
✅ `08:07:39` The same assertion again: 401 — replay refused  
✅ `08:07:39` …unauthenticated  
✅ `08:07:39` An assertion for GET does not carry a POST (401)  
✅ `08:07:39` /api/e2e-idsurf/app/../app/echo: refused (403)  
✅ `08:07:39` /api/e2e-idsurf/app/./echo: refused (403)  
✅ `08:07:39` /api/e2e-idsurf/app/%2e/echo: refused (403)  
✅ `08:07:40` /api/e2e-idsurf/app/a%2fb: refused (403)  
✅ `08:07:40` /api/e2e-idsurf/app/a%5cb: refused (403)  
✅ `08:07:40` /api/e2e-idsurf/app/%252e%252e/echo: refused (403)  
✅ `08:07:40` The agent half saw none of them (its request log)  

## Restricted: a grant for the tunnel is needed too

✅ `08:07:41` The bound tunnel made restricted  
✅ `08:07:44` e2e40-viewer, entitled to the plugin but without a grant for the tunnel: 403  
✅ `08:07:44` e2e40-viewer granted the tunnel  
✅ `08:07:45` …200 with the grant  
✅ `08:07:45` The grant revoked, the tunnel authenticated again  
✅ `08:07:49` e2e40-viewer: 200 again  

## Unbound: the location is gone; bound again: served

✅ `08:07:49` DELETE /api/tunnels/6d5265b7-2d4e-4047-a73c-fcbbf5ab9876/user-surface/e2e-idsurf  
✅ `08:07:50` …the tunnel carries no binding  
✅ `08:07:50` Signed in, /api/e2e-idsurf/app/echo reaches the tunnel's own backend again  
✅ `08:07:50` …and without a session Authelia redirects, as for any page of it  
✅ `08:07:51` Bound again: served at once (approved, hosted)  
✅ `08:07:54` e2e40-viewer: the agent half answers again  

## Disabled: refused at once

✅ `08:07:54` Gatekeeper vouches for e2e40-viewer's session once more  
✅ `08:07:54` e2e40-viewer disabled  
✅ `08:07:55` That assertion, still valid, sent to the panel: 403  
✅ `08:07:55` …This user is disabled  
✅ `08:07:55` From the visitor VM: 401 — Authelia ended the disabled user's session, or the panel refuses it  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `121` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `121` |

ℹ️ `08:07:55` Cleaning up test resources...  
