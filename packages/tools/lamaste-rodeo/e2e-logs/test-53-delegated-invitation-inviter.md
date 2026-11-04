# Lamaste E2E: 53 — Delegated invitations: an inviter grants only what it may (Three-VM)

> Started at `2026-11-04 14:46:13 UTC`


## Pre-flight

✅ `14:46:13` Onboarding is complete  
✅ `14:46:13` Agent test-agent is enrolled on the host  
✅ `14:46:13` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:46:14` The agent VM's lamaste-agent has the apphost command  
✅ `14:46:14` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `14:46:14` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a coordinator, a viewer, an outsider (external members of B); a member of A alone

✅ `14:46:15` Domain lamaste-second.local added (201)  
✅ `14:46:15` …pending until activated  
✅ `14:46:15` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:46:15` …the one required record is auth.lamaste-second.local  
✅ `14:46:16` lamaste-second.local is active  
✅ `14:46:17` User e2e53-coord created, member of lamaste-second.local (external)  
✅ `14:46:17` User e2e53-viewer created, member of lamaste-second.local (external)  
✅ `14:46:18` User e2e53-outsider created, member of lamaste-second.local (external)  
✅ `14:46:19` User e2e53-mem-a created, member of test.lamaste.local  

## The plugin, with an inviting role, installed, approved, hosted, on B

✅ `14:46:19` Fixture built: @lamalibre/e2e-xinv-server (coordinator invites coordinator and viewer; web surface e2e53web)  
✅ `14:46:22` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent )  
✅ `14:46:22` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:46:23` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T14:46:23.403Z"})  
✅ `14:46:23` …through its own OIDC client  
✅ `14:46:27` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:46:29` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `14:46:29` …approved  
✅ `14:46:29` …moved to B, before any surface  
✅ `14:46:40` …hosted on test-agent ()  
✅ `14:46:56` …its hosting is up  
✅ `14:46:57` …ready: its agent half's first complete sync ended at the head  
✅ `14:46:57` The approved block names what the coordinator may give  

## The policy: off until the administrator enables it, and only with a restricted web surface

✅ `14:46:57` A plugin nobody set a policy for: off, the defaults  
✅ `14:46:57` …its inviting role listed  
✅ `14:46:57` Enabling with no e-mail domain: 400  
✅ `14:46:57` Enabling with no web surface: 409  
✅ `14:46:57` …invitations_unavailable  
✅ `14:47:02` POST /api/plugins/e2e-xinv/web-surface {accessMode: authenticated}  
✅ `14:47:02` …the site e2e53web.lamaste-second.local, authenticated, on B  
✅ `14:47:02` …served  
✅ `14:47:02` Enabling on an authenticated web surface: 409 (it refuses external members)  
✅ `14:47:02` …it says why  
✅ `14:47:05` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `14:47:05` …the site e2e53web.lamaste-second.local, restricted, on B  
✅ `14:47:05` …served  

## The people: roles and the site's grant, as the administrator gives them

✅ `14:47:19` e2e53-coord entitled as coordinator  
✅ `14:47:25` e2e53-viewer entitled as viewer  
✅ `14:47:26` Granted site 0afc91dc-bb89-4aec-b295-821f659d8a14 to user e2e53-coord  
✅ `14:47:26` Granted site 0afc91dc-bb89-4aec-b295-821f659d8a14 to user e2e53-viewer  
✅ `14:47:27` The audience holds e2e53-coord as coordinator  
✅ `14:47:27` …and e2e53-viewer as viewer  
✅ `14:47:27` users.yml gives e2e53-coord the site's hostname as a group  
✅ `14:47:29` e2e53-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:47:31` e2e53-viewer signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:47:32` e2e53-outsider signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:47:34` e2e53-mem-a signed in at auth.lamaste-second.local (password, TOTP)  

## Off: the coordinator is refused until the policy is enabled

✅ `14:47:34` GET with the policy off: 403  
✅ `14:47:34` …invitations_unavailable (never why)  
✅ `14:47:35` Enabled, for addresses under example.test  
✅ `14:47:35` …available  

## The inviter's page on auth.<B>: its own origin, by hash, unframed

✅ `14:47:35` GET auth.<B>/invitations/e2e-xinv: 200  
✅ `14:47:35` …the stock inviter's page  
✅ `14:47:35` …nothing from a foreign host  
✅ `14:47:35` …the CSP names the served script's hash  
✅ `14:47:35` …and the served style's  
✅ `14:47:35` …nothing frames it  
✅ `14:47:35` …nothing else loads  
✅ `14:47:35` X-Frame-Options: DENY  
✅ `14:47:35` Cross-Origin-Opener-Policy: same-origin  
✅ `14:47:35` Referrer-Policy: same-origin (no-referrer would make a fetch POST send Origin: null)  
✅ `14:47:35` Cache-Control: no-store  

## Who may ask

✅ `14:47:35` No session: 401  
✅ `14:47:35` …JSON, never a redirect (the page sends the browser to sign in)  
✅ `14:47:35` e2e53-mem-a, a member of A alone: 403 at auth.<B>  
✅ `14:47:35` e2e53-outsider, external on B with no role and no site: 403  

## What the coordinator may give, and what the viewer may not

✅ `14:47:35` e2e53-coord: GET 200  
✅ `14:47:35` …the roles they may give, editor not among them  
✅ `14:47:35` …the bounds; none open  
✅ `14:47:35` …the way back to the plugin's site  
✅ `14:47:35` …never cached  
✅ `14:47:36` editor, which the coordinator may not give: 403  
✅ `14:47:36` …role_not_grantable  
✅ `14:47:36` A role that does not exist: 403  
✅ `14:47:36` An address under another domain: 400  
✅ `14:47:36` …email_domain_not_allowed  
✅ `14:47:36` A body naming anything else (groups): 400, strict  
✅ `14:47:36` e2e53-viewer, whose role invites nobody: 403  
✅ `14:47:36` …role_not_grantable  

## From nowhere but the sign-in host's page

✅ `14:47:36` A POST the plugin's own pages would send (Origin of its site, same-site): 403  
✅ `14:47:36` …its Origin alone: 403  
✅ `14:47:37` …a same-site fetch alone: 403  
✅ `14:47:37` …no Origin at all: 403  
✅ `14:47:37` The same POST on the plugin's own host makes nothing  
✅ `14:47:37` …no link  
✅ `14:47:37` …and a GET there reads nothing  
✅ `14:47:37` No invitation was made by any of those  

## An invitation: a link the inviter sends themselves

✅ `14:47:37` e2e53-coord invites ayse@example.test as viewer: 201  
✅ `14:47:37` …a link on the sign-in host, the token in its fragment  
✅ `14:47:37` The panel lists it with its inviter  
✅ `14:47:37` e2e53-coord sees their own, pending  
✅ `14:47:37` …one open  
✅ `14:47:38` e2e53-viewer sees none of it  

## The link opens on B's sign-in host alone

✅ `14:47:38` POST auth.<B>/api/invite/lookup: 200  
✅ `14:47:38` …what it is for and who invited, by display name  
✅ `14:47:38` …never the inviter's username  
✅ `14:47:38` auth.<A>: 404, as no invitation at all  
✅ `14:47:38` :9292, Host and X-Forwarded-Host naming auth.<B>: 404  
✅ `14:47:38` The panel vhost, X-Forwarded-Host naming auth.<B>: 404  
✅ `14:47:38` auth.<A>, X-Forwarded-Host naming auth.<B>: 404  
✅ `14:47:38` The token in a URL opens nothing: the path routes are gone  
✅ `14:47:38` …it says nothing of the invitation  
✅ `14:47:38` A token that was never made: 404  
✅ `14:47:39` The invitation page at /invite: 200 (the fragment never reaches the server)  
✅ `14:47:39` …its CSP names the served script's hash  
✅ `14:47:39` …no foreign script: the QR is the panel's  

## A username anything names is refused, with one answer

✅ `14:47:39` User e2e53-gone created, member of lamaste-second.local (external)  
✅ `14:47:40` Granted tunnel e2e53-a-restricted-tunnel to user e2e53-future  
✅ `14:47:40` e2e53-future, which a Gatekeeper grant names for a user still to come: 409  
✅ `14:47:40` …username_unavailable  
✅ `14:47:40` e2e53-gone, a removed user's: 409  
✅ `14:47:40` …the same answer, whatever named it  
✅ `14:47:41` e2e53-coord, a living user's: 409  
✅ `14:47:41` …the same answer  
✅ `14:47:41` The invitation stays pending; no name is held  

## Accepted: a new external member of B, with the one role and the site

✅ `14:47:41` POST auth.<B>/api/invite/accept: 200  
✅ `14:47:41` …e2e53-invitee, access complete, sent to the plugin's site  
✅ `14:47:41` …the QR, drawn by the panel  
✅ `14:47:41` …with its TOTP secret  
✅ `14:47:42` The directory holds them by id  
✅ `14:47:42` The invitation is accepted, complete; its copy of the address gone  
✅ `14:47:42` e2e53-invitee is an external member of B, of nothing else  
✅ `14:47:42` …no Authelia group  
✅ `14:47:42` users.yml gives them the site's hostname, as a grant does  
✅ `14:47:42` …and holds nothing else in users.yml  
✅ `14:47:43` Gatekeeper holds exactly the role and the site's grant  
✅ `14:47:43` …with the role asked for  
✅ `14:47:43` The audience holds them as viewer  
✅ `14:47:43` …and the agent half's projection: the plugin learned of them through the feed  
✅ `14:47:43` …with the role and the declared attributes  

## They reach the plugin

✅ `14:47:44` e2e53-invitee signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:47:44` e2e53-invitee: the shell, signed in with the factor the invitation gave  
✅ `14:47:45` …GET /api/e2e-xinv/app/echo 200  
✅ `14:47:45` …the agent half sees the directory's user and their role  

## One use

✅ `14:47:45` The link again: lookup 410  
✅ `14:47:45` …accept 410  

## The cap

✅ `14:47:45` The administrator lowers the cap to one open invitation  
✅ `14:47:45` One more for e2e53-coord: 201  
✅ `14:47:45` …a link on the sign-in host, the token in its fragment  
✅ `14:47:45` The next: 409  
✅ `14:47:45` …invitation_cap, the inviter's  
✅ `14:47:45` People by invitation capped at 2 (one joined, one open)  
✅ `14:47:46` The next: 409  
✅ `14:47:46` …invitation_cap, the plugin's  
✅ `14:47:46` e2e53-coord revokes their own pending one  

## Oversight: audited with no address, the administrators notified

✅ `14:47:46` invitation.created by the inviter's id, the address's domain alone  
✅ `14:47:46` invitation.accepted by id, with its inviter  
✅ `14:47:46` No audit entry holds an address  
✅ `14:47:46` The administrators were told someone joined, once  

## No token at rest or in a log

✅ `14:47:46` The token is in no journal of the panel or Gatekeeper  
✅ `14:47:47` …in no nginx log line but the one this spec's GET of the removed path made  
✅ `14:47:47` …and state.db does not hold it  
✅ `14:47:47` …anywhere in its bytes, its write-ahead log included  

## Nothing restarted Authelia

✅ `14:47:47` An invitation, its acceptance and a new user: Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `159` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `159` |

ℹ️ `14:47:47` Cleaning up test resources...  
