# Lamaste E2E: 63 — Native app: sign-in and calls (Three-VM)

> Started at `2026-11-10 17:06:32 UTC`


## Pre-flight

✅ `17:06:33` Onboarding is complete  
✅ `17:06:33` Agent test-agent is enrolled on the host  
✅ `17:06:33` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `17:06:34` The agent VM's lamaste-agent has the apphost command  
ℹ️ `17:06:34` Hosting agent: test-agent, relay domain test.lamaste.local, site e2e63app.test.lamaste.local, tunnel e2e63tun.test.lamaste.local  
✅ `17:06:34` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `17:06:34` The visitor VM has oathtool (Authelia's second factor)  

## Three plugins, hosted; the site's plugins and a tunnel across agents

✅ `17:06:36` Fixtures built: e2e-nat63a (with a web tree), e2e-nat63b, e2e-nat63c  
✅ `17:06:59` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-nat63a-server, @lamalibre/e2e-nat63a-agent, @lamalibre/e2e-nat63b-server, @lamalibre/e2e-nat63b-agent, @lamalibre/e2e-nat63c-server, @lamalibre/e2e-nat63c-agent )  
✅ `17:06:59` The agent VM reaches it at http://10.13.37.1:4874  
✅ `17:06:59` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T17:06:59.671Z"})  
✅ `17:06:59` …through its own OIDC client  
✅ `17:07:00` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `17:07:01` User e2e63-person-330392 created  
✅ `17:07:02` User e2e63-other-330392 created — signed in, entitled to nothing  
✅ `17:07:06` Installed and approved: e2e-nat63a  
✅ `17:07:11` Installed and approved: e2e-nat63b  
✅ `17:07:15` Installed and approved: e2e-nat63c  
✅ `17:07:16` e2e-nat63a's web surface created on e2e63app.test.lamaste.local  
✅ `17:07:27` e2e-nat63a hosted on test-agent ()  
✅ `17:07:38` e2e-nat63b hosted on test-agent ()  
✅ `17:07:48` e2e-nat63c hosted on test-agent ()  
✅ `17:07:48` e2e-nat63a is ready: its agent half synced to the head  
✅ `17:07:48` e2e-nat63b is ready: its agent half synced to the head  
✅ `17:07:49` e2e-nat63c is ready: its agent half synced to the head  
✅ `17:07:49` The site is served  
✅ `17:07:49` PUT /api/plugins/e2e-nat63a/web-surface/routes/e2e-nat63b: e2e-nat63b joins the site  
✅ `17:07:49` …served on e2e63app.test.lamaste.local beside e2e-nat63a  
✅ `17:07:51` A second agent certificate, e2e63front30392: the tunnel's carrier  
✅ `17:07:52` Tunnel e2e63tun.test.lamaste.local, authenticated, carried by e2e63front30392  
✅ `17:07:52` Binding e2e-nat63c, which test-agent hosts, without crossAgent: 400  
✅ `17:07:52` …the refusal names crossAgent  
✅ `17:07:53` With crossAgent: bound  
✅ `17:07:54` …the binding records the confirmation: e2e63front30392 carrying, test-agent hosting  
✅ `17:07:54` …served on e2e63tun.test.lamaste.local  
✅ `17:07:54` Audited: tunnel.user-surface.bound, reason cross-agent  

## A native client per application host

✅ `17:07:55` POST /api/native-apps: lamaste-native-e2e63site for the site  
✅ `17:07:55` …served, on e2e63app.test.lamaste.local, its audience the host's origin  
✅ `17:07:55` …its redirect URI on the host  
✅ `17:07:55` …serving both plugins of the site  
✅ `17:07:55` …access tokens of 15 minutes, 30 days idle, 90 days absolute (the defaults)  
✅ `17:07:55` A second client on the same host: 409 host_has_client  
✅ `17:07:56` POST /api/native-apps: lamaste-native-e2e63tun for the tunnel  
✅ `17:07:56` …served, serving e2e-nat63c  
✅ `17:07:56` Audited twice: native-app.created  
✅ `17:07:57` Authelia knows both clients (rendered, Authelia restarted)  
✅ `17:07:57` Authelia's client: public, PKCE required, S256 only  
✅ `17:07:57` …authorization_code and refresh_token, offline_access  
✅ `17:07:57` …the host's audience, granted implicitly, JWT access tokens  
✅ `17:07:57` …the claimed HTTPS redirect URI  
✅ `17:07:57` …its authorization policy: two factors, everyone else denied  

## The association files and the redirect path, without a session

✅ `17:07:57` GET /.well-known/apple-app-site-association: 200 without a session  
✅ `17:07:57` …application/json  
✅ `17:07:57` …the app's id (team and bundle)  
✅ `17:07:57` …claiming the redirect path alone, never the whole host  
✅ `17:07:57` …and webcredentials for an HTTPS callback  
✅ `17:07:58` GET /.well-known/assetlinks.json: 200 without a session  
✅ `17:07:58` …the package and its signing certificate's fingerprint  
✅ `17:07:58` The tunnel's client declares no iOS app: no file served there  
✅ `17:07:58` GET /native/callback without a session: 200, the static page  
✅ `17:07:58` …Referrer-Policy: no-referrer  
✅ `17:07:58` …Cache-Control: no-store  
✅ `17:07:58` …a CSP that allows nothing but its own style  
✅ `17:07:58` …no script  
✅ `17:07:58` …nothing of the request on the page  
✅ `17:07:58` POST to the redirect path: 405  
✅ `17:07:58` The redirect path's query (an authorization code) is in no nginx log  

## Sign-in: PKCE S256 only, then the code for tokens

✅ `17:07:58` e2e63-person-330392 entitled as viewer of e2e-nat63a  
✅ `17:07:58` e2e63-person-330392 entitled as viewer of e2e-nat63b  
✅ `17:07:59` e2e63-person-330392 entitled as viewer of e2e-nat63c  
✅ `17:07:59` …an active member of e2e-nat63a's audience  
✅ `17:07:59` …an active member of e2e-nat63b's audience  
✅ `17:07:59` …an active member of e2e-nat63c's audience  
✅ `17:08:03` e2e63-person-330392 signed in to Authelia from the visitor VM (the app's browser)  
✅ `17:08:05` e2e63-other-330392 signed in too  
✅ `17:08:06` An authorization request without a PKCE challenge: invalid_request at the redirect URI  
✅ `17:08:06` …with code_challenge_method plain: invalid_request  
✅ `17:08:07` With S256 (consent given): a code at /native/callback  
✅ `17:08:07` The code exchanged at https://auth.test.lamaste.local/api/oidc/token (the relay's broker): 200  
✅ `17:08:07` …a refresh token  
✅ `17:08:07` …a bearer access token of 15 minutes at most  
✅ `17:08:07` The access token is a JWT: RS256, at+jwt  
✅ `17:08:07` …issued by the domain's issuer to lamaste-native-e2e63site, for e2e63-person-330392  
✅ `17:08:07` …its audience the host  
✅ `17:08:07` …living 15 minutes at most  
✅ `17:08:07` GET /api/native-apps/lamaste-native-e2e63site/grants: the grant of device "E2E Phone", e2e63-person-330392's, live  

## Bearer calls to both plugins of the site

✅ `17:08:08` GET /api/e2e-nat63a/app/echo with the bearer: 200  
✅ `17:08:08` …the agent half's caller: the user, the directory's id, the roles  
✅ `17:08:08` …no Authorization, no Cookie, no Origin reached it  
✅ `17:08:08` GET /api/e2e-nat63b/app/echo, the joined plugin, with the same token: 200  
✅ `17:08:08` …the same user, no Authorization  
✅ `17:08:08` POST without Origin, as a phone app sends it: 200 (no CSRF rule for a bearer)  
✅ `17:08:08` …the body forwarded, still no Origin  
✅ `17:08:08` e2e63-other-330392's session cookie beside e2e63-person-330392's bearer: 200  
✅ `17:08:08` …as e2e63-person-330392: the bearer is the request's credential, the cookie ignored  
✅ `17:08:08` e2e63-other-330392's cookie alone: 403 (no role)  
✅ `17:08:08` A tampered token: 401  
✅ `17:08:08` …{"error":"invalid_token"}  
✅ `17:08:09` …WWW-Authenticate: Bearer error="invalid_token"  
✅ `17:08:09` A malformed token: 401 invalid_token  
✅ `17:08:09` e2e-nat63a's agent half received exactly the three accepted requests  
✅ `17:08:10` Signed in with the tunnel's client (the same Authelia session)  
✅ `17:08:10` GET https://e2e63tun.test.lamaste.local/api/e2e-nat63c/app/echo with its token: 200  
✅ `17:08:10` …answered by e2e-nat63c's agent half through the relay, never by e2e63front30392  
✅ `17:08:10` The site's token on the tunnel host (another audience): 401 invalid_token  
✅ `17:08:10` The tunnel's token on the site (another host's client): 401 invalid_token  

## The tunnel reassigned: the cross-agent binding lapses

✅ `17:08:11` A third agent certificate, e2e63back30392  
✅ `17:08:12` The tunnel reassigned to e2e63back30392  
✅ `17:08:12` …its cross-agent confirmation is gone  
✅ `17:08:12` …e2e-nat63c bound, not served: cross_agent_unconfirmed  
✅ `17:08:12` The bound, unserved route: nginx answers 503 itself  
✅ `17:08:12` …as JSON  
✅ `17:08:13` …nothing reached the agent half, nor the tunnel's agent  

## The token broker

✅ `17:08:13` Basic client authentication naming a native client: 401 invalid_client (native clients are public)  
✅ `17:08:13` An unknown refresh token: 400 invalid_grant, never forwarded  
✅ `17:08:13` A confidential client with a wrong secret (no native client): Authelia's own answer, 401 invalid_client  
✅ `17:08:13` …passed through unchanged (Authelia's description)  
✅ `17:08:13` The site's refresh token still refreshes after all that: 200  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `117` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `117` |

ℹ️ `17:08:13` Cleaning up test resources...  
