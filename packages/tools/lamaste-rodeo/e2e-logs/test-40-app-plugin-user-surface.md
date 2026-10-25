# Lamaste E2E: 40 — App plugin user surface (Three-VM)

> Started at `2026-10-25 17:43:23 UTC`


## Pre-flight

✅ `17:43:24` Onboarding is complete  
✅ `17:43:24` Agent test-agent is enrolled on the host  
✅ `17:43:24` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `17:43:24` The agent VM's lamaste-agent has the apphost command  
ℹ️ `17:43:24` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local, bound host e2e40us.test.lamaste.local  
✅ `17:43:24` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `17:43:25` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, the stand-in Feria, the users; the plugin installed, not approved

✅ `17:43:25` Fixture built: @lamalibre/e2e-idsurf-server (identity: viewer, editor; displayName, email) and its agent package  
✅ `17:43:28` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-idsurf-server, @lamalibre/e2e-idsurf-agent )  
✅ `17:43:28` The agent VM reaches it at http://10.13.37.1:4874  
✅ `17:43:30` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-10-25T17:43:31.318Z"})  
✅ `17:43:30` …through its own OIDC client  
✅ `17:43:34` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `17:43:38` User e2e40-viewer created  
✅ `17:43:40` User e2e40-norole created — to hold no role in the plugin  
✅ `17:43:40` Both have a directory id  
✅ `17:43:42` Installed @lamalibre/e2e-idsurf-server@1.0.0  
✅ `17:43:42` …its identity block waits for approval  
✅ `17:43:43` Hosting it is refused until it is approved (409)  
✅ `17:43:43` …hooks_not_approved  

## An authenticated app tunnel with its own backend, and two others

✅ `17:43:44` Tunnel e2e40us.test.lamaste.local: authenticated, carried by test-agent  
✅ `17:43:45` Tunnel e2e40pub: public  
✅ `17:43:46` Tunnel e2e40two: authenticated  
✅ `17:43:50` The tunnel's own backend answers through chisel (/api/e2e-idsurf/app/echo is a file of it)  

## Not hosted, not bound: the refusals; requests go down the tunnel

✅ `17:43:50` A route no installed plugin holds cannot be bound (400)  
✅ `17:43:51` Not hosted on the agent carrying the tunnel, the plugin cannot be bound (400)  
✅ `17:43:51` …Plugin 'e2e-idsurf' is not hosted on an agent — host it on the agent that carries this tunnel ('test-agent') first  
✅ `17:43:51` …the tunnel carries no binding  
✅ `17:43:51` Without a session: Authelia's redirect, as for any page of the tunnel  
✅ `17:43:51` …to the sign-in portal  
✅ `17:44:13` e2e40-viewer signed in from the visitor VM (password, TOTP)  
✅ `17:44:15` e2e40-norole signed in from the visitor VM  
✅ `17:44:15` Signed in: 200  
✅ `17:44:15` …from the tunnel's own backend: no user-surface location  
✅ `17:44:15` The viewer's session cookie, read from the visitor's jar  
✅ `17:44:16` Signed in with two other cookies around the session: the backend gets both, never authelia_session  
✅ `17:44:16` …the session first: the other alone  
✅ `17:44:16` …the session alone: no Cookie header at all  

## Approved and hosted on the tunnel's agent; bound, its users are let through

✅ `17:44:16` Approved: its agent half and identity block  
✅ `17:44:27` Hosted on test-agent ()  
✅ `17:44:44` The relay's health of the hosting is up  
✅ `17:44:44` Ready: its agent half's first complete sync ended at the head  
✅ `17:44:45` PUT /api/tunnels/3b3483bc-7f8f-43b1-993a-ce3ba10d03df/user-surface {route: e2e-idsurf}  
✅ `17:44:45` …bound  
✅ `17:44:45` …served at once: approved, declares identity, hosted by the tunnel's agent  
✅ `17:44:45` Binding it again changes nothing  
✅ `17:44:45` A public tunnel cannot be bound (400)  
✅ `17:44:45` …A public tunnel has no signed-in user to vouch for — make it authenticated or restricted first  
✅ `17:44:45` A second tunnel for the same route is refused (409)  
✅ `17:44:45` …user_surface_conflict  
✅ `17:44:46` The bound tunnel cannot be made public (409)  
✅ `17:44:46` …it stays authenticated  
✅ `17:44:46` Without a session: 401  
✅ `17:44:46` …JSON (unauthenticated) for the application to act on  
✅ `17:44:46` …never a redirect  
✅ `17:44:46` e2e40-viewer, before any entitlement: 403  
✅ `17:44:46` …not entitled  
✅ `17:44:46` e2e40-viewer entitled as viewer  
✅ `17:44:47` …an active member of the audience  

## Signed in with a role: the agent half sees the directory's user

✅ `17:44:47` GET /api/e2e-idsurf/app/echo as e2e40-viewer: 200  
✅ `17:44:47` The caller the panel signed: user, the directory's id, the username, the roles  
✅ `17:44:47` …for the agent half's /app/echo  
✅ `17:44:47` The application's Set-Cookie never reaches the browser  
✅ `17:44:47` …nor any X-Lamalibre-* header (the responder signature is the relay's)  
✅ `17:44:47` …every answer is a sandboxed document (CSP)  
✅ `17:44:47` …readable by the bound host's own pages only (CORP)  
✅ `17:44:47` …and no CORS header  
✅ `17:44:47` The agent half's projection holds e2e40-viewer (the feed delivered the entitlement)  
✅ `17:44:47` GET /api/e2e-idsurf/app/me: what the agent half's projection holds of them  
✅ `17:44:47` POST /api/e2e-idsurf/app/me: the agent half's own 405, signed, passes  
✅ `17:44:48` /api/e2e-idsurf/app/nothing: the agent half's own 404  
✅ `17:44:48` e2e40-norole, signed in without a role in the plugin: 403  
✅ `17:44:48` …not entitled  

## What a browser cannot do

✅ `17:44:48` A request another site started (Sec-Fetch-Site: cross-site), even a GET: 403  
✅ `17:44:48` …cross-site request refused  
✅ `17:44:48` POST without an Origin: 403  
✅ `17:44:48` …cross-origin request refused  
✅ `17:44:48` POST from a foreign Origin: 403  
✅ `17:44:48` POST from the bound host's Origin: forwarded  
✅ `17:44:48` …the agent half got the POST, its Origin and all 17 bytes  
✅ `17:44:48` Sent with its own X-Lamalibre-Relay-Assertion, Remote-User and X-Lamalibre-Caller: 200  
✅ `17:44:48` …the caller is still the one Gatekeeper vouched for  
✅ `17:44:48` …no Remote-User or relay assertion reached the agent half  
✅ `17:44:48` …while an ordinary header did  
✅ `17:44:49` The viewer's session cookie, read from the visitor's jar  
✅ `17:44:49` That cookie alone, sent as a header: 200  
✅ `17:44:49` authelia_session presented twice (twice): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `17:44:49` …unauthenticated  
✅ `17:44:49` authelia_session presented twice (empty-first): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `17:44:49` …unauthenticated  
✅ `17:44:49` authelia_session presented twice (planted-after): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `17:44:49` …unauthenticated  
✅ `17:44:49` On the host VM, Gatekeeper vouches for that session (/authz/user-surface/e2e40us.test.lamaste.local)  
✅ `17:44:49` Its assertion, sent to the panel's listener: 200  
✅ `17:44:49` …as e2e40-viewer  
✅ `17:44:50` The same assertion again: 401 — replay refused  
✅ `17:44:50` …unauthenticated  
✅ `17:44:50` An assertion for GET does not carry a POST (401)  
✅ `17:44:50` /api/e2e-idsurf/app/../app/echo: refused (403)  
✅ `17:44:50` /api/e2e-idsurf/app/./echo: refused (403)  
✅ `17:44:50` /api/e2e-idsurf/app/%2e/echo: refused (403)  
✅ `17:44:51` /api/e2e-idsurf/app/a%2fb: refused (403)  
✅ `17:44:51` /api/e2e-idsurf/app/a%5cb: refused (403)  
✅ `17:44:51` /api/e2e-idsurf/app/%252e%252e/echo: refused (403)  
✅ `17:44:51` The agent half saw none of them (its request log)  

## Restricted: a grant for the tunnel is needed too

✅ `17:44:52` The bound tunnel made restricted  
✅ `17:44:52` e2e40-viewer, entitled to the plugin but without a grant for the tunnel: 403  
✅ `17:44:52` e2e40-viewer granted the tunnel  
✅ `17:44:53` …200 with the grant  
✅ `17:44:54` The grant revoked, the tunnel authenticated again  
✅ `17:44:57` e2e40-viewer: 200 again  

## Unbound: the location is gone; bound again: served

✅ `17:44:59` DELETE /api/tunnels/3b3483bc-7f8f-43b1-993a-ce3ba10d03df/user-surface/e2e-idsurf  
✅ `17:44:59` …the tunnel carries no binding  
✅ `17:44:59` Signed in, /api/e2e-idsurf/app/echo reaches the tunnel's own backend again  
✅ `17:44:59` …and without a session Authelia redirects, as for any page of it  
✅ `17:45:00` Bound again: served at once (approved, hosted)  
✅ `17:45:03` e2e40-viewer: the agent half answers again  

## Disabled: refused at once

✅ `17:45:04` Gatekeeper vouches for e2e40-viewer's session once more  
✅ `17:45:06` e2e40-viewer disabled  
✅ `17:45:06` That assertion, still valid, sent to the panel: 403  
✅ `17:45:06` …This user is disabled  
✅ `17:45:06` From the visitor VM: 401 — the session ended with Authelia's restart, or the panel refuses it  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `121` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `121` |

ℹ️ `17:45:06` Cleaning up test resources...  
