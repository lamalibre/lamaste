# Lamaste E2E: 53 — Delegated invitations: an inviter grants only what it may (Three-VM)

> Started at `2026-11-03 10:41:40 UTC`


## Pre-flight

✅ `10:41:40` Onboarding is complete  
✅ `10:41:41` Agent test-agent is enrolled on the host  
✅ `10:41:41` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:41:41` The agent VM's lamaste-agent has the apphost command  
✅ `10:41:41` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `10:41:42` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a coordinator, a viewer, an outsider (external members of B); a member of A alone

✅ `10:41:43` Domain lamaste-second.local added (201)  
✅ `10:41:43` …pending until activated  
✅ `10:41:43` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `10:41:43` …the one required record is auth.lamaste-second.local  
✅ `10:41:44` lamaste-second.local is active  
✅ `10:41:45` User e2e53-coord created, member of lamaste-second.local (external)  
✅ `10:41:45` User e2e53-viewer created, member of lamaste-second.local (external)  
✅ `10:41:46` User e2e53-outsider created, member of lamaste-second.local (external)  
✅ `10:41:47` User e2e53-mem-a created, member of test.lamaste.local  

## The plugin, with an inviting role, installed, approved, hosted, on B

✅ `10:41:47` Fixture built: @lamalibre/e2e-xinv-server (coordinator invites coordinator and viewer; web surface e2e53web)  
✅ `10:41:56` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent )  
✅ `10:41:56` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:41:57` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T10:41:57.519Z"})  
✅ `10:41:57` …through its own OIDC client  
✅ `10:42:01` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:42:06` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `10:42:06` …approved  
✅ `10:42:06` …moved to B, before any surface  
✅ `10:42:17` …hosted on test-agent ()  
✅ `10:42:33` …its hosting is up  
✅ `10:42:34` …ready: its agent half's first complete sync ended at the head  
✅ `10:42:34` The approved block names what the coordinator may give  

## The policy: off until the administrator enables it, and only with a restricted web surface

✅ `10:42:34` A plugin nobody set a policy for: off, the defaults  
✅ `10:42:34` …its inviting role listed  
✅ `10:42:34` Enabling with no e-mail domain: 400  
✅ `10:42:34` Enabling with no web surface: 409  
✅ `10:42:34` …invitations_unavailable  
✅ `10:42:36` POST /api/plugins/e2e-xinv/web-surface {accessMode: authenticated}  
✅ `10:42:36` …the site e2e53web.lamaste-second.local, authenticated, on B  
✅ `10:42:36` …served  
✅ `10:42:36` Enabling on an authenticated web surface: 409 (it refuses external members)  
✅ `10:42:36` …it says why  
✅ `10:42:38` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `10:42:38` …the site e2e53web.lamaste-second.local, restricted, on B  
✅ `10:42:38` …served  

## The people: roles and the site's grant, as the administrator gives them

✅ `10:42:39` e2e53-coord entitled as coordinator  
✅ `10:42:39` e2e53-viewer entitled as viewer  
✅ `10:42:39` Granted site b28e3bd5-4b6d-4176-b566-59b94a655bce to user e2e53-coord  
✅ `10:42:39` Granted site b28e3bd5-4b6d-4176-b566-59b94a655bce to user e2e53-viewer  
✅ `10:42:39` The audience holds e2e53-coord as coordinator  
✅ `10:42:39` …and e2e53-viewer as viewer  
✅ `10:42:40` users.yml gives e2e53-coord the site's hostname as a group  
✅ `10:42:42` e2e53-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:42:43` e2e53-viewer signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:42:45` e2e53-outsider signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:42:47` e2e53-mem-a signed in at auth.lamaste-second.local (password, TOTP)  

## Off: the coordinator is refused until the policy is enabled

✅ `10:42:47` GET with the policy off: 403  
✅ `10:42:47` …invitations_unavailable (never why)  
✅ `10:42:47` Enabled, for addresses under example.test  
✅ `10:42:47` …available  

## The inviter's page on auth.<B>: its own origin, by hash, unframed

✅ `10:42:47` GET auth.<B>/invitations/e2e-xinv: 200  
✅ `10:42:47` …the stock inviter's page  
✅ `10:42:47` …nothing from a foreign host  
✅ `10:42:47` …the CSP names the served script's hash  
✅ `10:42:47` …and the served style's  
✅ `10:42:47` …nothing frames it  
✅ `10:42:47` …nothing else loads  
✅ `10:42:47` X-Frame-Options: DENY  
✅ `10:42:47` Cross-Origin-Opener-Policy: same-origin  
✅ `10:42:47` Referrer-Policy: same-origin (no-referrer would make a fetch POST send Origin: null)  
✅ `10:42:47` Cache-Control: no-store  

## Who may ask

✅ `10:42:48` No session: 401  
✅ `10:42:48` …JSON, never a redirect (the page sends the browser to sign in)  
✅ `10:42:48` e2e53-mem-a, a member of A alone: 403 at auth.<B>  
✅ `10:42:48` e2e53-outsider, external on B with no role and no site: 403  

## What the coordinator may give, and what the viewer may not

✅ `10:42:48` e2e53-coord: GET 200  
✅ `10:42:48` …the roles they may give, editor not among them  
✅ `10:42:48` …the bounds; none open  
✅ `10:42:48` …the way back to the plugin's site  
✅ `10:42:48` …never cached  
✅ `10:42:48` editor, which the coordinator may not give: 403  
✅ `10:42:48` …role_not_grantable  
✅ `10:42:48` A role that does not exist: 403  
✅ `10:42:48` An address under another domain: 400  
✅ `10:42:48` …email_domain_not_allowed  
✅ `10:42:48` A body naming anything else (groups): 400, strict  
✅ `10:42:49` e2e53-viewer, whose role invites nobody: 403  
✅ `10:42:49` …role_not_grantable  

## From nowhere but the sign-in host's page

✅ `10:42:49` A POST the plugin's own pages would send (Origin of its site, same-site): 403  
✅ `10:42:49` …its Origin alone: 403  
✅ `10:42:49` …a same-site fetch alone: 403  
✅ `10:42:49` …no Origin at all: 403  
✅ `10:42:49` The same POST on the plugin's own host makes nothing  
✅ `10:42:49` …no link  
✅ `10:42:49` …and a GET there reads nothing  
✅ `10:42:49` No invitation was made by any of those  

## An invitation: a link the inviter sends themselves

✅ `10:42:49` e2e53-coord invites ayse@example.test as viewer: 201  
✅ `10:42:49` …a link on the sign-in host, the token in its fragment  
✅ `10:42:50` The panel lists it with its inviter  
✅ `10:42:50` e2e53-coord sees their own, pending  
✅ `10:42:50` …one open  
✅ `10:42:50` e2e53-viewer sees none of it  

## The link opens on B's sign-in host alone

✅ `10:42:50` POST auth.<B>/api/invite/lookup: 200  
✅ `10:42:50` …what it is for and who invited, by display name  
✅ `10:42:50` …never the inviter's username  
✅ `10:42:50` auth.<A>: 404, as no invitation at all  
✅ `10:42:50` :9292, Host and X-Forwarded-Host naming auth.<B>: 404  
✅ `10:42:50` The panel vhost, X-Forwarded-Host naming auth.<B>: 404  
✅ `10:42:50` auth.<A>, X-Forwarded-Host naming auth.<B>: 404  
✅ `10:42:50` The token in a URL opens nothing: the path routes are gone  
✅ `10:42:50` …it says nothing of the invitation  
✅ `10:42:51` A token that was never made: 404  
✅ `10:42:51` The invitation page at /invite: 200 (the fragment never reaches the server)  
✅ `10:42:51` …its CSP names the served script's hash  
✅ `10:42:51` …no foreign script: the QR is the panel's  

## A username anything names is refused, with one answer

✅ `10:42:51` User e2e53-gone created, member of lamaste-second.local (external)  
✅ `10:42:52` Granted tunnel e2e53-a-restricted-tunnel to user e2e53-future  
✅ `10:42:52` e2e53-future, which a Gatekeeper grant names for a user still to come: 409  
✅ `10:42:52` …username_unavailable  
✅ `10:42:52` e2e53-gone, a removed user's: 409  
✅ `10:42:52` …the same answer, whatever named it  
✅ `10:42:52` e2e53-coord, a living user's: 409  
✅ `10:42:52` …the same answer  
✅ `10:42:52` The invitation stays pending; no name is held  

## Accepted: a new external member of B, with the one role and the site

✅ `10:42:53` POST auth.<B>/api/invite/accept: 200  
✅ `10:42:53` …e2e53-invitee, access complete, sent to the plugin's site  
✅ `10:42:53` …the QR, drawn by the panel  
✅ `10:42:53` …with its TOTP secret  
✅ `10:42:53` The directory holds them by id  
✅ `10:42:53` The invitation is accepted, complete; its copy of the address gone  
✅ `10:42:54` e2e53-invitee is an external member of B, of nothing else  
✅ `10:42:54` …no Authelia group  
✅ `10:42:54` users.yml gives them the site's hostname, as a grant does  
✅ `10:42:54` …and holds nothing else in users.yml  
✅ `10:42:54` Gatekeeper holds exactly the role and the site's grant  
✅ `10:42:54` …with the role asked for  
✅ `10:42:54` The audience holds them as viewer  
✅ `10:42:54` …and the agent half's projection: the plugin learned of them through the feed  
✅ `10:42:54` …with the role and the declared attributes  

## They reach the plugin

✅ `10:42:56` e2e53-invitee signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:42:56` e2e53-invitee: the shell, signed in with the factor the invitation gave  
✅ `10:42:56` …GET /api/e2e-xinv/app/echo 200  
✅ `10:42:56` …the agent half sees the directory's user and their role  

## One use

✅ `10:42:56` The link again: lookup 410  
✅ `10:42:56` …accept 410  

## The cap

✅ `10:42:56` The administrator lowers the cap to one open invitation  
✅ `10:42:57` One more for e2e53-coord: 201  
✅ `10:42:57` …a link on the sign-in host, the token in its fragment  
✅ `10:42:57` The next: 409  
✅ `10:42:57` …invitation_cap, the inviter's  
✅ `10:42:57` People by invitation capped at 2 (one joined, one open)  
✅ `10:42:57` The next: 409  
✅ `10:42:57` …invitation_cap, the plugin's  
✅ `10:42:57` e2e53-coord revokes their own pending one  

## Oversight: audited with no address, the administrators notified

✅ `10:42:57` invitation.created by the inviter's id, the address's domain alone  
✅ `10:42:57` invitation.accepted by id, with its inviter  
✅ `10:42:58` No audit entry holds an address  
✅ `10:42:58` The administrators were told someone joined, once  

## No token at rest or in a log

✅ `10:42:58` The token is in no journal of the panel or Gatekeeper  
✅ `10:42:58` …in no nginx log line but the one this spec's GET of the removed path made  
✅ `10:42:58` …and state.db does not hold it  
✅ `10:42:58` …anywhere in its bytes, its write-ahead log included  

## Nothing restarted Authelia

✅ `10:42:58` An invitation, its acceptance and a new user: Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `159` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `159` |

ℹ️ `10:42:58` Cleaning up test resources...  
