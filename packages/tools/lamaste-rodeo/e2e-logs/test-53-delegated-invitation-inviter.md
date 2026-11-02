# Lamaste E2E: 53 — Delegated invitations: an inviter grants only what it may (Three-VM)

> Started at `2026-11-02 16:57:41 UTC`


## Pre-flight

✅ `16:57:41` Onboarding is complete  
✅ `16:57:41` Agent test-agent is enrolled on the host  
✅ `16:57:41` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `16:57:42` The agent VM's lamaste-agent has the apphost command  
✅ `16:57:42` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `16:57:42` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a coordinator, a viewer, an outsider (external members of B); a member of A alone

✅ `16:57:43` Domain lamaste-second.local added (201)  
✅ `16:57:43` …pending until activated  
✅ `16:57:43` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `16:57:43` …the one required record is auth.lamaste-second.local  
✅ `16:57:44` lamaste-second.local is active  
✅ `16:57:45` User e2e53-coord created, member of lamaste-second.local (external)  
✅ `16:57:46` User e2e53-viewer created, member of lamaste-second.local (external)  
✅ `16:57:46` User e2e53-outsider created, member of lamaste-second.local (external)  
✅ `16:57:47` User e2e53-mem-a created, member of test.lamaste.local  

## The plugin, with an inviting role, installed, approved, hosted, on B

✅ `16:57:47` Fixture built: @lamalibre/e2e-xinv-server (coordinator invites coordinator and viewer; web surface e2e53web)  
✅ `16:57:50` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent )  
✅ `16:57:50` The agent VM reaches it at http://10.13.37.1:4874  
✅ `16:57:51` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-02T16:57:51.864Z"})  
✅ `16:57:51` …through its own OIDC client  
✅ `16:57:55` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `16:57:58` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `16:57:58` …approved  
✅ `16:57:58` …moved to B, before any surface  
✅ `16:58:09` …hosted on test-agent ()  
✅ `16:58:28` …its hosting is up  
✅ `16:58:29` …ready: its agent half's first complete sync ended at the head  
✅ `16:58:29` The approved block names what the coordinator may give  

## The policy: off until the administrator enables it, and only with a restricted web surface

✅ `16:58:29` A plugin nobody set a policy for: off, the defaults  
✅ `16:58:29` …its inviting role listed  
✅ `16:58:29` Enabling with no e-mail domain: 400  
✅ `16:58:29` Enabling with no web surface: 409  
✅ `16:58:29` …invitations_unavailable  
✅ `16:58:31` POST /api/plugins/e2e-xinv/web-surface {accessMode: authenticated}  
✅ `16:58:31` …the site e2e53web.lamaste-second.local, authenticated, on B  
✅ `16:58:31` …served  
✅ `16:58:31` Enabling on an authenticated web surface: 409 (it refuses external members)  
✅ `16:58:31` …it says why  
✅ `16:58:33` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `16:58:33` …the site e2e53web.lamaste-second.local, restricted, on B  
✅ `16:58:33` …served  

## The people: roles and the site's grant, as the administrator gives them

✅ `16:58:34` e2e53-coord entitled as coordinator  
✅ `16:58:34` e2e53-viewer entitled as viewer  
✅ `16:58:34` Granted site e5159276-cd98-4825-ae75-ed9d4fa3ad11 to user e2e53-coord  
✅ `16:58:34` Granted site e5159276-cd98-4825-ae75-ed9d4fa3ad11 to user e2e53-viewer  
✅ `16:58:34` The audience holds e2e53-coord as coordinator  
✅ `16:58:34` …and e2e53-viewer as viewer  
✅ `16:58:34` users.yml gives e2e53-coord the site's hostname as a group  
✅ `16:58:36` e2e53-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:58:38` e2e53-viewer signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:58:40` e2e53-outsider signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:58:41` e2e53-mem-a signed in at auth.lamaste-second.local (password, TOTP)  

## Off: the coordinator is refused until the policy is enabled

✅ `16:58:41` GET with the policy off: 403  
✅ `16:58:41` …invitations_unavailable (never why)  
✅ `16:58:42` Enabled, for addresses under example.test  
✅ `16:58:42` …available  

## The inviter's page on auth.<B>: its own origin, by hash, unframed

✅ `16:58:42` GET auth.<B>/invitations/e2e-xinv: 200  
✅ `16:58:42` …the stock inviter's page  
✅ `16:58:42` …nothing from a foreign host  
✅ `16:58:42` …the CSP names the served script's hash  
✅ `16:58:42` …and the served style's  
✅ `16:58:42` …nothing frames it  
✅ `16:58:42` …nothing else loads  
✅ `16:58:42` X-Frame-Options: DENY  
✅ `16:58:42` Cross-Origin-Opener-Policy: same-origin  
✅ `16:58:42` Referrer-Policy: same-origin (no-referrer would make a fetch POST send Origin: null)  
✅ `16:58:42` Cache-Control: no-store  

## Who may ask

✅ `16:58:42` No session: 401  
✅ `16:58:42` …JSON, never a redirect (the page sends the browser to sign in)  
✅ `16:58:42` e2e53-mem-a, a member of A alone: 403 at auth.<B>  
✅ `16:58:42` e2e53-outsider, external on B with no role and no site: 403  

## What the coordinator may give, and what the viewer may not

✅ `16:58:42` e2e53-coord: GET 200  
✅ `16:58:42` …the roles they may give, editor not among them  
✅ `16:58:42` …the bounds; none open  
✅ `16:58:42` …the way back to the plugin's site  
✅ `16:58:42` …never cached  
✅ `16:58:42` editor, which the coordinator may not give: 403  
✅ `16:58:42` …role_not_grantable  
✅ `16:58:43` A role that does not exist: 403  
✅ `16:58:43` An address under another domain: 400  
✅ `16:58:43` …email_domain_not_allowed  
✅ `16:58:43` A body naming anything else (groups): 400, strict  
✅ `16:58:43` e2e53-viewer, whose role invites nobody: 403  
✅ `16:58:43` …role_not_grantable  

## From nowhere but the sign-in host's page

✅ `16:58:43` A POST the plugin's own pages would send (Origin of its site, same-site): 403  
✅ `16:58:43` …its Origin alone: 403  
✅ `16:58:43` …a same-site fetch alone: 403  
✅ `16:58:43` …no Origin at all: 403  
✅ `16:58:43` The same POST on the plugin's own host makes nothing  
✅ `16:58:43` …no link  
✅ `16:58:44` …and a GET there reads nothing  
✅ `16:58:44` No invitation was made by any of those  

## An invitation: a link the inviter sends themselves

✅ `16:58:44` e2e53-coord invites ayse@example.test as viewer: 201  
✅ `16:58:44` …a link on the sign-in host, the token in its fragment  
✅ `16:58:44` The panel lists it with its inviter  
✅ `16:58:44` e2e53-coord sees their own, pending  
✅ `16:58:44` …one open  
✅ `16:58:44` e2e53-viewer sees none of it  

## The link opens on B's sign-in host alone

✅ `16:58:44` POST auth.<B>/api/invite/lookup: 200  
✅ `16:58:44` …what it is for and who invited, by display name  
✅ `16:58:44` …never the inviter's username  
✅ `16:58:44` auth.<A>: 404, as no invitation at all  
✅ `16:58:45` :9292, Host and X-Forwarded-Host naming auth.<B>: 404  
✅ `16:58:45` The panel vhost, X-Forwarded-Host naming auth.<B>: 404  
✅ `16:58:45` auth.<A>, X-Forwarded-Host naming auth.<B>: 404  
✅ `16:58:45` The token in a URL opens nothing: the path routes are gone  
✅ `16:58:45` …it says nothing of the invitation  
✅ `16:58:45` A token that was never made: 404  
✅ `16:58:45` The invitation page at /invite: 200 (the fragment never reaches the server)  
✅ `16:58:45` …its CSP names the served script's hash  
✅ `16:58:45` …no foreign script: the QR is the panel's  

## A username anything names is refused, with one answer

✅ `16:58:46` User e2e53-gone created, member of lamaste-second.local (external)  
✅ `16:58:46` Granted tunnel e2e53-a-restricted-tunnel to user e2e53-future  
✅ `16:58:47` e2e53-future, which a Gatekeeper grant names for a user still to come: 409  
✅ `16:58:47` …username_unavailable  
✅ `16:58:47` e2e53-gone, a removed user's: 409  
✅ `16:58:47` …the same answer, whatever named it  
✅ `16:58:47` e2e53-coord, a living user's: 409  
✅ `16:58:47` …the same answer  
✅ `16:58:47` The invitation stays pending; no name is held  

## Accepted: a new external member of B, with the one role and the site

✅ `16:58:48` POST auth.<B>/api/invite/accept: 200  
✅ `16:58:48` …e2e53-invitee, access complete, sent to the plugin's site  
✅ `16:58:48` …the QR, drawn by the panel  
✅ `16:58:48` …with its TOTP secret  
✅ `16:58:48` The directory holds them by id  
✅ `16:58:48` The invitation is accepted, complete; its copy of the address gone  
✅ `16:58:48` e2e53-invitee is an external member of B, of nothing else  
✅ `16:58:48` …no Authelia group  
✅ `16:58:48` users.yml gives them the site's hostname, as a grant does  
✅ `16:58:49` …and holds nothing else in users.yml  
✅ `16:58:49` Gatekeeper holds exactly the role and the site's grant  
✅ `16:58:49` …with the role asked for  
✅ `16:58:49` The audience holds them as viewer  
✅ `16:58:49` …and the agent half's projection: the plugin learned of them through the feed  
✅ `16:58:49` …with the role and the declared attributes  

## They reach the plugin

✅ `16:58:50` e2e53-invitee signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:58:50` e2e53-invitee: the shell, signed in with the factor the invitation gave  
✅ `16:58:50` …GET /api/e2e-xinv/app/echo 200  
✅ `16:58:50` …the agent half sees the directory's user and their role  

## One use

✅ `16:58:51` The link again: lookup 410  
✅ `16:58:51` …accept 410  

## The cap

✅ `16:58:51` The administrator lowers the cap to one open invitation  
✅ `16:58:51` One more for e2e53-coord: 201  
✅ `16:58:51` …a link on the sign-in host, the token in its fragment  
✅ `16:58:51` The next: 409  
✅ `16:58:51` …invitation_cap, the inviter's  
✅ `16:58:51` People by invitation capped at 2 (one joined, one open)  
✅ `16:58:51` The next: 409  
✅ `16:58:51` …invitation_cap, the plugin's  
✅ `16:58:51` e2e53-coord revokes their own pending one  

## Oversight: audited with no address, the administrators notified

✅ `16:58:52` invitation.created by the inviter's id, the address's domain alone  
✅ `16:58:52` invitation.accepted by id, with its inviter  
✅ `16:58:52` No audit entry holds an address  
✅ `16:58:52` The administrators were told someone joined, once  

## No token at rest or in a log

✅ `16:58:52` The token is in no journal of the panel or Gatekeeper  
✅ `16:58:52` …in no nginx log line but the one this spec's GET of the removed path made  
✅ `16:58:52` …and state.db does not hold it  
✅ `16:58:52` …anywhere in its bytes, its write-ahead log included  

## Nothing restarted Authelia

✅ `16:58:52` An invitation, its acceptance and a new user: Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `159` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `159` |

ℹ️ `16:58:52` Cleaning up test resources...  
