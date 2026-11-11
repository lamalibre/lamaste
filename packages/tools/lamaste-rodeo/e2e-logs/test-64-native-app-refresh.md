# Lamaste E2E: 64 — Native app: refresh tokens and grants (Three-VM)

> Started at `2026-11-10 17:12:55 UTC`


## Pre-flight

✅ `17:12:55` Onboarding is complete  
✅ `17:12:55` Agent test-agent is enrolled on the host  
✅ `17:12:55` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `17:12:56` The agent VM's lamaste-agent has the apphost command  
ℹ️ `17:12:56` Hosting agent: test-agent, relay domain test.lamaste.local, site e2e64app.test.lamaste.local  
✅ `17:12:56` The agent VM's Node.js has node:sqlite and the visitor VM has oathtool  

## The plugin's site, a native client, a person signed in to Authelia

✅ `17:13:07` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-nat64-server, @lamalibre/e2e-nat64-agent )  
✅ `17:13:07` The agent VM reaches it at http://10.13.37.1:4874  
✅ `17:13:08` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T17:13:08.341Z"})  
✅ `17:13:08` …through its own OIDC client  
✅ `17:13:09` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `17:13:10` User e2e64-person-330775 created  
✅ `17:13:15` Installed and approved: e2e-nat64  
✅ `17:13:16` Its web surface created on e2e64app.test.lamaste.local  
✅ `17:13:27` Hosted on test-agent ()  
✅ `17:13:27` Ready and served  
✅ `17:13:28` Native client lamaste-native-e2e64app registered for the site  
✅ `17:13:28` e2e64-person-330775 entitled as viewer  
✅ `17:13:28` Authelia knows the client; e2e64-person-330775 is in the audience  
✅ `17:13:33` e2e64-person-330775 signed in to Authelia from the visitor VM  

## Rotation, the grace window, and a spent token reused

✅ `17:13:34` Signed in on "E2E Phone"  
✅ `17:13:34` Its access token reaches the plugin  
✅ `17:13:34` Refreshed: 200  
✅ `17:13:34` …a new refresh token and a new access token  
✅ `17:13:34` …the new access token reaches the plugin  
✅ `17:13:34` The spent token again, within 30 s (a lost answer retried): 200  
✅ `17:13:34` …the very same answer, replayed  
✅ `17:13:34` …the grant stays live  
✅ `17:13:35` Refreshed again  
ℹ️ `17:13:35` Waiting out the grace window of the token just spent (30 s)...  
✅ `17:14:07` The spent token after its window: 400 invalid_grant  
✅ `17:14:07` …the grant ended: reuse  
✅ `17:14:07` Its live access token is refused at once: 401 invalid_token  
✅ `17:14:07` …and the one before it  
✅ `17:14:08` Its current refresh token: 400 invalid_grant  
✅ `17:14:08` Audited once: native-app.grant.reuse-detected  
✅ `17:14:08` Admins notified of the reuse  

## The app signs out (token revocation)

✅ `17:14:09` Signed in on "E2E Tablet"  
✅ `17:14:09` POST /api/oidc/revocation with its refresh token: 200  
✅ `17:14:09` …the grant ended: revoked_by_client  
✅ `17:14:09` …its access token is refused at once  

## Grants per device: listed and ended by the administrator

✅ `17:14:11` GET …/grants?status=live: "E2E Laptop" and "E2E Watch"  
✅ `17:14:11` …status=ended: the phone (reuse) and the tablet (signed out)  
✅ `17:14:11` …each with a summary of its user agent  
✅ `17:14:12` lamaste-server native-apps grants lamaste-native-e2e64app --status all --json: the four devices  
✅ `17:14:12` lamaste-server users native-grants e2e64-person-330775 --json: the person's live devices  
✅ `17:14:12` lamaste-server native-apps revoke --grant: one grant ended  
✅ `17:14:13` …revoked_by_admin  
✅ `17:14:13` …its access token refused at once  
✅ `17:14:13` …its refresh token refused  
✅ `17:14:13` DELETE /api/native-apps/lamaste-native-e2e64app/grants/<id>: one grant ended  
✅ `17:14:13` …revoked_by_admin  
✅ `17:14:14` …its access token refused at once  
✅ `17:14:14` …its refresh token refused  
✅ `17:14:14` Audited: native-app.grant.revoked, revoked_by_admin, twice  

## Lifetimes: absolute and idle

✅ `17:14:16` Two more devices signed in, both reaching the plugin  
✅ `17:14:16` "E2E Desk"'s grant moved past its absolute lifetime (its row in state.db, as the database's owner)  
✅ `17:14:17` …its access token is refused at once, unexpired as it is  
✅ `17:14:17` …its refresh: 400 invalid_grant  
✅ `17:14:17` …ended: absolute_expired  
✅ `17:14:17` "E2E Car"'s grant made idle a minute longer than the client's 30 days  
✅ `17:14:17` …its access token is refused at once  
✅ `17:14:17` …its refresh: 400 invalid_grant  
✅ `17:14:18` …ended: idle_expired  

## The client disabled, then enabled again

✅ `17:14:20` PATCH /api/native-apps/lamaste-native-e2e64app {enabled: false}  
✅ `17:14:20` …its live grant ended: client_disabled  
✅ `17:14:20` …its access token refused  
✅ `17:14:20` …its refresh refused  
✅ `17:14:20` Authelia no longer knows the client: nobody signs in with it  
✅ `17:14:21` Enabled again  
✅ `17:14:23` e2e64-person-330775 signs in to Authelia again (it restarted)  
✅ `17:14:24` …a new sign-in works and reaches the plugin  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `70` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `70` |

ℹ️ `17:14:24` Cleaning up test resources...  
