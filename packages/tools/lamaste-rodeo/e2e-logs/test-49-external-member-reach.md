# Lamaste E2E: 49 — External members: reach only what names them (Three-VM)

> Started at `2026-11-03 10:35:53 UTC`


## Pre-flight

✅ `10:35:53` Onboarding is complete  
✅ `10:35:53` Agent test-agent is enrolled on the host  
✅ `10:35:53` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; a member and an external member of B

✅ `10:35:54` Domain lamaste-second.local added (201)  
✅ `10:35:54` …pending until activated  
✅ `10:35:54` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `10:35:54` …the one required record is auth.lamaste-second.local  
✅ `10:35:55` lamaste-second.local is active  
✅ `10:35:56` User e2e49-member created, member of lamaste-second.local  
✅ `10:35:56` User e2e49-ext created, member of lamaste-second.local (external)  
✅ `10:35:56` Both have a directory id  
✅ `10:35:56` GET /api/users: e2e49-ext is an external member of B  
✅ `10:35:56` …e2e49-member a member  
✅ `10:35:57` B's member list marks e2e49-ext external  
✅ `10:35:57` GET /api/domains counts B's external members  

## An authenticated and a restricted tunnel on B; a protected site listing the member

✅ `10:35:58` Tunnel e2e49a.lamaste-second.local (authenticated), carried by test-agent  
✅ `10:36:01` Tunnel e2e49r.lamaste-second.local (restricted), carried by test-agent  
✅ `10:36:05` Port 18491: the backend answers through chisel  
✅ `10:36:05` Port 18492: the backend answers through chisel  
✅ `10:36:07` Site e2e49site.lamaste-second.local, Authelia-protected  
✅ `10:36:07` …its listed users: e2e49-member  
✅ `10:36:08` B's rules name its group key  
✅ `10:36:08` …and a rule for B's external members  
✅ `10:36:08` …the site's rule names its group, never a user  
✅ `10:36:08` …no rule names a user  
✅ `10:36:08` users.yml gives e2e49-ext B's external group  
✅ `10:36:09` …never B's member group  
✅ `10:36:09` …and nothing else: no Authelia group, no host  
✅ `10:36:09` users.yml gives e2e49-member the site's group (listed)  

## Both signed in at auth.B; Authelia's MainPID from here on

✅ `10:36:11` e2e49-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:36:12` e2e49-ext signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:36:13` Authelia runs (MainPID 155162)  
✅ `10:36:13` After signing in, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `10:36:13` …from its backend  
✅ `10:36:13` …and on the site: 200  
✅ `10:36:13` …Authelia not restarted (MainPID 155162)  

## The authenticated tunnel refuses an external member

✅ `10:36:13` e2e49-ext on the authenticated tunnel: 403  
✅ `10:36:13` …the access-request page  
✅ `10:36:13` …not the domain refusal  
✅ `10:36:13` …never a redirect to a sign-in page  
✅ `10:36:13` …nothing of the tunnel  

## Authelia refuses on its own: the projection calls e2e49-ext a member

✅ `10:36:13` The projection held with e2e49-ext as a member (Gatekeeper would admit them)  
✅ `10:36:13` e2e49-ext on the authenticated tunnel: still 403 — Authelia's rules admit B's external group only on hosts named for them  
✅ `10:36:13` …nothing of the tunnel  
✅ `10:36:17` The panel's projection back: e2e49-ext: 403  
✅ `10:36:17` …the access-request page  
✅ `10:36:17` …not the domain refusal  
✅ `10:36:17` …never a redirect to a sign-in page  

## The restricted tunnel: a direct grant

✅ `10:36:17` e2e49-ext on the restricted tunnel without a grant: 403  
✅ `10:36:17` …the access-request page  
✅ `10:36:17` …not the domain refusal  
✅ `10:36:17` …never a redirect to a sign-in page  
✅ `10:36:17` Granted tunnel cca5e28a-bd7e-42a2-9ba5-ccf65a0e66d5 to user e2e49-ext  
✅ `10:36:17` users.yml gives e2e49-ext the tunnel's hostname as a group  
✅ `10:36:17` e2e49-ext, granted, on the restricted tunnel: 200 — the same session  
✅ `10:36:17` e2e49-ext on the restricted tunnel: 200  
✅ `10:36:17` …from its backend  
✅ `10:36:18` …still refused on the authenticated one: 403  
✅ `10:36:18` …the access-request page  
✅ `10:36:18` …not the domain refusal  
✅ `10:36:18` …never a redirect to a sign-in page  
✅ `10:36:18` After the grant, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `10:36:18` …from its backend  
✅ `10:36:18` …and on the site: 200  
✅ `10:36:18` …Authelia not restarted (MainPID 155162)  

## Revoked: refused again

✅ `10:36:18` The grant revoked  
✅ `10:36:18` users.yml takes the tunnel's group from e2e49-ext  
✅ `10:36:18` e2e49-ext on the restricted tunnel: 403 within 30 s  
✅ `10:36:18` …e2e49-ext, the grant revoked: 403  
✅ `10:36:18` …the access-request page  
✅ `10:36:18` …not the domain refusal  
✅ `10:36:18` …never a redirect to a sign-in page  
✅ `10:36:18` After the revocation, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `10:36:18` …from its backend  
✅ `10:36:19` …and on the site: 200  
✅ `10:36:19` …Authelia not restarted (MainPID 155162)  

## A grant to a Lamaste group

✅ `10:36:19` Lamaste group e2e49-team created  
✅ `10:36:19` …e2e49-ext its member  
✅ `10:36:19` Granted tunnel cca5e28a-bd7e-42a2-9ba5-ccf65a0e66d5 to group e2e49-team  
✅ `10:36:19` users.yml gives e2e49-ext the tunnel's group — through the Lamaste group  
✅ `10:36:19` …never the Lamaste group itself (it lives in Gatekeeper)  
✅ `10:36:22` e2e49-ext, in a granted Lamaste group, on the restricted tunnel: 200  
✅ `10:36:23` e2e49-ext leaves e2e49-team  
✅ `10:36:23` users.yml takes the tunnel's group from e2e49-ext  
✅ `10:36:23` e2e49-ext, no longer in the group: 403  
✅ `10:36:23` After the Lamaste group changes, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `10:36:23` …from its backend  
✅ `10:36:23` …and on the site: 200  
✅ `10:36:23` …Authelia not restarted (MainPID 155162)  

## The static site: only once its listed users name e2e49-ext

✅ `10:36:23` e2e49-ext on the site, not listed: 403  
✅ `10:36:23` …the refusal page names the site  
✅ `10:36:23` …nothing of the site  
✅ `10:36:23` …never a redirect to a sign-in page  
✅ `10:36:23` The site lists e2e49-member and e2e49-ext  
✅ `10:36:23` users.yml gives e2e49-ext the site's group  
✅ `10:36:24` …by the site's id, never its hostname  
✅ `10:36:27` e2e49-ext, listed, on the site: 200 — the same session  
✅ `10:36:27` …the site's page  
✅ `10:36:27` After the site's list, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `10:36:27` …from its backend  
✅ `10:36:27` …and on the site: 200  
✅ `10:36:27` …Authelia not restarted (MainPID 155162)  

## Nobody was signed out

✅ `10:36:27` Authelia's MainPID is the one of before the first change  
✅ `10:36:28` Both sessions are still signed in at auth.lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `104` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `104` |

ℹ️ `10:36:28` Cleaning up test resources...  
