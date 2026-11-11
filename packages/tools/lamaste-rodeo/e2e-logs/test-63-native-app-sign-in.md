# Lamaste E2E: 63 — Native app: sign-in and calls (Three-VM)

> Started at `2026-11-11 10:32:34 UTC`


## Pre-flight

✅ `10:32:34` Onboarding is complete  
✅ `10:32:34` Agent test-agent is enrolled on the host  
✅ `10:32:34` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:32:35` The agent VM's lamaste-agent has the apphost command  
ℹ️ `10:32:35` Hosting agent: test-agent, relay domain test.lamaste.local, site e2e63app.test.lamaste.local, tunnel e2e63tun.test.lamaste.local  
✅ `10:32:35` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `10:32:35` The visitor VM has oathtool (Authelia's second factor)  

## Three plugins, hosted; the site's plugins and a tunnel across agents

✅ `10:32:37` Fixtures built: e2e-nat63a (with a web tree), e2e-nat63b, e2e-nat63c  
✅ `10:32:59` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-nat63a-server, @lamalibre/e2e-nat63a-agent, @lamalibre/e2e-nat63b-server, @lamalibre/e2e-nat63b-agent, @lamalibre/e2e-nat63c-server, @lamalibre/e2e-nat63c-agent )  
✅ `10:32:59` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:33:00` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T10:33:00.653Z"})  
✅ `10:33:00` …through its own OIDC client  
✅ `10:33:01` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:33:03` User e2e63-person-393153 created  
✅ `10:33:03` User e2e63-other-393153 created — signed in, entitled to nothing  
✅ `10:33:09` Installed and approved: e2e-nat63a  
✅ `10:33:14` Installed and approved: e2e-nat63b  
✅ `10:33:18` Installed and approved: e2e-nat63c  
✅ `10:33:21` e2e-nat63a's web surface created on e2e63app.test.lamaste.local  
✅ `10:33:32` e2e-nat63a hosted on test-agent ()  
✅ `10:33:42` e2e-nat63b hosted on test-agent ()  
✅ `10:33:53` e2e-nat63c hosted on test-agent ()  
✅ `10:33:53` e2e-nat63a is ready: its agent half synced to the head  
✅ `10:33:54` e2e-nat63b is ready: its agent half synced to the head  
✅ `10:33:54` e2e-nat63c is ready: its agent half synced to the head  
✅ `10:33:54` The site is served  
✅ `10:33:54` PUT /api/plugins/e2e-nat63a/web-surface/routes/e2e-nat63b: e2e-nat63b joins the site  
✅ `10:33:54` …served on e2e63app.test.lamaste.local beside e2e-nat63a  
✅ `10:33:56` A second agent certificate, e2e63front93154: the tunnel's carrier  
✅ `10:33:59` Tunnel e2e63tun.test.lamaste.local, authenticated, carried by e2e63front93154  
✅ `10:33:59` Binding e2e-nat63c, which test-agent hosts, without crossAgent: 400  
✅ `10:34:00` …the refusal names crossAgent  
✅ `10:34:14` With crossAgent: bound  
✅ `10:34:16` …the binding records the confirmation: e2e63front93154 carrying, test-agent hosting  
✅ `10:34:16` …served on e2e63tun.test.lamaste.local  
✅ `10:34:17` Audited: tunnel.user-surface.bound, reason cross-agent  

## A native client per application host

✅ `10:34:20` POST /api/native-apps: lamaste-native-e2e63site for the site  
✅ `10:34:20` …served, on e2e63app.test.lamaste.local, its audience the host's origin  
✅ `10:34:20` …its redirect URI on the host  
✅ `10:34:20` …serving both plugins of the site  
✅ `10:34:20` …access tokens of 15 minutes, 30 days idle, 90 days absolute (the defaults)  
✅ `10:34:20` A second client on the same host: 409 host_has_client  
✅ `10:34:21` POST /api/native-apps: lamaste-native-e2e63tun for the tunnel  
✅ `10:34:21` …served, serving e2e-nat63c  
✅ `10:34:21` Audited twice: native-app.created  
✅ `10:34:22` Authelia knows both clients (rendered, Authelia restarted)  
✅ `10:34:22` Authelia's client: public, PKCE required, S256 only  
✅ `10:34:22` …authorization_code and refresh_token, offline_access  
✅ `10:34:22` …the host's audience, granted implicitly, JWT access tokens  
✅ `10:34:22` …the claimed HTTPS redirect URI  
✅ `10:34:22` …its authorization policy: two factors, everyone else denied  

## The association files and the redirect path, without a session

✅ `10:34:22` GET /.well-known/apple-app-site-association: 200 without a session  
✅ `10:34:22` …application/json  
✅ `10:34:22` …the app's id (team and bundle)  
✅ `10:34:22` …claiming the redirect path alone, never the whole host  
✅ `10:34:22` …and webcredentials for an HTTPS callback  
✅ `10:34:23` GET /.well-known/assetlinks.json: 200 without a session  
✅ `10:34:23` …the package and its signing certificate's fingerprint  
✅ `10:34:23` The tunnel's client declares no iOS app: no file served there  
✅ `10:34:23` GET /native/callback without a session: 200, the static page  
✅ `10:34:23` …Referrer-Policy: no-referrer  
✅ `10:34:23` …Cache-Control: no-store  
✅ `10:34:23` …a CSP that allows nothing but its own style  
✅ `10:34:23` …no script  
✅ `10:34:23` …nothing of the request on the page  
✅ `10:34:23` POST to the redirect path: 405  
✅ `10:34:23` The redirect path's query (an authorization code) is in no nginx log  

## Sign-in: PKCE S256 only, then the code for tokens

✅ `10:34:23` e2e63-person-393153 entitled as viewer of e2e-nat63a  
✅ `10:34:24` e2e63-person-393153 entitled as viewer of e2e-nat63b  
✅ `10:34:24` e2e63-person-393153 entitled as viewer of e2e-nat63c  
✅ `10:34:24` …an active member of e2e-nat63a's audience  
✅ `10:34:24` …an active member of e2e-nat63b's audience  
✅ `10:34:24` …an active member of e2e-nat63c's audience  
✅ `10:34:33` e2e63-person-393153 signed in to Authelia from the visitor VM (the app's browser)  
✅ `10:34:34` e2e63-other-393153 signed in too  
✅ `10:34:35` An authorization request without a PKCE challenge: invalid_request at the redirect URI  
✅ `10:34:36` …with code_challenge_method plain: invalid_request  
✅ `10:34:36` With S256 (consent given): a code at /native/callback  
✅ `10:34:36` The code exchanged at https://auth.test.lamaste.local/api/oidc/token (the relay's broker): 200  
✅ `10:34:36` …a refresh token  
✅ `10:34:36` …a bearer access token of 15 minutes at most  
✅ `10:34:37` The access token is a JWT: RS256, at+jwt  
✅ `10:34:37` …issued by the domain's issuer to lamaste-native-e2e63site, for e2e63-person-393153  
✅ `10:34:37` …its audience the host  
✅ `10:34:37` …living 15 minutes at most  
✅ `10:34:37` GET /api/native-apps/lamaste-native-e2e63site/grants: the grant of device "E2E Phone", e2e63-person-393153's, live  

## Bearer calls to both plugins of the site

✅ `10:34:37` GET /api/e2e-nat63a/app/echo with the bearer: 200  
✅ `10:34:37` …the agent half's caller: the user, the directory's id, the roles  
✅ `10:34:37` …no Authorization, no Cookie, no Origin reached it  
✅ `10:34:37` GET /api/e2e-nat63b/app/echo, the joined plugin, with the same token: 200  
✅ `10:34:37` …the same user, no Authorization  
✅ `10:34:37` POST without Origin, as a phone app sends it: 200 (no CSRF rule for a bearer)  
✅ `10:34:37` …the body forwarded, still no Origin  
✅ `10:34:37` e2e63-other-393153's session cookie beside e2e63-person-393153's bearer: 200  
✅ `10:34:37` …as e2e63-person-393153: the bearer is the request's credential, the cookie ignored  
✅ `10:34:38` e2e63-other-393153's cookie alone: 403 (no role)  
✅ `10:34:38` A tampered token: 401  
✅ `10:34:38` …{"error":"invalid_token"}  
✅ `10:34:38` …WWW-Authenticate: Bearer error="invalid_token"  
✅ `10:34:38` A malformed token: 401 invalid_token  
✅ `10:34:38` e2e-nat63a's agent half received exactly the three accepted requests  
✅ `10:34:39` Signed in with the tunnel's client (the same Authelia session)  
✅ `10:34:40` GET https://e2e63tun.test.lamaste.local/api/e2e-nat63c/app/echo with its token: 200  
✅ `10:34:40` …answered by e2e-nat63c's agent half through the relay, never by e2e63front93154  
✅ `10:34:40` The site's token on the tunnel host (another audience): 401 invalid_token  
✅ `10:34:40` The tunnel's token on the site (another host's client): 401 invalid_token  

## The tunnel reassigned: the cross-agent binding lapses

✅ `10:34:42` A third agent certificate, e2e63back93154  
✅ `10:34:45` The tunnel reassigned to e2e63back93154  
✅ `10:34:45` …its cross-agent confirmation is gone  
✅ `10:34:45` …e2e-nat63c bound, not served: cross_agent_unconfirmed  
✅ `10:34:46` The bound, unserved route: nginx answers 503 itself  
✅ `10:34:46` …as JSON  
✅ `10:34:46` …nothing reached the agent half, nor the tunnel's agent  

## The token broker

✅ `10:34:46` Basic client authentication naming a native client: 401 invalid_client (native clients are public)  
✅ `10:34:47` An unknown refresh token: 400 invalid_grant, never forwarded  
✅ `10:34:47` A confidential client with a wrong secret (no native client): Authelia's own answer, 401 invalid_client  
✅ `10:34:47` …passed through unchanged (Authelia's description)  
✅ `10:34:47` The site's refresh token still refreshes after all that: 200  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `117` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `117` |

ℹ️ `10:34:47` Cleaning up test resources...  
