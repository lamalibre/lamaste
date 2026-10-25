# Lamaste E2E: 40 — App plugin user surface (Three-VM)

> Started at `2026-10-25 19:54:52 UTC`


## Pre-flight

✅ `19:54:52` Onboarding is complete  
✅ `19:54:52` Agent test-agent is enrolled on the host  
✅ `19:54:53` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `19:54:53` The agent VM's lamaste-agent has the apphost command  
ℹ️ `19:54:53` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local, bound host e2e40us.test.lamaste.local  
✅ `19:54:53` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `19:54:53` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, the stand-in Feria, the users; the plugin installed, not approved

✅ `19:54:54` Fixture built: @lamalibre/e2e-idsurf-server (identity: viewer, editor; displayName, email) and its agent package  
✅ `19:54:57` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-idsurf-server, @lamalibre/e2e-idsurf-agent )  
✅ `19:54:57` The agent VM reaches it at http://10.13.37.1:4874  
✅ `19:54:58` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-10-25T19:54:58.986Z"})  
✅ `19:54:58` …through its own OIDC client  
✅ `19:55:08` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `19:55:15` User e2e40-viewer created  
✅ `19:55:17` User e2e40-norole created — to hold no role in the plugin  
✅ `19:55:17` Both have a directory id  
✅ `19:55:20` Installed @lamalibre/e2e-idsurf-server@1.0.0  
✅ `19:55:20` …its identity block waits for approval  
✅ `19:55:20` Hosting it is refused until it is approved (409)  
✅ `19:55:20` …hooks_not_approved  

## An authenticated app tunnel with its own backend, and two others

✅ `19:55:21` Tunnel e2e40us.test.lamaste.local: authenticated, carried by test-agent  
✅ `19:55:22` Tunnel e2e40pub: public  
✅ `19:55:23` Tunnel e2e40two: authenticated  
✅ `19:55:27` The tunnel's own backend answers through chisel (/api/e2e-idsurf/app/echo is a file of it)  

## Not hosted, not bound: the refusals; requests go down the tunnel

✅ `19:55:27` A route no installed plugin holds cannot be bound (400)  
✅ `19:55:27` Not hosted on the agent carrying the tunnel, the plugin cannot be bound (400)  
✅ `19:55:27` …Plugin 'e2e-idsurf' is not hosted on an agent — host it on the agent that carries this tunnel ('test-agent') first  
✅ `19:55:27` …the tunnel carries no binding  
✅ `19:55:27` Without a session: Authelia's redirect, as for any page of the tunnel  
✅ `19:55:27` …to the sign-in portal  
✅ `19:55:32` e2e40-viewer signed in from the visitor VM (password, TOTP)  
✅ `19:55:34` e2e40-norole signed in from the visitor VM  
✅ `19:55:34` Signed in: 200  
✅ `19:55:34` …from the tunnel's own backend: no user-surface location  
✅ `19:55:34` The viewer's session cookie, read from the visitor's jar  
✅ `19:55:34` Signed in with two other cookies around the session: the backend gets both, never authelia_session  
✅ `19:55:34` …the session first: the other alone  
✅ `19:55:34` …the session alone: no Cookie header at all  

## Approved and hosted on the tunnel's agent; bound, its users are let through

✅ `19:55:35` Approved: its agent half and identity block  
✅ `19:55:45` Hosted on test-agent ()  
✅ `19:56:05` The relay's health of the hosting is up  
✅ `19:56:05` Ready: its agent half's first complete sync ended at the head  
✅ `19:56:06` PUT /api/tunnels/22506d30-3e96-4922-b2b0-764b24606624/user-surface {route: e2e-idsurf}  
✅ `19:56:06` …bound  
✅ `19:56:06` …served at once: approved, declares identity, hosted by the tunnel's agent  
✅ `19:56:06` Binding it again changes nothing  
✅ `19:56:06` A public tunnel cannot be bound (400)  
✅ `19:56:06` …A public tunnel has no signed-in user to vouch for — make it authenticated or restricted first  
✅ `19:56:06` A second tunnel for the same route is refused (409)  
✅ `19:56:06` …user_surface_conflict  
✅ `19:56:06` The bound tunnel cannot be made public (409)  
✅ `19:56:06` …it stays authenticated  
✅ `19:56:07` Without a session: 401  
✅ `19:56:07` …JSON (unauthenticated) for the application to act on  
✅ `19:56:07` …never a redirect  
✅ `19:56:07` e2e40-viewer, before any entitlement: 403  
✅ `19:56:07` …not entitled  
✅ `19:56:07` e2e40-viewer entitled as viewer  
✅ `19:56:07` …an active member of the audience  

## Signed in with a role: the agent half sees the directory's user

✅ `19:56:07` GET /api/e2e-idsurf/app/echo as e2e40-viewer: 200  
✅ `19:56:08` The caller the panel signed: user, the directory's id, the username, the roles  
✅ `19:56:08` …for the agent half's /app/echo  
✅ `19:56:08` The application's Set-Cookie never reaches the browser  
✅ `19:56:08` …nor any X-Lamalibre-* header (the responder signature is the relay's)  
✅ `19:56:08` …every answer is a sandboxed document (CSP)  
✅ `19:56:08` …readable by the bound host's own pages only (CORP)  
✅ `19:56:08` …and no CORS header  
✅ `19:56:08` The agent half's projection holds e2e40-viewer (the feed delivered the entitlement)  
✅ `19:56:08` GET /api/e2e-idsurf/app/me: what the agent half's projection holds of them  
✅ `19:56:08` POST /api/e2e-idsurf/app/me: the agent half's own 405, signed, passes  
✅ `19:56:08` /api/e2e-idsurf/app/nothing: the agent half's own 404  
✅ `19:56:08` e2e40-norole, signed in without a role in the plugin: 403  
✅ `19:56:08` …not entitled  

## What a browser cannot do

✅ `19:56:08` A request another site started (Sec-Fetch-Site: cross-site), even a GET: 403  
✅ `19:56:08` …cross-site request refused  
✅ `19:56:08` POST without an Origin: 403  
✅ `19:56:08` …cross-origin request refused  
✅ `19:56:09` POST from a foreign Origin: 403  
✅ `19:56:09` POST from the bound host's Origin: forwarded  
✅ `19:56:09` …the agent half got the POST, its Origin and all 17 bytes  
✅ `19:56:09` Sent with its own X-Lamalibre-Relay-Assertion, Remote-User and X-Lamalibre-Caller: 200  
✅ `19:56:09` …the caller is still the one Gatekeeper vouched for  
✅ `19:56:09` …no Remote-User or relay assertion reached the agent half  
✅ `19:56:09` …while an ordinary header did  
✅ `19:56:09` The viewer's session cookie, read from the visitor's jar  
✅ `19:56:09` That cookie alone, sent as a header: 200  
✅ `19:56:09` authelia_session presented twice (twice): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `19:56:09` …unauthenticated  
✅ `19:56:09` authelia_session presented twice (empty-first): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `19:56:09` …unauthenticated  
✅ `19:56:09` authelia_session presented twice (planted-after): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `19:56:09` …unauthenticated  
✅ `19:56:10` On the host VM, Gatekeeper vouches for that session (/authz/user-surface/e2e40us.test.lamaste.local)  
✅ `19:56:10` Its assertion, sent to the panel's listener: 200  
✅ `19:56:10` …as e2e40-viewer  
✅ `19:56:10` The same assertion again: 401 — replay refused  
✅ `19:56:10` …unauthenticated  
✅ `19:56:10` An assertion for GET does not carry a POST (401)  
✅ `19:56:10` /api/e2e-idsurf/app/../app/echo: refused (403)  
✅ `19:56:11` /api/e2e-idsurf/app/./echo: refused (403)  
✅ `19:56:11` /api/e2e-idsurf/app/%2e/echo: refused (403)  
✅ `19:56:11` /api/e2e-idsurf/app/a%2fb: refused (403)  
✅ `19:56:11` /api/e2e-idsurf/app/a%5cb: refused (403)  
✅ `19:56:11` /api/e2e-idsurf/app/%252e%252e/echo: refused (403)  
✅ `19:56:11` The agent half saw none of them (its request log)  

## Restricted: a grant for the tunnel is needed too

✅ `19:56:12` The bound tunnel made restricted  
✅ `19:56:15` e2e40-viewer, entitled to the plugin but without a grant for the tunnel: 403  
✅ `19:56:16` e2e40-viewer granted the tunnel  
✅ `19:56:16` …200 with the grant  
✅ `19:56:17` The grant revoked, the tunnel authenticated again  
✅ `19:56:20` e2e40-viewer: 200 again  

## Unbound: the location is gone; bound again: served

✅ `19:56:21` DELETE /api/tunnels/22506d30-3e96-4922-b2b0-764b24606624/user-surface/e2e-idsurf  
✅ `19:56:21` …the tunnel carries no binding  
✅ `19:56:22` Signed in, /api/e2e-idsurf/app/echo reaches the tunnel's own backend again  
✅ `19:56:22` …and without a session Authelia redirects, as for any page of it  
✅ `19:56:23` Bound again: served at once (approved, hosted)  
✅ `19:56:26` e2e40-viewer: the agent half answers again  

## Disabled: refused at once

✅ `19:56:26` Gatekeeper vouches for e2e40-viewer's session once more  
✅ `19:56:27` e2e40-viewer disabled  
✅ `19:56:27` That assertion, still valid, sent to the panel: 403  
✅ `19:56:27` …This user is disabled  
✅ `19:56:27` From the visitor VM: 401 — the session ended with Authelia's restart, or the panel refuses it  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `121` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `121` |

ℹ️ `19:56:27` Cleaning up test resources...  
