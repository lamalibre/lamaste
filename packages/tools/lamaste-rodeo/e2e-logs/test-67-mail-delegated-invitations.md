# Lamaste E2E: 67 — Mail: a delegated invitation mailed, and a new link (Three-VM)

> Started at `2026-11-11 11:32:10 UTC`


## Pre-flight

✅ `11:32:10` Onboarding is complete  
✅ `11:32:11` Agent test-agent is enrolled on the host  
✅ `11:32:11` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `11:32:11` The agent VM's lamaste-agent has the apphost command  
✅ `11:32:11` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `11:32:12` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  
✅ `11:32:14` Domain lamaste-second.local added (201)  
✅ `11:32:14` …pending until activated  
✅ `11:32:14` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `11:32:14` …the one required record is auth.lamaste-second.local  
✅ `11:32:15` lamaste-second.local is active  
✅ `11:32:16` B speaks Turkish  
✅ `11:32:22` The SMTP sink answers on the host VM's 127.0.0.1:2467  
✅ `11:32:23` PUT /api/settings/mail: the relay's transport to the sink  

## The inviting plugin on B, hosted, served

✅ `11:32:23` Fixture built: @lamalibre/e2e-pmail-server  
✅ `11:32:33` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-pmail-server, @lamalibre/e2e-pmail-agent )  
✅ `11:32:33` The agent VM reaches it at http://10.13.37.1:4874  
✅ `11:32:34` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T11:32:34.338Z"})  
✅ `11:32:34` …through its own OIDC client  
✅ `11:32:35` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `11:32:40` Installed @lamalibre/e2e-pmail-server@1.0.0  
✅ `11:32:40` …approved  
✅ `11:32:40` …moved to B, before any surface  
✅ `11:32:51` …hosted on test-agent ()  
✅ `11:33:11` …its hosting is up  
✅ `11:33:11` …ready: its agent half's first complete sync ended at the head  
✅ `11:33:15` POST /api/plugins/e2e-pmail/web-surface {accessMode: restricted}  
✅ `11:33:15` …the site e2e59web.lamaste-second.local, restricted, on B  
✅ `11:33:15` …served  

## A coordinator, invitations allowed to e2e-mail.example.com

✅ `11:33:16` User e2e59-coord created, member of lamaste-second.local (external)  
✅ `11:33:16` e2e59-coord entitled as coordinator  
✅ `11:33:16` Granted site 5ea42d6a-8ac9-458c-88e9-1a55fc039564 to user e2e59-coord  
✅ `11:33:16` The audience holds e2e59-coord as coordinator  
✅ `11:33:17` Invitations enabled for e2e-pmail, to e2e-mail.example.com  
✅ `11:33:19` e2e59-coord signed in at auth.lamaste-second.local (password, TOTP)  

## The inviter's page: the mail and "new link" words, in Turkish

✅ `11:33:19` auth.lamaste-second.local/invitations/e2e-pmail: lang="tr"  
✅ `11:33:19` …its data block: invitations.reissue Yeni bağlantı  
✅ `11:33:19` …and the mailed / not-mailed words  

## The invitation mailed, in Turkish

✅ `11:33:19` e2e59-coord invites deniz-1794396730@e2e-mail.example.com as viewer: 201  
✅ `11:33:19` …the answer: mail sent, no link (it goes by mail only)  
✅ `11:33:19` …no token anywhere in the answer  
✅ `11:33:20` The sink holds the invitation  
✅ `11:33:20` …From the relay's sender  
✅ `11:33:20` …in Turkish (Davetiniz: E2E App Host (main))  
✅ `11:33:20` …its link on auth.lamaste-second.local  
✅ `11:33:20` The inviter's list: mail sent  
✅ `11:33:20` The administrator's list: mail sent  
✅ `11:33:20` A name that reads as a host name: 400  
✅ `11:33:20` …invalid_request, field displayName  

## A new link: the old one dead, the new one mailed

✅ `11:33:21` POST …/e2e-pmail/8f3bc51b-b4cb-414d-8594-2de6caf52745/reissue: 200  
✅ `11:33:21` …the same invitation, mailed again, no link answered  
✅ `11:33:21` The sink holds the new link  
✅ `11:33:21` …a new token  
✅ `11:33:21` The old link is dead  
✅ `11:33:21` The new one answers  
✅ `11:33:21` The administrator's list: reissued  
✅ `11:33:22` Accepted with the new link  
✅ `11:33:22` An accepted invitation gets no new link: 409  
✅ `11:33:22` …invitation_not_pending  

## No transport: not-configured, the link answered to the inviter

✅ `11:33:33` e2e59-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `11:33:33` Another invitation: 201  
✅ `11:33:33` …mail not-configured, its link answered  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `62` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `62` |

ℹ️ `11:33:33` Cleaning up test resources...  
