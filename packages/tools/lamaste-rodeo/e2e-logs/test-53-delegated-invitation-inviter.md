# Lamaste E2E: 53 — Delegated invitations: an inviter grants only what it may (Three-VM)

> Started at `2026-11-10 19:02:18 UTC`


## Pre-flight

✅ `19:02:18` Onboarding is complete  
✅ `19:02:19` Agent test-agent is enrolled on the host  
✅ `19:02:19` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `19:02:20` The agent VM's lamaste-agent has the apphost command  
✅ `19:02:20` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `19:02:20` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a coordinator, a viewer, an outsider (external members of B); a member of A alone

✅ `19:02:21` Domain lamaste-second.local added (201)  
✅ `19:02:22` …pending until activated  
✅ `19:02:22` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `19:02:22` …the one required record is auth.lamaste-second.local  
✅ `19:02:23` lamaste-second.local is active  
✅ `19:02:24` User e2e53-coord created, member of lamaste-second.local (external)  
✅ `19:02:25` User e2e53-viewer created, member of lamaste-second.local (external)  
✅ `19:02:25` User e2e53-outsider created, member of lamaste-second.local (external)  
✅ `19:02:26` User e2e53-mem-a created, member of test.lamaste.local  

## The plugin, with an inviting role, installed, approved, hosted, on B

✅ `19:02:27` Fixture built: @lamalibre/e2e-xinv-server (coordinator invites coordinator and viewer; web surface e2e53web)  
✅ `19:02:36` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent )  
✅ `19:02:36` The agent VM reaches it at http://10.13.37.1:4874  
✅ `19:02:37` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T19:02:37.749Z"})  
✅ `19:02:37` …through its own OIDC client  
✅ `19:02:42` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `19:02:46` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `19:02:47` …approved  
✅ `19:02:47` …moved to B, before any surface  
✅ `19:02:58` …hosted on test-agent ()  
✅ `19:03:11` …its hosting is up  
✅ `19:03:11` …ready: its agent half's first complete sync ended at the head  
✅ `19:03:12` The approved block names what the coordinator may give  

## The policy: off until the administrator enables it, and only with a restricted web surface

✅ `19:03:12` A plugin nobody set a policy for: off, the defaults  
✅ `19:03:12` …its inviting role listed  
✅ `19:03:12` Enabling with no e-mail domain: 400  
✅ `19:03:12` Enabling with no web surface: 409  
✅ `19:03:12` …invitations_unavailable  
✅ `19:03:14` POST /api/plugins/e2e-xinv/web-surface {accessMode: authenticated}  
✅ `19:03:14` …the site e2e53web.lamaste-second.local, authenticated, on B  
✅ `19:03:15` …served  
✅ `19:03:15` Enabling on an authenticated web surface: 409 (it refuses external members)  
✅ `19:03:15` …it says why  
✅ `19:03:17` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `19:03:17` …the site e2e53web.lamaste-second.local, restricted, on B  
✅ `19:03:17` …served  

## The people: roles and the site's grant, as the administrator gives them

✅ `19:03:18` e2e53-coord entitled as coordinator  
✅ `19:03:18` e2e53-viewer entitled as viewer  
✅ `19:03:18` Granted site 4e8bef62-3c5c-42e5-a678-30b618e45c57 to user e2e53-coord  
✅ `19:03:19` Granted site 4e8bef62-3c5c-42e5-a678-30b618e45c57 to user e2e53-viewer  
✅ `19:03:19` The audience holds e2e53-coord as coordinator  
✅ `19:03:19` …and e2e53-viewer as viewer  
✅ `19:03:19` users.yml gives e2e53-coord the site's hostname as a group  
✅ `19:03:21` e2e53-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `19:03:23` e2e53-viewer signed in at auth.lamaste-second.local (password, TOTP)  
✅ `19:03:25` e2e53-outsider signed in at auth.lamaste-second.local (password, TOTP)  
✅ `19:03:27` e2e53-mem-a signed in at auth.lamaste-second.local (password, TOTP)  

## Off: the coordinator is refused until the policy is enabled

✅ `19:03:28` GET with the policy off: 403  
✅ `19:03:28` …invitations_unavailable (never why)  
✅ `19:03:28` Enabled, for addresses under example.test  
✅ `19:03:28` …available  

## The inviter's page on auth.<B>: its own origin, by hash, unframed

✅ `19:03:28` GET auth.<B>/invitations/e2e-xinv: 200  
✅ `19:03:28` …the stock inviter's page  
✅ `19:03:28` …nothing from a foreign host  
✅ `19:03:28` …the CSP names the served script's hash  
✅ `19:03:28` …and the served style's  
✅ `19:03:28` …nothing frames it  
✅ `19:03:28` …nothing else loads  
✅ `19:03:28` X-Frame-Options: DENY  
✅ `19:03:28` Cross-Origin-Opener-Policy: same-origin  
✅ `19:03:28` Referrer-Policy: same-origin (no-referrer would make a fetch POST send Origin: null)  
✅ `19:03:28` Cache-Control: no-store  

## Who may ask

✅ `19:03:28` No session: 401  
✅ `19:03:28` …JSON, never a redirect (the page sends the browser to sign in)  
✅ `19:03:28` e2e53-mem-a, a member of A alone: 403 at auth.<B>  
✅ `19:03:29` e2e53-outsider, external on B with no role and no site: 403  

## What the coordinator may give, and what the viewer may not

✅ `19:03:29` e2e53-coord: GET 200  
✅ `19:03:29` …the roles they may give, editor not among them  
✅ `19:03:29` …the bounds; none open  
✅ `19:03:29` …the way back to the plugin's site  
✅ `19:03:29` …never cached  
✅ `19:03:29` editor, which the coordinator may not give: 403  
✅ `19:03:29` …role_not_grantable  
✅ `19:03:29` A role that does not exist: 403  
✅ `19:03:29` An address under another domain: 400  
✅ `19:03:29` …email_domain_not_allowed  
✅ `19:03:30` A body naming anything else (groups): 400, strict  
✅ `19:03:30` e2e53-viewer, whose role invites nobody: 403  
✅ `19:03:30` …role_not_grantable  

## From nowhere but the sign-in host's page

✅ `19:03:30` A POST the plugin's own pages would send (Origin of its site, same-site): 403  
✅ `19:03:30` …its Origin alone: 403  
✅ `19:03:30` …a same-site fetch alone: 403  
✅ `19:03:31` …no Origin at all: 403  
✅ `19:03:31` The same POST on the plugin's own host makes nothing  
✅ `19:03:31` …no link  
✅ `19:03:31` …and a GET there reads nothing  
✅ `19:03:31` No invitation was made by any of those  

## An invitation: a link the inviter sends themselves

✅ `19:03:31` e2e53-coord invites ayse@example.test as viewer: 201  
✅ `19:03:31` …a link on the sign-in host, the token in its fragment  
✅ `19:03:31` The panel lists it with its inviter  
✅ `19:03:32` e2e53-coord sees their own, pending  
✅ `19:03:32` …one open  
✅ `19:03:32` e2e53-viewer sees none of it  

## The link opens on B's sign-in host alone

✅ `19:03:32` POST auth.<B>/api/invite/lookup: 200  
✅ `19:03:32` …what it is for and who invited, by display name  
✅ `19:03:32` …never the inviter's username  
✅ `19:03:32` auth.<A>: 404, as no invitation at all  
✅ `19:03:32` :9292, Host and X-Forwarded-Host naming auth.<B>: 404  
✅ `19:03:32` The panel vhost, X-Forwarded-Host naming auth.<B>: 404  
✅ `19:03:33` auth.<A>, X-Forwarded-Host naming auth.<B>: 404  
✅ `19:03:33` The token in a URL opens nothing: the path routes are gone  
✅ `19:03:33` …it says nothing of the invitation  
✅ `19:03:33` A token that was never made: 404  
✅ `19:03:33` The invitation page at /invite: 200 (the fragment never reaches the server)  
✅ `19:03:33` …its CSP names the served script's hash  
✅ `19:03:33` …no foreign script: the QR is the panel's  

## A username anything names is refused, with one answer

✅ `19:03:34` User e2e53-gone created, member of lamaste-second.local (external)  
✅ `19:03:35` Granted tunnel e2e53-a-restricted-tunnel to user e2e53-future  
✅ `19:03:35` e2e53-future, which a Gatekeeper grant names for a user still to come: 409  
✅ `19:03:35` …username_unavailable  
✅ `19:03:35` e2e53-gone, a removed user's: 409  
✅ `19:03:35` …the same answer, whatever named it  
✅ `19:03:35` e2e53-coord, a living user's: 409  
✅ `19:03:35` …the same answer  
✅ `19:03:36` The invitation stays pending; no name is held  

## Accepted: a new external member of B, with the one role and the site

✅ `19:03:36` POST auth.<B>/api/invite/accept: 200  
✅ `19:03:36` …e2e53-invitee, access complete, sent to the plugin's site  
✅ `19:03:36` …the QR, drawn by the panel  
✅ `19:03:36` …with its TOTP secret  
✅ `19:03:37` The directory holds them by id  
✅ `19:03:37` The invitation is accepted, complete; its copy of the address gone  
✅ `19:03:37` e2e53-invitee is an external member of B, of nothing else  
✅ `19:03:37` …no Authelia group  
✅ `19:03:37` users.yml gives them the site's hostname, as a grant does  
✅ `19:03:38` …and holds nothing else in users.yml  
✅ `19:03:38` Gatekeeper holds exactly the role and the site's grant  
✅ `19:03:38` …with the role asked for  
✅ `19:03:38` The audience holds them as viewer  
✅ `19:03:38` …and the agent half's projection: the plugin learned of them through the feed  
✅ `19:03:38` …with the role and the declared attributes  

## They reach the plugin

✅ `19:03:39` e2e53-invitee signed in at auth.lamaste-second.local (password, TOTP)  
✅ `19:03:40` e2e53-invitee: the shell, signed in with the factor the invitation gave  
✅ `19:03:40` …GET /api/e2e-xinv/app/echo 200  
✅ `19:03:40` …the agent half sees the directory's user and their role  

## One use

✅ `19:03:40` The link again: lookup 410  
✅ `19:03:40` …accept 410  

## The cap

✅ `19:03:40` The administrator lowers the cap to one open invitation  
✅ `19:03:40` One more for e2e53-coord: 201  
✅ `19:03:40` …a link on the sign-in host, the token in its fragment  
✅ `19:03:40` The next: 409  
✅ `19:03:40` …invitation_cap, the inviter's  
✅ `19:03:41` People by invitation capped at 2 (one joined, one open)  
✅ `19:03:41` The next: 409  
✅ `19:03:41` …invitation_cap, the plugin's  
✅ `19:03:41` e2e53-coord revokes their own pending one  

## Oversight: audited with no address, the administrators notified

✅ `19:03:41` invitation.created by the inviter's id, the address's domain alone  
✅ `19:03:41` invitation.accepted by id, with its inviter  
✅ `19:03:41` No audit entry holds an address  
✅ `19:03:41` The administrators were told someone joined, once  

## No token at rest or in a log

✅ `19:03:42` The token is in no journal of the panel or Gatekeeper  
✅ `19:03:42` …in no nginx log line but the one this spec's GET of the removed path made  
✅ `19:03:42` …and state.db does not hold it  
✅ `19:03:42` …anywhere in its bytes, its write-ahead log included  

## Nothing restarted Authelia

✅ `19:03:42` An invitation, its acceptance and a new user: Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `159` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `159` |

ℹ️ `19:03:42` Cleaning up test resources...  
