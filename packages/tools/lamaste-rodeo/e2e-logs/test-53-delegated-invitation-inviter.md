# Lamaste E2E: 53 — Delegated invitations: an inviter grants only what it may (Three-VM)

> Started at `2026-11-10 14:18:43 UTC`


## Pre-flight

✅ `14:18:43` Onboarding is complete  
✅ `14:18:44` Agent test-agent is enrolled on the host  
✅ `14:18:44` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:18:45` The agent VM's lamaste-agent has the apphost command  
✅ `14:18:45` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `14:18:45` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a coordinator, a viewer, an outsider (external members of B); a member of A alone

✅ `14:18:46` Domain lamaste-second.local added (201)  
✅ `14:18:46` …pending until activated  
✅ `14:18:46` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:18:46` …the one required record is auth.lamaste-second.local  
✅ `14:18:48` lamaste-second.local is active  
✅ `14:18:48` User e2e53-coord created, member of lamaste-second.local (external)  
✅ `14:18:49` User e2e53-viewer created, member of lamaste-second.local (external)  
✅ `14:18:50` User e2e53-outsider created, member of lamaste-second.local (external)  
✅ `14:18:50` User e2e53-mem-a created, member of test.lamaste.local  

## The plugin, with an inviting role, installed, approved, hosted, on B

✅ `14:18:51` Fixture built: @lamalibre/e2e-xinv-server (coordinator invites coordinator and viewer; web surface e2e53web)  
✅ `14:18:59` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent )  
✅ `14:19:00` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:19:01` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T14:19:01.216Z"})  
✅ `14:19:01` …through its own OIDC client  
✅ `14:19:05` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:19:10` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `14:19:10` …approved  
✅ `14:19:10` …moved to B, before any surface  
✅ `14:19:21` …hosted on test-agent ()  
✅ `14:19:41` …its hosting is up  
✅ `14:19:41` …ready: its agent half's first complete sync ended at the head  
✅ `14:19:41` The approved block names what the coordinator may give  

## The policy: off until the administrator enables it, and only with a restricted web surface

✅ `14:19:41` A plugin nobody set a policy for: off, the defaults  
✅ `14:19:41` …its inviting role listed  
✅ `14:19:41` Enabling with no e-mail domain: 400  
✅ `14:19:41` Enabling with no web surface: 409  
✅ `14:19:41` …invitations_unavailable  
✅ `14:19:44` POST /api/plugins/e2e-xinv/web-surface {accessMode: authenticated}  
✅ `14:19:44` …the site e2e53web.lamaste-second.local, authenticated, on B  
✅ `14:19:44` …served  
✅ `14:19:44` Enabling on an authenticated web surface: 409 (it refuses external members)  
✅ `14:19:44` …it says why  
✅ `14:19:47` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `14:19:47` …the site e2e53web.lamaste-second.local, restricted, on B  
✅ `14:19:47` …served  

## The people: roles and the site's grant, as the administrator gives them

✅ `14:19:47` e2e53-coord entitled as coordinator  
✅ `14:19:48` e2e53-viewer entitled as viewer  
✅ `14:19:48` Granted site ca9871ec-b5c4-48bf-b96c-05841b3da42e to user e2e53-coord  
✅ `14:19:48` Granted site ca9871ec-b5c4-48bf-b96c-05841b3da42e to user e2e53-viewer  
✅ `14:19:48` The audience holds e2e53-coord as coordinator  
✅ `14:19:48` …and e2e53-viewer as viewer  
✅ `14:19:48` users.yml gives e2e53-coord the site's hostname as a group  
✅ `14:19:50` e2e53-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:19:52` e2e53-viewer signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:19:54` e2e53-outsider signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:19:56` e2e53-mem-a signed in at auth.lamaste-second.local (password, TOTP)  

## Off: the coordinator is refused until the policy is enabled

✅ `14:19:56` GET with the policy off: 403  
✅ `14:19:56` …invitations_unavailable (never why)  
✅ `14:19:56` Enabled, for addresses under example.test  
✅ `14:19:56` …available  

## The inviter's page on auth.<B>: its own origin, by hash, unframed

✅ `14:19:57` GET auth.<B>/invitations/e2e-xinv: 200  
✅ `14:19:57` …the stock inviter's page  
✅ `14:19:57` …nothing from a foreign host  
✅ `14:19:57` …the CSP names the served script's hash  
✅ `14:19:57` …and the served style's  
✅ `14:19:57` …nothing frames it  
✅ `14:19:57` …nothing else loads  
✅ `14:19:57` X-Frame-Options: DENY  
✅ `14:19:57` Cross-Origin-Opener-Policy: same-origin  
✅ `14:19:57` Referrer-Policy: same-origin (no-referrer would make a fetch POST send Origin: null)  
✅ `14:19:57` Cache-Control: no-store  

## Who may ask

✅ `14:19:57` No session: 401  
✅ `14:19:57` …JSON, never a redirect (the page sends the browser to sign in)  
✅ `14:19:57` e2e53-mem-a, a member of A alone: 403 at auth.<B>  
✅ `14:19:57` e2e53-outsider, external on B with no role and no site: 403  

## What the coordinator may give, and what the viewer may not

✅ `14:19:57` e2e53-coord: GET 200  
✅ `14:19:57` …the roles they may give, editor not among them  
✅ `14:19:57` …the bounds; none open  
✅ `14:19:57` …the way back to the plugin's site  
✅ `14:19:57` …never cached  
✅ `14:19:58` editor, which the coordinator may not give: 403  
✅ `14:19:58` …role_not_grantable  
✅ `14:19:58` A role that does not exist: 403  
✅ `14:19:58` An address under another domain: 400  
✅ `14:19:58` …email_domain_not_allowed  
✅ `14:19:58` A body naming anything else (groups): 400, strict  
✅ `14:19:58` e2e53-viewer, whose role invites nobody: 403  
✅ `14:19:58` …role_not_grantable  

## From nowhere but the sign-in host's page

✅ `14:19:58` A POST the plugin's own pages would send (Origin of its site, same-site): 403  
✅ `14:19:59` …its Origin alone: 403  
✅ `14:19:59` …a same-site fetch alone: 403  
✅ `14:19:59` …no Origin at all: 403  
✅ `14:19:59` The same POST on the plugin's own host makes nothing  
✅ `14:19:59` …no link  
✅ `14:19:59` …and a GET there reads nothing  
✅ `14:19:59` No invitation was made by any of those  

## An invitation: a link the inviter sends themselves

✅ `14:19:59` e2e53-coord invites ayse@example.test as viewer: 201  
✅ `14:19:59` …a link on the sign-in host, the token in its fragment  
✅ `14:20:00` The panel lists it with its inviter  
✅ `14:20:00` e2e53-coord sees their own, pending  
✅ `14:20:00` …one open  
✅ `14:20:00` e2e53-viewer sees none of it  

## The link opens on B's sign-in host alone

✅ `14:20:00` POST auth.<B>/api/invite/lookup: 200  
✅ `14:20:00` …what it is for and who invited, by display name  
✅ `14:20:00` …never the inviter's username  
✅ `14:20:00` auth.<A>: 404, as no invitation at all  
✅ `14:20:00` :9292, Host and X-Forwarded-Host naming auth.<B>: 404  
✅ `14:20:01` The panel vhost, X-Forwarded-Host naming auth.<B>: 404  
✅ `14:20:01` auth.<A>, X-Forwarded-Host naming auth.<B>: 404  
✅ `14:20:01` The token in a URL opens nothing: the path routes are gone  
✅ `14:20:01` …it says nothing of the invitation  
✅ `14:20:01` A token that was never made: 404  
✅ `14:20:01` The invitation page at /invite: 200 (the fragment never reaches the server)  
✅ `14:20:01` …its CSP names the served script's hash  
✅ `14:20:01` …no foreign script: the QR is the panel's  

## A username anything names is refused, with one answer

✅ `14:20:02` User e2e53-gone created, member of lamaste-second.local (external)  
✅ `14:20:02` Granted tunnel e2e53-a-restricted-tunnel to user e2e53-future  
✅ `14:20:03` e2e53-future, which a Gatekeeper grant names for a user still to come: 409  
✅ `14:20:03` …username_unavailable  
✅ `14:20:03` e2e53-gone, a removed user's: 409  
✅ `14:20:03` …the same answer, whatever named it  
✅ `14:20:03` e2e53-coord, a living user's: 409  
✅ `14:20:03` …the same answer  
✅ `14:20:03` The invitation stays pending; no name is held  

## Accepted: a new external member of B, with the one role and the site

✅ `14:20:04` POST auth.<B>/api/invite/accept: 200  
✅ `14:20:04` …e2e53-invitee, access complete, sent to the plugin's site  
✅ `14:20:04` …the QR, drawn by the panel  
✅ `14:20:04` …with its TOTP secret  
✅ `14:20:04` The directory holds them by id  
✅ `14:20:05` The invitation is accepted, complete; its copy of the address gone  
✅ `14:20:05` e2e53-invitee is an external member of B, of nothing else  
✅ `14:20:05` …no Authelia group  
✅ `14:20:05` users.yml gives them the site's hostname, as a grant does  
✅ `14:20:05` …and holds nothing else in users.yml  
✅ `14:20:06` Gatekeeper holds exactly the role and the site's grant  
✅ `14:20:06` …with the role asked for  
✅ `14:20:06` The audience holds them as viewer  
✅ `14:20:06` …and the agent half's projection: the plugin learned of them through the feed  
✅ `14:20:06` …with the role and the declared attributes  

## They reach the plugin

✅ `14:20:07` e2e53-invitee signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:20:08` e2e53-invitee: the shell, signed in with the factor the invitation gave  
✅ `14:20:08` …GET /api/e2e-xinv/app/echo 200  
✅ `14:20:08` …the agent half sees the directory's user and their role  

## One use

✅ `14:20:08` The link again: lookup 410  
✅ `14:20:08` …accept 410  

## The cap

✅ `14:20:08` The administrator lowers the cap to one open invitation  
✅ `14:20:08` One more for e2e53-coord: 201  
✅ `14:20:08` …a link on the sign-in host, the token in its fragment  
✅ `14:20:09` The next: 409  
✅ `14:20:09` …invitation_cap, the inviter's  
✅ `14:20:09` People by invitation capped at 2 (one joined, one open)  
✅ `14:20:09` The next: 409  
✅ `14:20:09` …invitation_cap, the plugin's  
✅ `14:20:09` e2e53-coord revokes their own pending one  

## Oversight: audited with no address, the administrators notified

✅ `14:20:09` invitation.created by the inviter's id, the address's domain alone  
✅ `14:20:09` invitation.accepted by id, with its inviter  
✅ `14:20:10` No audit entry holds an address  
✅ `14:20:10` The administrators were told someone joined, once  

## No token at rest or in a log

✅ `14:20:10` The token is in no journal of the panel or Gatekeeper  
✅ `14:20:10` …in no nginx log line but the one this spec's GET of the removed path made  
✅ `14:20:10` …and state.db does not hold it  
✅ `14:20:10` …anywhere in its bytes, its write-ahead log included  

## Nothing restarted Authelia

✅ `14:20:10` An invitation, its acceptance and a new user: Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `159` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `159` |

ℹ️ `14:20:10` Cleaning up test resources...  
