# Lamaste E2E: 49 — External members: reach only what names them (Three-VM)

> Started at `2026-11-04 14:39:17 UTC`


## Pre-flight

✅ `14:39:17` Onboarding is complete  
✅ `14:39:18` Agent test-agent is enrolled on the host  
✅ `14:39:18` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; a member and an external member of B

✅ `14:39:19` Domain lamaste-second.local added (201)  
✅ `14:39:19` …pending until activated  
✅ `14:39:19` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:39:19` …the one required record is auth.lamaste-second.local  
✅ `14:39:21` lamaste-second.local is active  
✅ `14:39:22` User e2e49-member created, member of lamaste-second.local  
✅ `14:39:23` User e2e49-ext created, member of lamaste-second.local (external)  
✅ `14:39:23` Both have a directory id  
✅ `14:39:23` GET /api/users: e2e49-ext is an external member of B  
✅ `14:39:23` …e2e49-member a member  
✅ `14:39:24` B's member list marks e2e49-ext external  
✅ `14:39:24` GET /api/domains counts B's external members  

## An authenticated and a restricted tunnel on B; a protected site listing the member

✅ `14:39:28` Tunnel e2e49a.lamaste-second.local (authenticated), carried by test-agent  
✅ `14:39:31` Tunnel e2e49r.lamaste-second.local (restricted), carried by test-agent  
✅ `14:39:36` Port 18491: the backend answers through chisel  
✅ `14:39:36` Port 18492: the backend answers through chisel  
✅ `14:39:40` Site e2e49site.lamaste-second.local, Authelia-protected  
✅ `14:39:41` …its listed users: e2e49-member  
✅ `14:39:41` B's rules name its group key  
✅ `14:39:42` …and a rule for B's external members  
✅ `14:39:42` …the site's rule names its group, never a user  
✅ `14:39:42` …no rule names a user  
✅ `14:39:42` users.yml gives e2e49-ext B's external group  
✅ `14:39:42` …never B's member group  
✅ `14:39:43` …and nothing else: no Authelia group, no host  
✅ `14:39:43` users.yml gives e2e49-member the site's group (listed)  

## Both signed in at auth.B; Authelia's MainPID from here on

✅ `14:39:46` e2e49-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:39:48` e2e49-ext signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:39:48` Authelia runs (MainPID 148712)  
✅ `14:39:48` After signing in, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `14:39:48` …from its backend  
✅ `14:39:48` …and on the site: 200  
✅ `14:39:49` …Authelia not restarted (MainPID 148712)  

## The authenticated tunnel refuses an external member

✅ `14:39:49` e2e49-ext on the authenticated tunnel: 403  
✅ `14:39:49` …the access-request page  
✅ `14:39:49` …not the domain refusal  
✅ `14:39:49` …never a redirect to a sign-in page  
✅ `14:39:49` …nothing of the tunnel  

## Authelia refuses on its own: the projection calls e2e49-ext a member

✅ `14:39:49` The projection held with e2e49-ext as a member (Gatekeeper would admit them)  
✅ `14:39:50` e2e49-ext on the authenticated tunnel: still 403 — Authelia's rules admit B's external group only on hosts named for them  
✅ `14:39:50` …nothing of the tunnel  
✅ `14:39:50` The panel's projection back: e2e49-ext: 403  
✅ `14:39:50` …the access-request page  
✅ `14:39:50` …not the domain refusal  
✅ `14:39:50` …never a redirect to a sign-in page  

## The restricted tunnel: a direct grant

✅ `14:39:50` e2e49-ext on the restricted tunnel without a grant: 403  
✅ `14:39:51` …the access-request page  
✅ `14:39:51` …not the domain refusal  
✅ `14:39:51` …never a redirect to a sign-in page  
✅ `14:39:51` Granted tunnel ef05c1d2-e815-4e44-a171-dd6dc5dd5ad7 to user e2e49-ext  
✅ `14:39:51` users.yml gives e2e49-ext the tunnel's hostname as a group  
✅ `14:39:51` e2e49-ext, granted, on the restricted tunnel: 200 — the same session  
✅ `14:39:51` e2e49-ext on the restricted tunnel: 200  
✅ `14:39:51` …from its backend  
✅ `14:39:52` …still refused on the authenticated one: 403  
✅ `14:39:52` …the access-request page  
✅ `14:39:52` …not the domain refusal  
✅ `14:39:52` …never a redirect to a sign-in page  
✅ `14:39:52` After the grant, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `14:39:52` …from its backend  
✅ `14:39:52` …and on the site: 200  
✅ `14:39:52` …Authelia not restarted (MainPID 148712)  

## Revoked: refused again

✅ `14:39:53` The grant revoked  
✅ `14:39:53` users.yml takes the tunnel's group from e2e49-ext  
✅ `14:39:53` e2e49-ext on the restricted tunnel: 403 within 30 s  
✅ `14:39:53` …e2e49-ext, the grant revoked: 403  
✅ `14:39:53` …the access-request page  
✅ `14:39:53` …not the domain refusal  
✅ `14:39:53` …never a redirect to a sign-in page  
✅ `14:39:53` After the revocation, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `14:39:53` …from its backend  
✅ `14:39:54` …and on the site: 200  
✅ `14:39:54` …Authelia not restarted (MainPID 148712)  

## A grant to a Lamaste group

✅ `14:39:54` Lamaste group e2e49-team created  
✅ `14:39:54` …e2e49-ext its member  
✅ `14:39:55` Granted tunnel ef05c1d2-e815-4e44-a171-dd6dc5dd5ad7 to group e2e49-team  
✅ `14:39:55` users.yml gives e2e49-ext the tunnel's group — through the Lamaste group  
✅ `14:39:55` …never the Lamaste group itself (it lives in Gatekeeper)  
✅ `14:39:55` e2e49-ext, in a granted Lamaste group, on the restricted tunnel: 200  
✅ `14:39:55` e2e49-ext leaves e2e49-team  
✅ `14:39:56` users.yml takes the tunnel's group from e2e49-ext  
✅ `14:39:56` e2e49-ext, no longer in the group: 403  
✅ `14:39:56` After the Lamaste group changes, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `14:39:56` …from its backend  
✅ `14:39:56` …and on the site: 200  
✅ `14:39:56` …Authelia not restarted (MainPID 148712)  

## The static site: only once its listed users name e2e49-ext

✅ `14:39:57` e2e49-ext on the site, not listed: 403  
✅ `14:39:57` …the refusal page names the site  
✅ `14:39:57` …nothing of the site  
✅ `14:39:57` …never a redirect to a sign-in page  
✅ `14:39:57` The site lists e2e49-member and e2e49-ext  
✅ `14:39:57` users.yml gives e2e49-ext the site's group  
✅ `14:39:57` …by the site's id, never its hostname  
✅ `14:39:58` e2e49-ext, listed, on the site: 200 — the same session  
✅ `14:39:58` …the site's page  
✅ `14:39:58` After the site's list, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `14:39:58` …from its backend  
✅ `14:39:58` …and on the site: 200  
✅ `14:39:58` …Authelia not restarted (MainPID 148712)  

## Nobody was signed out

✅ `14:39:59` Authelia's MainPID is the one of before the first change  
✅ `14:39:59` Both sessions are still signed in at auth.lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `104` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `104` |

ℹ️ `14:39:59` Cleaning up test resources...  
