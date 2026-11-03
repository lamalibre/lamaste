# Lamaste E2E: 53 — Delegated invitations: an inviter grants only what it may (Three-VM)

> Started at `2026-11-03 12:25:40 UTC`


## Pre-flight

✅ `12:25:40` Onboarding is complete  
✅ `12:25:41` Agent test-agent is enrolled on the host  
✅ `12:25:41` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `12:25:41` The agent VM's lamaste-agent has the apphost command  
✅ `12:25:41` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `12:25:41` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a coordinator, a viewer, an outsider (external members of B); a member of A alone

✅ `12:25:42` Domain lamaste-second.local added (201)  
✅ `12:25:42` …pending until activated  
✅ `12:25:42` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `12:25:42` …the one required record is auth.lamaste-second.local  
✅ `12:25:44` lamaste-second.local is active  
✅ `12:25:44` User e2e53-coord created, member of lamaste-second.local (external)  
✅ `12:25:45` User e2e53-viewer created, member of lamaste-second.local (external)  
✅ `12:25:46` User e2e53-outsider created, member of lamaste-second.local (external)  
✅ `12:25:46` User e2e53-mem-a created, member of test.lamaste.local  

## The plugin, with an inviting role, installed, approved, hosted, on B

✅ `12:25:46` Fixture built: @lamalibre/e2e-xinv-server (coordinator invites coordinator and viewer; web surface e2e53web)  
✅ `12:25:57` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent )  
✅ `12:25:58` The agent VM reaches it at http://10.13.37.1:4874  
✅ `12:25:59` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T12:25:59.228Z"})  
✅ `12:25:59` …through its own OIDC client  
✅ `12:26:03` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `12:26:17` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `12:26:17` …approved  
✅ `12:26:17` …moved to B, before any surface  
✅ `12:26:28` …hosted on test-agent ()  
✅ `12:26:44` …its hosting is up  
✅ `12:26:44` …ready: its agent half's first complete sync ended at the head  
✅ `12:26:45` The approved block names what the coordinator may give  

## The policy: off until the administrator enables it, and only with a restricted web surface

✅ `12:26:45` A plugin nobody set a policy for: off, the defaults  
✅ `12:26:45` …its inviting role listed  
✅ `12:26:45` Enabling with no e-mail domain: 400  
✅ `12:26:45` Enabling with no web surface: 409  
✅ `12:26:45` …invitations_unavailable  
✅ `12:26:46` POST /api/plugins/e2e-xinv/web-surface {accessMode: authenticated}  
✅ `12:26:46` …the site e2e53web.lamaste-second.local, authenticated, on B  
✅ `12:26:46` …served  
✅ `12:26:46` Enabling on an authenticated web surface: 409 (it refuses external members)  
✅ `12:26:46` …it says why  
✅ `12:26:46` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `12:26:46` …the site e2e53web.lamaste-second.local, restricted, on B  
✅ `12:26:47` …served  

## The people: roles and the site's grant, as the administrator gives them

✅ `12:26:47` e2e53-coord entitled as coordinator  
✅ `12:26:47` e2e53-viewer entitled as viewer  
✅ `12:26:47` Granted site 9e0f0b49-f74e-4e59-b10c-6745864d85f3 to user e2e53-coord  
✅ `12:26:47` Granted site 9e0f0b49-f74e-4e59-b10c-6745864d85f3 to user e2e53-viewer  
✅ `12:26:47` The audience holds e2e53-coord as coordinator  
✅ `12:26:48` …and e2e53-viewer as viewer  
✅ `12:26:48` users.yml gives e2e53-coord the site's hostname as a group  
✅ `12:26:50` e2e53-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `12:26:51` e2e53-viewer signed in at auth.lamaste-second.local (password, TOTP)  
✅ `12:26:53` e2e53-outsider signed in at auth.lamaste-second.local (password, TOTP)  
✅ `12:26:55` e2e53-mem-a signed in at auth.lamaste-second.local (password, TOTP)  

## Off: the coordinator is refused until the policy is enabled

✅ `12:26:55` GET with the policy off: 403  
✅ `12:26:55` …invitations_unavailable (never why)  
✅ `12:26:55` Enabled, for addresses under example.test  
✅ `12:26:55` …available  

## The inviter's page on auth.<B>: its own origin, by hash, unframed

✅ `12:26:55` GET auth.<B>/invitations/e2e-xinv: 200  
✅ `12:26:55` …the stock inviter's page  
✅ `12:26:55` …nothing from a foreign host  
✅ `12:26:55` …the CSP names the served script's hash  
✅ `12:26:56` …and the served style's  
✅ `12:26:56` …nothing frames it  
✅ `12:26:56` …nothing else loads  
✅ `12:26:56` X-Frame-Options: DENY  
✅ `12:26:56` Cross-Origin-Opener-Policy: same-origin  
✅ `12:26:56` Referrer-Policy: same-origin (no-referrer would make a fetch POST send Origin: null)  
✅ `12:26:56` Cache-Control: no-store  

## Who may ask

✅ `12:26:56` No session: 401  
✅ `12:26:56` …JSON, never a redirect (the page sends the browser to sign in)  
✅ `12:26:56` e2e53-mem-a, a member of A alone: 403 at auth.<B>  
✅ `12:26:56` e2e53-outsider, external on B with no role and no site: 403  

## What the coordinator may give, and what the viewer may not

✅ `12:26:56` e2e53-coord: GET 200  
✅ `12:26:56` …the roles they may give, editor not among them  
✅ `12:26:56` …the bounds; none open  
✅ `12:26:56` …the way back to the plugin's site  
✅ `12:26:56` …never cached  
✅ `12:26:56` editor, which the coordinator may not give: 403  
✅ `12:26:56` …role_not_grantable  
✅ `12:26:56` A role that does not exist: 403  
✅ `12:26:56` An address under another domain: 400  
✅ `12:26:56` …email_domain_not_allowed  
✅ `12:26:57` A body naming anything else (groups): 400, strict  
✅ `12:26:57` e2e53-viewer, whose role invites nobody: 403  
✅ `12:26:57` …role_not_grantable  

## From nowhere but the sign-in host's page

✅ `12:26:57` A POST the plugin's own pages would send (Origin of its site, same-site): 403  
✅ `12:26:57` …its Origin alone: 403  
✅ `12:26:57` …a same-site fetch alone: 403  
✅ `12:26:57` …no Origin at all: 403  
✅ `12:26:57` The same POST on the plugin's own host makes nothing  
✅ `12:26:57` …no link  
✅ `12:26:57` …and a GET there reads nothing  
✅ `12:26:57` No invitation was made by any of those  

## An invitation: a link the inviter sends themselves

✅ `12:26:58` e2e53-coord invites ayse@example.test as viewer: 201  
✅ `12:26:58` …a link on the sign-in host, the token in its fragment  
✅ `12:26:58` The panel lists it with its inviter  
✅ `12:26:58` e2e53-coord sees their own, pending  
✅ `12:26:58` …one open  
✅ `12:26:58` e2e53-viewer sees none of it  

## The link opens on B's sign-in host alone

✅ `12:26:58` POST auth.<B>/api/invite/lookup: 200  
✅ `12:26:58` …what it is for and who invited, by display name  
✅ `12:26:58` …never the inviter's username  
✅ `12:26:58` auth.<A>: 404, as no invitation at all  
✅ `12:26:58` :9292, Host and X-Forwarded-Host naming auth.<B>: 404  
✅ `12:26:58` The panel vhost, X-Forwarded-Host naming auth.<B>: 404  
✅ `12:26:59` auth.<A>, X-Forwarded-Host naming auth.<B>: 404  
✅ `12:26:59` The token in a URL opens nothing: the path routes are gone  
✅ `12:26:59` …it says nothing of the invitation  
✅ `12:26:59` A token that was never made: 404  
✅ `12:26:59` The invitation page at /invite: 200 (the fragment never reaches the server)  
✅ `12:26:59` …its CSP names the served script's hash  
✅ `12:26:59` …no foreign script: the QR is the panel's  

## A username anything names is refused, with one answer

✅ `12:27:00` User e2e53-gone created, member of lamaste-second.local (external)  
✅ `12:27:00` Granted tunnel e2e53-a-restricted-tunnel to user e2e53-future  
✅ `12:27:00` e2e53-future, which a Gatekeeper grant names for a user still to come: 409  
✅ `12:27:00` …username_unavailable  
✅ `12:27:00` e2e53-gone, a removed user's: 409  
✅ `12:27:00` …the same answer, whatever named it  
✅ `12:27:01` e2e53-coord, a living user's: 409  
✅ `12:27:01` …the same answer  
✅ `12:27:01` The invitation stays pending; no name is held  

## Accepted: a new external member of B, with the one role and the site

✅ `12:27:01` POST auth.<B>/api/invite/accept: 200  
✅ `12:27:01` …e2e53-invitee, access complete, sent to the plugin's site  
✅ `12:27:01` …the QR, drawn by the panel  
✅ `12:27:01` …with its TOTP secret  
✅ `12:27:01` The directory holds them by id  
✅ `12:27:02` The invitation is accepted, complete; its copy of the address gone  
✅ `12:27:02` e2e53-invitee is an external member of B, of nothing else  
✅ `12:27:02` …no Authelia group  
✅ `12:27:02` users.yml gives them the site's hostname, as a grant does  
✅ `12:27:02` …and holds nothing else in users.yml  
✅ `12:27:02` Gatekeeper holds exactly the role and the site's grant  
✅ `12:27:02` …with the role asked for  
✅ `12:27:02` The audience holds them as viewer  
✅ `12:27:02` …and the agent half's projection: the plugin learned of them through the feed  
✅ `12:27:03` …with the role and the declared attributes  

## They reach the plugin

✅ `12:27:04` e2e53-invitee signed in at auth.lamaste-second.local (password, TOTP)  
✅ `12:27:04` e2e53-invitee: the shell, signed in with the factor the invitation gave  
✅ `12:27:04` …GET /api/e2e-xinv/app/echo 200  
✅ `12:27:04` …the agent half sees the directory's user and their role  

## One use

✅ `12:27:04` The link again: lookup 410  
✅ `12:27:04` …accept 410  

## The cap

✅ `12:27:04` The administrator lowers the cap to one open invitation  
✅ `12:27:05` One more for e2e53-coord: 201  
✅ `12:27:05` …a link on the sign-in host, the token in its fragment  
✅ `12:27:05` The next: 409  
✅ `12:27:05` …invitation_cap, the inviter's  
✅ `12:27:05` People by invitation capped at 2 (one joined, one open)  
✅ `12:27:05` The next: 409  
✅ `12:27:05` …invitation_cap, the plugin's  
✅ `12:27:05` e2e53-coord revokes their own pending one  

## Oversight: audited with no address, the administrators notified

✅ `12:27:05` invitation.created by the inviter's id, the address's domain alone  
✅ `12:27:05` invitation.accepted by id, with its inviter  
✅ `12:27:05` No audit entry holds an address  
✅ `12:27:06` The administrators were told someone joined, once  

## No token at rest or in a log

✅ `12:27:06` The token is in no journal of the panel or Gatekeeper  
✅ `12:27:06` …in no nginx log line but the one this spec's GET of the removed path made  
✅ `12:27:06` …and state.db does not hold it  
✅ `12:27:06` …anywhere in its bytes, its write-ahead log included  

## Nothing restarted Authelia

✅ `12:27:06` An invitation, its acceptance and a new user: Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `159` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `159` |

ℹ️ `12:27:06` Cleaning up test resources...  
