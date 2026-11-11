# Lamaste E2E: 64 — Native app: refresh tokens and grants (Three-VM)

> Started at `2026-11-11 10:35:45 UTC`


## Pre-flight

✅ `10:35:45` Onboarding is complete  
✅ `10:35:46` Agent test-agent is enrolled on the host  
✅ `10:35:46` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:35:46` The agent VM's lamaste-agent has the apphost command  
ℹ️ `10:35:46` Hosting agent: test-agent, relay domain test.lamaste.local, site e2e64app.test.lamaste.local  
✅ `10:35:47` The agent VM's Node.js has node:sqlite and the visitor VM has oathtool  

## The plugin's site, a native client, a person signed in to Authelia

✅ `10:35:56` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-nat64-server, @lamalibre/e2e-nat64-agent )  
✅ `10:35:56` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:35:57` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T10:35:57.758Z"})  
✅ `10:35:57` …through its own OIDC client  
✅ `10:35:58` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:36:00` User e2e64-person-393345 created  
✅ `10:36:04` Installed and approved: e2e-nat64  
✅ `10:36:07` Its web surface created on e2e64app.test.lamaste.local  
✅ `10:36:18` Hosted on test-agent ()  
✅ `10:36:19` Ready and served  
✅ `10:36:20` Native client lamaste-native-e2e64app registered for the site  
✅ `10:36:20` e2e64-person-393345 entitled as viewer  
✅ `10:36:21` Authelia knows the client; e2e64-person-393345 is in the audience  
✅ `10:36:35` e2e64-person-393345 signed in to Authelia from the visitor VM  

## Rotation, the grace window, and a spent token reused

✅ `10:36:36` Signed in on "E2E Phone"  
✅ `10:36:36` Its access token reaches the plugin  
✅ `10:36:37` Refreshed: 200  
✅ `10:36:37` …a new refresh token and a new access token  
✅ `10:36:37` …the new access token reaches the plugin  
✅ `10:36:37` The spent token again, within 30 s (a lost answer retried): 200  
✅ `10:36:37` …the very same answer, replayed  
✅ `10:36:37` …the grant stays live  
✅ `10:36:37` Refreshed again  
ℹ️ `10:36:37` Waiting out the grace window of the token just spent (30 s)...  
✅ `10:37:10` The spent token after its window: 400 invalid_grant  
✅ `10:37:10` …the grant ended: reuse  
✅ `10:37:10` Its live access token is refused at once: 401 invalid_token  
✅ `10:37:11` …and the one before it  
✅ `10:37:11` Its current refresh token: 400 invalid_grant  
✅ `10:37:11` Audited once: native-app.grant.reuse-detected  
✅ `10:37:11` Admins notified of the reuse  

## The app signs out (token revocation)

✅ `10:37:12` Signed in on "E2E Tablet"  
✅ `10:37:12` POST /api/oidc/revocation with its refresh token: 200  
✅ `10:37:12` …the grant ended: revoked_by_client  
✅ `10:37:13` …its access token is refused at once  

## Grants per device: listed and ended by the administrator

✅ `10:37:15` GET …/grants?status=live: "E2E Laptop" and "E2E Watch"  
✅ `10:37:15` …status=ended: the phone (reuse) and the tablet (signed out)  
✅ `10:37:15` …each with a summary of its user agent  
✅ `10:37:15` lamaste-server native-apps grants lamaste-native-e2e64app --status all --json: the four devices  
✅ `10:37:16` lamaste-server users native-grants e2e64-person-393345 --json: the person's live devices  
✅ `10:37:16` lamaste-server native-apps revoke --grant: one grant ended  
✅ `10:37:16` …revoked_by_admin  
✅ `10:37:16` …its access token refused at once  
✅ `10:37:17` …its refresh token refused  
✅ `10:37:17` DELETE /api/native-apps/lamaste-native-e2e64app/grants/<id>: one grant ended  
✅ `10:37:17` …revoked_by_admin  
✅ `10:37:17` …its access token refused at once  
✅ `10:37:17` …its refresh token refused  
✅ `10:37:18` Audited: native-app.grant.revoked, revoked_by_admin, twice  

## Lifetimes: absolute and idle

✅ `10:37:20` Two more devices signed in, both reaching the plugin  
✅ `10:37:20` "E2E Desk"'s grant moved past its absolute lifetime (its row in state.db, as the database's owner)  
✅ `10:37:20` …its access token is refused at once, unexpired as it is  
✅ `10:37:21` …its refresh: 400 invalid_grant  
✅ `10:37:21` …ended: absolute_expired  
✅ `10:37:21` "E2E Car"'s grant made idle a minute longer than the client's 30 days  
✅ `10:37:21` …its access token is refused at once  
✅ `10:37:21` …its refresh: 400 invalid_grant  
✅ `10:37:22` …ended: idle_expired  

## The client disabled, then enabled again

✅ `10:37:24` PATCH /api/native-apps/lamaste-native-e2e64app {enabled: false}  
✅ `10:37:24` …its live grant ended: client_disabled  
✅ `10:37:24` …its access token refused  
✅ `10:37:24` …its refresh refused  
✅ `10:37:24` Authelia no longer knows the client: nobody signs in with it  
✅ `10:37:25` Enabled again  
✅ `10:37:27` e2e64-person-393345 signs in to Authelia again (it restarted)  
✅ `10:37:28` …a new sign-in works and reaches the plugin  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `70` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `70` |

ℹ️ `10:37:28` Cleaning up test resources...  
