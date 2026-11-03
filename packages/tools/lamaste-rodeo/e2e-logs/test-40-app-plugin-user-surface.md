# Lamaste E2E: 40 — App plugin user surface (Three-VM)

> Started at `2026-11-03 10:11:06 UTC`


## Pre-flight

✅ `10:11:06` Onboarding is complete  
✅ `10:11:06` Agent test-agent is enrolled on the host  
✅ `10:11:07` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:11:07` The agent VM's lamaste-agent has the apphost command  
ℹ️ `10:11:07` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local, bound host e2e40us.test.lamaste.local  
✅ `10:11:07` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `10:11:07` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, the stand-in Feria, the users; the plugin installed, not approved

✅ `10:11:08` Fixture built: @lamalibre/e2e-idsurf-server (identity: viewer, editor; displayName, email) and its agent package  
✅ `10:11:16` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-idsurf-server, @lamalibre/e2e-idsurf-agent )  
✅ `10:11:17` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:11:18` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T10:11:18.164Z"})  
✅ `10:11:18` …through its own OIDC client  
✅ `10:11:18` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:11:19` User e2e40-viewer created  
✅ `10:11:20` User e2e40-norole created — to hold no role in the plugin  
✅ `10:11:20` Both have a directory id  
✅ `10:11:24` Installed @lamalibre/e2e-idsurf-server@1.0.0  
✅ `10:11:24` …its identity block waits for approval  
✅ `10:11:24` Hosting it is refused until it is approved (409)  
✅ `10:11:24` …hooks_not_approved  

## An authenticated app tunnel with its own backend, and two others

✅ `10:11:25` Tunnel e2e40us.test.lamaste.local: authenticated, carried by test-agent  
✅ `10:11:26` Tunnel e2e40pub: public  
✅ `10:11:27` Tunnel e2e40two: authenticated  
✅ `10:11:31` The tunnel's own backend answers through chisel (/api/e2e-idsurf/app/echo is a file of it)  

## Not hosted, not bound: the refusals; requests go down the tunnel

✅ `10:11:31` A route no installed plugin holds cannot be bound (400)  
✅ `10:11:32` Not hosted on the agent carrying the tunnel, the plugin cannot be bound (400)  
✅ `10:11:32` …Plugin 'e2e-idsurf' is not hosted on an agent — host it on the agent that carries this tunnel ('test-agent') first  
✅ `10:11:32` …the tunnel carries no binding  
✅ `10:11:32` Without a session: Authelia's redirect, as for any page of the tunnel  
✅ `10:11:32` …to the sign-in portal  
✅ `10:12:03` e2e40-viewer signed in from the visitor VM (password, TOTP)  
✅ `10:12:04` e2e40-norole signed in from the visitor VM  
✅ `10:12:05` Signed in: 200  
✅ `10:12:05` …from the tunnel's own backend: no user-surface location  
✅ `10:12:05` The viewer's session cookie, read from the visitor's jar  
✅ `10:12:05` Signed in with two other cookies around the session: the backend gets both, never authelia_session  
✅ `10:12:05` …the session first: the other alone  
✅ `10:12:05` …the session alone: no Cookie header at all  

## Approved and hosted on the tunnel's agent; bound, its users are let through

✅ `10:12:05` Approved: its agent half and identity block  
✅ `10:12:16` Hosted on test-agent ()  
✅ `10:12:33` The relay's health of the hosting is up  
✅ `10:12:33` Ready: its agent half's first complete sync ended at the head  
✅ `10:12:34` PUT /api/tunnels/c9560d2f-dfb8-44cf-8bb2-6f7072dbe640/user-surface {route: e2e-idsurf}  
✅ `10:12:34` …bound  
✅ `10:12:34` …served at once: approved, declares identity, hosted by the tunnel's agent  
✅ `10:12:34` Binding it again changes nothing  
✅ `10:12:35` A public tunnel cannot be bound (400)  
✅ `10:12:35` …A public tunnel has no signed-in user to vouch for — make it authenticated or restricted first  
✅ `10:12:35` A second tunnel for the same route is refused (409)  
✅ `10:12:35` …user_surface_conflict  
✅ `10:12:35` The bound tunnel cannot be made public (409)  
✅ `10:12:35` …it stays authenticated  
✅ `10:12:35` Without a session: 401  
✅ `10:12:35` …JSON (unauthenticated) for the application to act on  
✅ `10:12:35` …never a redirect  
✅ `10:12:35` e2e40-viewer, before any entitlement: 403  
✅ `10:12:35` …not entitled  
✅ `10:12:36` e2e40-viewer entitled as viewer  
✅ `10:12:36` …an active member of the audience  

## Signed in with a role: the agent half sees the directory's user

✅ `10:12:36` GET /api/e2e-idsurf/app/echo as e2e40-viewer: 200  
✅ `10:12:36` The caller the panel signed: user, the directory's id, the username, the roles  
✅ `10:12:36` …for the agent half's /app/echo  
✅ `10:12:36` The application's Set-Cookie never reaches the browser  
✅ `10:12:36` …nor any X-Lamalibre-* header (the responder signature is the relay's)  
✅ `10:12:36` …every answer is a sandboxed document (CSP)  
✅ `10:12:36` …readable by the bound host's own pages only (CORP)  
✅ `10:12:36` …and no CORS header  
✅ `10:12:36` The agent half's projection holds e2e40-viewer (the feed delivered the entitlement)  
✅ `10:12:36` GET /api/e2e-idsurf/app/me: what the agent half's projection holds of them  
✅ `10:12:36` POST /api/e2e-idsurf/app/me: the agent half's own 405, signed, passes  
✅ `10:12:36` /api/e2e-idsurf/app/nothing: the agent half's own 404  
✅ `10:12:36` e2e40-norole, signed in without a role in the plugin: 403  
✅ `10:12:36` …not entitled  

## What a browser cannot do

✅ `10:12:36` A request another site started (Sec-Fetch-Site: cross-site), even a GET: 403  
✅ `10:12:36` …cross-site request refused  
✅ `10:12:37` POST without an Origin: 403  
✅ `10:12:37` …cross-origin request refused  
✅ `10:12:37` POST from a foreign Origin: 403  
✅ `10:12:37` POST from the bound host's Origin: forwarded  
✅ `10:12:37` …the agent half got the POST, its Origin and all 17 bytes  
✅ `10:12:37` Sent with its own X-Lamalibre-Relay-Assertion, Remote-User and X-Lamalibre-Caller: 200  
✅ `10:12:37` …the caller is still the one Gatekeeper vouched for  
✅ `10:12:37` …no Remote-User or relay assertion reached the agent half  
✅ `10:12:37` …while an ordinary header did  
✅ `10:12:37` The viewer's session cookie, read from the visitor's jar  
✅ `10:12:37` That cookie alone, sent as a header: 200  
✅ `10:12:37` authelia_session presented twice (twice): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `10:12:37` …unauthenticated  
✅ `10:12:37` authelia_session presented twice (empty-first): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `10:12:37` …unauthenticated  
✅ `10:12:37` authelia_session presented twice (planted-after): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `10:12:37` …unauthenticated  
✅ `10:12:38` On the host VM, Gatekeeper vouches for that session (/authz/user-surface/e2e40us.test.lamaste.local)  
✅ `10:12:38` Its assertion, sent to the panel's listener: 200  
✅ `10:12:38` …as e2e40-viewer  
✅ `10:12:38` The same assertion again: 401 — replay refused  
✅ `10:12:38` …unauthenticated  
✅ `10:12:38` An assertion for GET does not carry a POST (401)  
✅ `10:12:38` /api/e2e-idsurf/app/../app/echo: refused (403)  
✅ `10:12:38` /api/e2e-idsurf/app/./echo: refused (403)  
✅ `10:12:39` /api/e2e-idsurf/app/%2e/echo: refused (403)  
✅ `10:12:39` /api/e2e-idsurf/app/a%2fb: refused (403)  
✅ `10:12:39` /api/e2e-idsurf/app/a%5cb: refused (403)  
✅ `10:12:39` /api/e2e-idsurf/app/%252e%252e/echo: refused (403)  
✅ `10:12:39` The agent half saw none of them (its request log)  

## Restricted: a grant for the tunnel is needed too

✅ `10:12:40` The bound tunnel made restricted  
✅ `10:12:43` e2e40-viewer, entitled to the plugin but without a grant for the tunnel: 403  
✅ `10:12:43` e2e40-viewer granted the tunnel  
✅ `10:12:44` …200 with the grant  
✅ `10:12:45` The grant revoked, the tunnel authenticated again  
✅ `10:12:48` e2e40-viewer: 200 again  

## Unbound: the location is gone; bound again: served

✅ `10:12:49` DELETE /api/tunnels/c9560d2f-dfb8-44cf-8bb2-6f7072dbe640/user-surface/e2e-idsurf  
✅ `10:12:49` …the tunnel carries no binding  
✅ `10:12:49` Signed in, /api/e2e-idsurf/app/echo reaches the tunnel's own backend again  
✅ `10:12:49` …and without a session Authelia redirects, as for any page of it  
✅ `10:12:50` Bound again: served at once (approved, hosted)  
✅ `10:12:50` e2e40-viewer: the agent half answers again  

## Disabled: refused at once

✅ `10:12:51` Gatekeeper vouches for e2e40-viewer's session once more  
✅ `10:12:51` e2e40-viewer disabled  
✅ `10:12:51` That assertion, still valid, sent to the panel: 403  
✅ `10:12:51` …This user is disabled  
✅ `10:12:51` From the visitor VM: 401 — Authelia ended the disabled user's session, or the panel refuses it  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `121` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `121` |

ℹ️ `10:12:51` Cleaning up test resources...  
