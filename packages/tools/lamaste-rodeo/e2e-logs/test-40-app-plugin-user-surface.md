# Lamaste E2E: 40 — App plugin user surface (Three-VM)

> Started at `2026-11-11 11:07:33 UTC`


## Pre-flight

✅ `11:07:33` Onboarding is complete  
✅ `11:07:33` Agent test-agent is enrolled on the host  
✅ `11:07:33` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `11:07:33` The agent VM's lamaste-agent has the apphost command  
ℹ️ `11:07:33` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local, bound host e2e40us.test.lamaste.local  
✅ `11:07:34` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `11:07:34` The visitor VM has oathtool (Authelia's second factor)  

## Fixtures, the stand-in Feria, the users; the plugin installed, not approved

✅ `11:07:35` Fixture built: @lamalibre/e2e-idsurf-server (identity: viewer, editor; displayName, email) and its agent package  
✅ `11:07:44` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-idsurf-server, @lamalibre/e2e-idsurf-agent )  
✅ `11:07:44` The agent VM reaches it at http://10.13.37.1:4874  
✅ `11:07:45` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T11:07:45.531Z"})  
✅ `11:07:45` …through its own OIDC client  
✅ `11:07:46` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `11:07:47` User e2e40-viewer created  
✅ `11:07:48` User e2e40-norole created — to hold no role in the plugin  
✅ `11:07:48` Both have a directory id  
✅ `11:07:52` Installed @lamalibre/e2e-idsurf-server@1.0.0  
✅ `11:07:52` …its identity block waits for approval  
✅ `11:07:52` Hosting it is refused until it is approved (409)  
✅ `11:07:52` …hooks_not_approved  

## An authenticated app tunnel with its own backend, and two others

✅ `11:07:55` Tunnel e2e40us.test.lamaste.local: authenticated, carried by test-agent  
✅ `11:07:58` Tunnel e2e40pub: public  
✅ `11:08:01` Tunnel e2e40two: authenticated  
✅ `11:08:05` The tunnel's own backend answers through chisel (/api/e2e-idsurf/app/echo is a file of it)  

## Not hosted, not bound: the refusals; requests go down the tunnel

✅ `11:08:05` A route no installed plugin holds cannot be bound (400)  
✅ `11:08:05` Not hosted on the agent carrying the tunnel, the plugin cannot be bound (400)  
✅ `11:08:05` …Plugin 'e2e-idsurf' is not hosted on an agent — host it on the agent that carries this tunnel ('test-agent') first  
✅ `11:08:05` …the tunnel carries no binding  
✅ `11:08:06` Without a session: Authelia's redirect, as for any page of the tunnel  
✅ `11:08:06` …to the sign-in portal  
✅ `11:08:33` e2e40-viewer signed in from the visitor VM (password, TOTP)  
✅ `11:08:35` e2e40-norole signed in from the visitor VM  
✅ `11:08:35` Signed in: 200  
✅ `11:08:35` …from the tunnel's own backend: no user-surface location  
✅ `11:08:35` The viewer's session cookie, read from the visitor's jar  
✅ `11:08:35` Signed in with two other cookies around the session: the backend gets both, never authelia_session  
✅ `11:08:35` …the session first: the other alone  
✅ `11:08:36` …the session alone: no Cookie header at all  

## Approved and hosted on the tunnel's agent; bound, its users are let through

✅ `11:08:36` Approved: its agent half and identity block  
✅ `11:08:47` Hosted on test-agent ()  
✅ `11:09:03` The relay's health of the hosting is up  
✅ `11:09:04` Ready: its agent half's first complete sync ended at the head  
✅ `11:09:06` PUT /api/tunnels/614b3c2f-ef74-407a-8dee-a4671a8820df/user-surface {route: e2e-idsurf}  
✅ `11:09:06` …bound  
✅ `11:09:06` …served at once: approved, declares identity, hosted by the tunnel's agent  
✅ `11:09:07` Binding it again changes nothing  
✅ `11:09:07` A public tunnel cannot be bound (400)  
✅ `11:09:07` …A public tunnel has no signed-in user to vouch for — make it authenticated or restricted first  
✅ `11:09:07` A second tunnel for the same route is refused (409)  
✅ `11:09:07` …user_surface_conflict  
✅ `11:09:07` The bound tunnel cannot be made public (409)  
✅ `11:09:07` …it stays authenticated  
✅ `11:09:07` Without a session: 401  
✅ `11:09:07` …JSON (unauthenticated) for the application to act on  
✅ `11:09:07` …never a redirect  
✅ `11:09:08` e2e40-viewer, before any entitlement: 403  
✅ `11:09:08` …not entitled  
✅ `11:09:08` e2e40-viewer entitled as viewer  
✅ `11:09:08` …an active member of the audience  

## Signed in with a role: the agent half sees the directory's user

✅ `11:09:08` GET /api/e2e-idsurf/app/echo as e2e40-viewer: 200  
✅ `11:09:08` The caller the panel signed: user, the directory's id, the username, the roles  
✅ `11:09:08` …for the agent half's /app/echo  
✅ `11:09:08` The application's Set-Cookie never reaches the browser  
✅ `11:09:08` …nor any X-Lamalibre-* header (the responder signature is the relay's)  
✅ `11:09:08` …every answer is a sandboxed document (CSP)  
✅ `11:09:08` …readable by the bound host's own pages only (CORP)  
✅ `11:09:08` …and no CORS header  
✅ `11:09:08` The agent half's projection holds e2e40-viewer (the feed delivered the entitlement)  
✅ `11:09:09` GET /api/e2e-idsurf/app/me: what the agent half's projection holds of them  
✅ `11:09:09` POST /api/e2e-idsurf/app/me: the agent half's own 405, signed, passes  
✅ `11:09:09` /api/e2e-idsurf/app/nothing: the agent half's own 404  
✅ `11:09:09` e2e40-norole, signed in without a role in the plugin: 403  
✅ `11:09:09` …not entitled  

## What a browser cannot do

✅ `11:09:09` A request another site started (Sec-Fetch-Site: cross-site), even a GET: 403  
✅ `11:09:09` …cross-site request refused  
✅ `11:09:09` POST without an Origin: 403  
✅ `11:09:09` …cross-origin request refused  
✅ `11:09:10` POST from a foreign Origin: 403  
✅ `11:09:10` POST from the bound host's Origin: forwarded  
✅ `11:09:10` …the agent half got the POST, its Origin and all 17 bytes  
✅ `11:09:10` Sent with its own X-Lamalibre-Relay-Assertion, Remote-User and X-Lamalibre-Caller: 200  
✅ `11:09:10` …the caller is still the one Gatekeeper vouched for  
✅ `11:09:10` …no Remote-User or relay assertion reached the agent half  
✅ `11:09:10` …while an ordinary header did  
✅ `11:09:10` The viewer's session cookie, read from the visitor's jar  
✅ `11:09:10` That cookie alone, sent as a header: 200  
✅ `11:09:10` authelia_session presented twice (twice): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `11:09:10` …unauthenticated  
✅ `11:09:11` authelia_session presented twice (empty-first): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `11:09:11` …unauthenticated  
✅ `11:09:11` authelia_session presented twice (planted-after): 401 — Gatekeeper does not guess which one Authelia would read  
✅ `11:09:11` …unauthenticated  
✅ `11:09:11` On the host VM, Gatekeeper vouches for that session (/authz/user-surface/e2e40us.test.lamaste.local)  
✅ `11:09:11` Its assertion, sent to the panel's listener: 200  
✅ `11:09:11` …as e2e40-viewer  
✅ `11:09:11` The same assertion again: 401 — replay refused  
✅ `11:09:11` …unauthenticated  
✅ `11:09:11` An assertion for GET does not carry a POST (401)  
✅ `11:09:12` /api/e2e-idsurf/app/../app/echo: refused (403)  
✅ `11:09:12` /api/e2e-idsurf/app/./echo: refused (403)  
✅ `11:09:12` /api/e2e-idsurf/app/%2e/echo: refused (403)  
✅ `11:09:12` /api/e2e-idsurf/app/a%2fb: refused (403)  
✅ `11:09:12` /api/e2e-idsurf/app/a%5cb: refused (403)  
✅ `11:09:12` /api/e2e-idsurf/app/%252e%252e/echo: refused (403)  
✅ `11:09:13` The agent half saw none of them (its request log)  

## Restricted: a grant for the tunnel is needed too

✅ `11:09:15` The bound tunnel made restricted  
✅ `11:09:19` e2e40-viewer, entitled to the plugin but without a grant for the tunnel: 403  
✅ `11:09:19` e2e40-viewer granted the tunnel  
✅ `11:09:19` …200 with the grant  
✅ `11:09:22` The grant revoked, the tunnel authenticated again  
✅ `11:09:26` e2e40-viewer: 200 again  

## Unbound: the location is gone; bound again: served

✅ `11:09:28` DELETE /api/tunnels/614b3c2f-ef74-407a-8dee-a4671a8820df/user-surface/e2e-idsurf  
✅ `11:09:28` …the tunnel carries no binding  
✅ `11:09:29` Signed in, /api/e2e-idsurf/app/echo reaches the tunnel's own backend again  
✅ `11:09:29` …and without a session Authelia redirects, as for any page of it  
✅ `11:09:32` Bound again: served at once (approved, hosted)  
✅ `11:09:35` e2e40-viewer: the agent half answers again  

## Disabled: refused at once

✅ `11:09:36` Gatekeeper vouches for e2e40-viewer's session once more  
✅ `11:09:36` e2e40-viewer disabled  
✅ `11:09:36` That assertion, still valid, sent to the panel: 403  
✅ `11:09:36` …This user is disabled  
✅ `11:09:36` From the visitor VM: 401 — Authelia ended the disabled user's session, or the panel refuses it  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `121` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `121` |

ℹ️ `11:09:36` Cleaning up test resources...  
