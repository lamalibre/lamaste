# Lamaste E2E: 65 — Native app: sign-ins end with the person's standing (Three-VM)

> Started at `2026-11-10 17:10:35 UTC`


## Pre-flight

✅ `17:10:35` Onboarding is complete  
✅ `17:10:35` Agent test-agent is enrolled on the host  
✅ `17:10:35` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `17:10:36` The agent VM's lamaste-agent has the apphost command  
ℹ️ `17:10:36` Hosting agent: test-agent, relay domain test.lamaste.local, site e2e65app.test.lamaste.local  
✅ `17:10:36` The agent VM's Node.js has node:sqlite and the visitor VM has oathtool  

## Two plugins on one site, a native client, four people signed in

✅ `17:10:38` Fixtures built: e2e-nat65a (signInEvents, a web tree), e2e-nat65b  
✅ `17:10:54` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-nat65a-server, @lamalibre/e2e-nat65a-agent, @lamalibre/e2e-nat65b-server, @lamalibre/e2e-nat65b-agent )  
✅ `17:10:54` The agent VM reaches it at http://10.13.37.1:4874  
✅ `17:10:55` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T17:10:55.266Z"})  
✅ `17:10:55` …through its own OIDC client  
✅ `17:10:56` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `17:10:57` User e2e65-disabled-330635 created  
✅ `17:10:58` User e2e65-erased-330635 created  
✅ `17:10:58` User e2e65-member-330635 created  
✅ `17:10:59` User e2e65-roleless-330635 created  
✅ `17:11:03` Installed and approved: e2e-nat65a  
✅ `17:11:03` …its approved identity block declares signInEvents  
✅ `17:11:08` Installed and approved: e2e-nat65b  
✅ `17:11:08` …its identity block does not  
✅ `17:11:09` e2e-nat65a's web surface created on e2e65app.test.lamaste.local  
✅ `17:11:20` e2e-nat65a hosted ()  
✅ `17:11:31` e2e-nat65b hosted ()  
✅ `17:11:31` Both ready, the site served  
✅ `17:11:32` e2e-nat65b joins the site  
✅ `17:11:33` Native client lamaste-native-e2e65app registered for the site  
✅ `17:11:34` e2e65-disabled-330635, e2e65-erased-330635 and e2e65-member-330635 entitled on both plugins; e2e65-roleless-330635 on e2e-nat65a alone  
✅ `17:11:35` Authelia knows the client; the audiences hold the people  
✅ `17:12:07` The four signed in to Authelia from the visitor VM  
✅ `17:12:11` Each signed in on their device; each reaches e2e-nat65a  
✅ `17:12:12` Four live grants  

## Sign-in events reach the plugin that declares them, and only it

✅ `17:12:12` e2e-nat65a's agent half holds one sign-in event per person, naming lamaste-native-e2e65app  
✅ `17:12:13` …each with its time, a sequence number and the client's kind  
✅ `17:12:13` e2e-nat65b declares none: its agent half holds no event  
✅ `17:12:13` …and never received the call  

## Disabled, erased, removed from the domain, role lost

✅ `17:12:13` e2e65-disabled-330635 disabled  
✅ `17:12:14` e2e65-erased-330635 deleted and erased  
✅ `17:12:14` e2e65-member-330635 removed from test.lamaste.local's members  
✅ `17:12:14` e2e65-roleless-330635's only entitlement (its Gatekeeper grant) revoked  
✅ `17:12:14` e2e65-disabled-330635's grant ended: standing:disabled  
✅ `17:12:14` …e2e65-disabled-330635's access token is refused (403)  
✅ `17:12:15` …e2e65-disabled-330635's refresh token: 400 invalid_grant  
✅ `17:12:15` e2e65-erased-330635's grant is gone with them: erased, nothing listed  
✅ `17:12:15` …e2e65-erased-330635's access token is refused (403)  
✅ `17:12:15` …e2e65-erased-330635's refresh token: 400 invalid_grant  
✅ `17:12:15` e2e65-member-330635's grant ended: standing:not_member  
✅ `17:12:16` …e2e65-member-330635's access token is refused (403)  
✅ `17:12:16` …e2e65-member-330635's refresh token: 400 invalid_grant  
✅ `17:12:16` e2e65-roleless-330635's grant ended: standing:no_role  
✅ `17:12:16` …e2e65-roleless-330635's access token is refused (401)  
✅ `17:12:16` …e2e65-roleless-330635's refresh token: 400 invalid_grant  
✅ `17:12:17` No live grant is left  
✅ `17:12:17` Audited: native-app.grant.revoked — disabled, no_role, not_member, removed (the erased person's grant ended at the removal)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `52` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `52` |

ℹ️ `17:12:17` Cleaning up test resources...  
