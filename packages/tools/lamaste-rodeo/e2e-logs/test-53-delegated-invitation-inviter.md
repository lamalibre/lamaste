# Lamaste E2E: 53 — Delegated invitations: an inviter grants only what it may (Three-VM)

> Started at `2026-11-09 13:52:43 UTC`


## Pre-flight

✅ `13:52:43` Onboarding is complete  
✅ `13:52:43` Agent test-agent is enrolled on the host  
✅ `13:52:43` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:52:44` The agent VM's lamaste-agent has the apphost command  
✅ `13:52:44` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `13:52:44` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a coordinator, a viewer, an outsider (external members of B); a member of A alone

✅ `13:52:45` Domain lamaste-second.local added (201)  
✅ `13:52:45` …pending until activated  
✅ `13:52:45` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `13:52:45` …the one required record is auth.lamaste-second.local  
✅ `13:52:46` lamaste-second.local is active  
✅ `13:52:46` User e2e53-coord created, member of lamaste-second.local (external)  
✅ `13:52:47` User e2e53-viewer created, member of lamaste-second.local (external)  
✅ `13:52:48` User e2e53-outsider created, member of lamaste-second.local (external)  
✅ `13:52:48` User e2e53-mem-a created, member of test.lamaste.local  

## The plugin, with an inviting role, installed, approved, hosted, on B

✅ `13:52:48` Fixture built: @lamalibre/e2e-xinv-server (coordinator invites coordinator and viewer; web surface e2e53web)  
✅ `13:52:57` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent )  
✅ `13:52:57` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:52:58` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T13:52:58.546Z"})  
✅ `13:52:58` …through its own OIDC client  
✅ `13:53:02` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:53:07` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `13:53:07` …approved  
✅ `13:53:07` …moved to B, before any surface  
✅ `13:53:18` …hosted on test-agent ()  
✅ `13:53:31` …its hosting is up  
✅ `13:53:31` …ready: its agent half's first complete sync ended at the head  
✅ `13:53:31` The approved block names what the coordinator may give  

## The policy: off until the administrator enables it, and only with a restricted web surface

✅ `13:53:31` A plugin nobody set a policy for: off, the defaults  
✅ `13:53:31` …its inviting role listed  
✅ `13:53:31` Enabling with no e-mail domain: 400  
✅ `13:53:31` Enabling with no web surface: 409  
✅ `13:53:31` …invitations_unavailable  
✅ `13:53:33` POST /api/plugins/e2e-xinv/web-surface {accessMode: authenticated}  
✅ `13:53:33` …the site e2e53web.lamaste-second.local, authenticated, on B  
✅ `13:53:33` …served  
✅ `13:53:33` Enabling on an authenticated web surface: 409 (it refuses external members)  
✅ `13:53:33` …it says why  
✅ `13:53:35` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `13:53:35` …the site e2e53web.lamaste-second.local, restricted, on B  
✅ `13:53:35` …served  

## The people: roles and the site's grant, as the administrator gives them

✅ `13:53:35` e2e53-coord entitled as coordinator  
✅ `13:53:36` e2e53-viewer entitled as viewer  
✅ `13:53:36` Granted site 4cc55e8d-fd32-48eb-aca5-a74b3f7cb783 to user e2e53-coord  
✅ `13:53:36` Granted site 4cc55e8d-fd32-48eb-aca5-a74b3f7cb783 to user e2e53-viewer  
✅ `13:53:36` The audience holds e2e53-coord as coordinator  
✅ `13:53:36` …and e2e53-viewer as viewer  
✅ `13:53:36` users.yml gives e2e53-coord the site's hostname as a group  
✅ `13:53:38` e2e53-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:53:40` e2e53-viewer signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:53:41` e2e53-outsider signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:53:43` e2e53-mem-a signed in at auth.lamaste-second.local (password, TOTP)  

## Off: the coordinator is refused until the policy is enabled

✅ `13:53:43` GET with the policy off: 403  
✅ `13:53:43` …invitations_unavailable (never why)  
✅ `13:53:44` Enabled, for addresses under example.test  
✅ `13:53:44` …available  

## The inviter's page on auth.<B>: its own origin, by hash, unframed

✅ `13:53:44` GET auth.<B>/invitations/e2e-xinv: 200  
✅ `13:53:44` …the stock inviter's page  
✅ `13:53:44` …nothing from a foreign host  
✅ `13:53:44` …the CSP names the served script's hash  
✅ `13:53:44` …and the served style's  
✅ `13:53:44` …nothing frames it  
✅ `13:53:44` …nothing else loads  
✅ `13:53:44` X-Frame-Options: DENY  
✅ `13:53:44` Cross-Origin-Opener-Policy: same-origin  
✅ `13:53:44` Referrer-Policy: same-origin (no-referrer would make a fetch POST send Origin: null)  
✅ `13:53:44` Cache-Control: no-store  

## Who may ask

✅ `13:53:44` No session: 401  
✅ `13:53:44` …JSON, never a redirect (the page sends the browser to sign in)  
✅ `13:53:44` e2e53-mem-a, a member of A alone: 403 at auth.<B>  
✅ `13:53:44` e2e53-outsider, external on B with no role and no site: 403  

## What the coordinator may give, and what the viewer may not

✅ `13:53:44` e2e53-coord: GET 200  
✅ `13:53:44` …the roles they may give, editor not among them  
✅ `13:53:45` …the bounds; none open  
✅ `13:53:45` …the way back to the plugin's site  
✅ `13:53:45` …never cached  
✅ `13:53:45` editor, which the coordinator may not give: 403  
✅ `13:53:45` …role_not_grantable  
✅ `13:53:45` A role that does not exist: 403  
✅ `13:53:45` An address under another domain: 400  
✅ `13:53:45` …email_domain_not_allowed  
✅ `13:53:45` A body naming anything else (groups): 400, strict  
✅ `13:53:45` e2e53-viewer, whose role invites nobody: 403  
✅ `13:53:45` …role_not_grantable  

## From nowhere but the sign-in host's page

✅ `13:53:45` A POST the plugin's own pages would send (Origin of its site, same-site): 403  
✅ `13:53:45` …its Origin alone: 403  
✅ `13:53:46` …a same-site fetch alone: 403  
✅ `13:53:46` …no Origin at all: 403  
✅ `13:53:46` The same POST on the plugin's own host makes nothing  
✅ `13:53:46` …no link  
✅ `13:53:46` …and a GET there reads nothing  
✅ `13:53:46` No invitation was made by any of those  

## An invitation: a link the inviter sends themselves

✅ `13:53:46` e2e53-coord invites ayse@example.test as viewer: 201  
✅ `13:53:46` …a link on the sign-in host, the token in its fragment  
✅ `13:53:46` The panel lists it with its inviter  
✅ `13:53:46` e2e53-coord sees their own, pending  
✅ `13:53:46` …one open  
✅ `13:53:47` e2e53-viewer sees none of it  

## The link opens on B's sign-in host alone

✅ `13:53:47` POST auth.<B>/api/invite/lookup: 200  
✅ `13:53:47` …what it is for and who invited, by display name  
✅ `13:53:47` …never the inviter's username  
✅ `13:53:47` auth.<A>: 404, as no invitation at all  
✅ `13:53:47` :9292, Host and X-Forwarded-Host naming auth.<B>: 404  
✅ `13:53:47` The panel vhost, X-Forwarded-Host naming auth.<B>: 404  
✅ `13:53:47` auth.<A>, X-Forwarded-Host naming auth.<B>: 404  
✅ `13:53:47` The token in a URL opens nothing: the path routes are gone  
✅ `13:53:47` …it says nothing of the invitation  
✅ `13:53:47` A token that was never made: 404  
✅ `13:53:47` The invitation page at /invite: 200 (the fragment never reaches the server)  
✅ `13:53:47` …its CSP names the served script's hash  
✅ `13:53:47` …no foreign script: the QR is the panel's  

## A username anything names is refused, with one answer

✅ `13:53:48` User e2e53-gone created, member of lamaste-second.local (external)  
✅ `13:53:48` Granted tunnel e2e53-a-restricted-tunnel to user e2e53-future  
✅ `13:53:49` e2e53-future, which a Gatekeeper grant names for a user still to come: 409  
✅ `13:53:49` …username_unavailable  
✅ `13:53:49` e2e53-gone, a removed user's: 409  
✅ `13:53:49` …the same answer, whatever named it  
✅ `13:53:49` e2e53-coord, a living user's: 409  
✅ `13:53:49` …the same answer  
✅ `13:53:49` The invitation stays pending; no name is held  

## Accepted: a new external member of B, with the one role and the site

✅ `13:53:50` POST auth.<B>/api/invite/accept: 200  
✅ `13:53:50` …e2e53-invitee, access complete, sent to the plugin's site  
✅ `13:53:50` …the QR, drawn by the panel  
✅ `13:53:50` …with its TOTP secret  
✅ `13:53:50` The directory holds them by id  
✅ `13:53:50` The invitation is accepted, complete; its copy of the address gone  
✅ `13:53:50` e2e53-invitee is an external member of B, of nothing else  
✅ `13:53:50` …no Authelia group  
✅ `13:53:51` users.yml gives them the site's hostname, as a grant does  
✅ `13:53:51` …and holds nothing else in users.yml  
✅ `13:53:51` Gatekeeper holds exactly the role and the site's grant  
✅ `13:53:51` …with the role asked for  
✅ `13:53:51` The audience holds them as viewer  
✅ `13:53:51` …and the agent half's projection: the plugin learned of them through the feed  
✅ `13:53:51` …with the role and the declared attributes  

## They reach the plugin

✅ `13:53:53` e2e53-invitee signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:53:53` e2e53-invitee: the shell, signed in with the factor the invitation gave  
✅ `13:53:53` …GET /api/e2e-xinv/app/echo 200  
✅ `13:53:53` …the agent half sees the directory's user and their role  

## One use

✅ `13:53:53` The link again: lookup 410  
✅ `13:53:53` …accept 410  

## The cap

✅ `13:53:53` The administrator lowers the cap to one open invitation  
✅ `13:53:53` One more for e2e53-coord: 201  
✅ `13:53:53` …a link on the sign-in host, the token in its fragment  
✅ `13:53:53` The next: 409  
✅ `13:53:53` …invitation_cap, the inviter's  
✅ `13:53:54` People by invitation capped at 2 (one joined, one open)  
✅ `13:53:54` The next: 409  
✅ `13:53:54` …invitation_cap, the plugin's  
✅ `13:53:54` e2e53-coord revokes their own pending one  

## Oversight: audited with no address, the administrators notified

✅ `13:53:54` invitation.created by the inviter's id, the address's domain alone  
✅ `13:53:54` invitation.accepted by id, with its inviter  
✅ `13:53:54` No audit entry holds an address  
✅ `13:53:54` The administrators were told someone joined, once  

## No token at rest or in a log

✅ `13:53:54` The token is in no journal of the panel or Gatekeeper  
✅ `13:53:55` …in no nginx log line but the one this spec's GET of the removed path made  
✅ `13:53:55` …and state.db does not hold it  
✅ `13:53:55` …anywhere in its bytes, its write-ahead log included  

## Nothing restarted Authelia

✅ `13:53:55` An invitation, its acceptance and a new user: Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `159` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `159` |

ℹ️ `13:53:55` Cleaning up test resources...  
