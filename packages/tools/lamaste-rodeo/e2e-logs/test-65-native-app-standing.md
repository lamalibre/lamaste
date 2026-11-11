# Lamaste E2E: 65 — Native app: sign-ins end with the person's standing (Three-VM)

> Started at `2026-11-11 10:37:45 UTC`


## Pre-flight

✅ `10:37:45` Onboarding is complete  
✅ `10:37:45` Agent test-agent is enrolled on the host  
✅ `10:37:46` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:37:46` The agent VM's lamaste-agent has the apphost command  
ℹ️ `10:37:46` Hosting agent: test-agent, relay domain test.lamaste.local, site e2e65app.test.lamaste.local  
✅ `10:37:46` The agent VM's Node.js has node:sqlite and the visitor VM has oathtool  

## Two plugins on one site, a native client, four people signed in

✅ `10:37:48` Fixtures built: e2e-nat65a (signInEvents, a web tree), e2e-nat65b  
✅ `10:38:04` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-nat65a-server, @lamalibre/e2e-nat65a-agent, @lamalibre/e2e-nat65b-server, @lamalibre/e2e-nat65b-agent )  
✅ `10:38:04` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:38:05` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T10:38:05.954Z"})  
✅ `10:38:05` …through its own OIDC client  
✅ `10:38:06` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:38:08` User e2e65-disabled-393465 created  
✅ `10:38:08` User e2e65-erased-393465 created  
✅ `10:38:09` User e2e65-member-393465 created  
✅ `10:38:09` User e2e65-roleless-393465 created  
✅ `10:38:14` Installed and approved: e2e-nat65a  
✅ `10:38:14` …its approved identity block declares signInEvents  
✅ `10:38:18` Installed and approved: e2e-nat65b  
✅ `10:38:18` …its identity block does not  
✅ `10:38:22` e2e-nat65a's web surface created on e2e65app.test.lamaste.local  
✅ `10:38:33` e2e-nat65a hosted ()  
✅ `10:38:44` e2e-nat65b hosted ()  
✅ `10:38:44` Both ready, the site served  
✅ `10:38:44` e2e-nat65b joins the site  
✅ `10:38:45` Native client lamaste-native-e2e65app registered for the site  
✅ `10:38:46` e2e65-disabled-393465, e2e65-erased-393465 and e2e65-member-393465 entitled on both plugins; e2e65-roleless-393465 on e2e-nat65a alone  
✅ `10:38:47` Authelia knows the client; the audiences hold the people  
✅ `10:39:08` The four signed in to Authelia from the visitor VM  
✅ `10:39:12` Each signed in on their device; each reaches e2e-nat65a  
✅ `10:39:12` Four live grants  

## Sign-in events reach the plugin that declares them, and only it

✅ `10:39:13` e2e-nat65a's agent half holds one sign-in event per person, naming lamaste-native-e2e65app  
✅ `10:39:13` …each with its time, a sequence number and the client's kind  
✅ `10:39:13` e2e-nat65b declares none: its agent half holds no event  
✅ `10:39:14` …and never received the call  

## Disabled, erased, removed from the domain, role lost

✅ `10:39:14` e2e65-disabled-393465 disabled  
✅ `10:39:14` e2e65-erased-393465 deleted and erased  
✅ `10:39:14` e2e65-member-393465 removed from test.lamaste.local's members  
✅ `10:39:15` e2e65-roleless-393465's only entitlement (its Gatekeeper grant) revoked  
✅ `10:39:15` e2e65-disabled-393465's grant ended: standing:disabled  
✅ `10:39:15` …e2e65-disabled-393465's access token is refused (403)  
✅ `10:39:15` …e2e65-disabled-393465's refresh token: 400 invalid_grant  
✅ `10:39:15` e2e65-erased-393465's grant is gone with them: erased, nothing listed  
✅ `10:39:16` …e2e65-erased-393465's access token is refused (403)  
✅ `10:39:16` …e2e65-erased-393465's refresh token: 400 invalid_grant  
✅ `10:39:16` e2e65-member-393465's grant ended: standing:not_member  
✅ `10:39:16` …e2e65-member-393465's access token is refused (403)  
✅ `10:39:16` …e2e65-member-393465's refresh token: 400 invalid_grant  
✅ `10:39:17` e2e65-roleless-393465's grant ended: standing:no_role  
✅ `10:39:17` …e2e65-roleless-393465's access token is refused (401)  
✅ `10:39:17` …e2e65-roleless-393465's refresh token: 400 invalid_grant  
✅ `10:39:17` No live grant is left  
✅ `10:39:17` Audited: native-app.grant.revoked — disabled, no_role, not_member, removed (the erased person's grant ended at the removal)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `52` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `52` |

ℹ️ `10:39:17` Cleaning up test resources...  
