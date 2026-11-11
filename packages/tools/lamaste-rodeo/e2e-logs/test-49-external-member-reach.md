# Lamaste E2E: 49 — External members: reach only what names them (Three-VM)

> Started at `2026-11-10 18:56:08 UTC`


## Pre-flight

✅ `18:56:08` Onboarding is complete  
✅ `18:56:09` Agent test-agent is enrolled on the host  
✅ `18:56:09` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; a member and an external member of B

✅ `18:56:10` Domain lamaste-second.local added (201)  
✅ `18:56:10` …pending until activated  
✅ `18:56:10` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `18:56:10` …the one required record is auth.lamaste-second.local  
✅ `18:56:11` lamaste-second.local is active  
✅ `18:56:12` User e2e49-member created, member of lamaste-second.local  
✅ `18:56:13` User e2e49-ext created, member of lamaste-second.local (external)  
✅ `18:56:13` Both have a directory id  
✅ `18:56:13` GET /api/users: e2e49-ext is an external member of B  
✅ `18:56:13` …e2e49-member a member  
✅ `18:56:13` B's member list marks e2e49-ext external  
✅ `18:56:13` GET /api/domains counts B's external members  

## An authenticated and a restricted tunnel on B; a protected site listing the member

✅ `18:56:15` Tunnel e2e49a.lamaste-second.local (authenticated), carried by test-agent  
✅ `18:56:18` Tunnel e2e49r.lamaste-second.local (restricted), carried by test-agent  
✅ `18:56:19` Port 18491: the backend answers through chisel  
✅ `18:56:22` Port 18492: the backend answers through chisel  
✅ `18:56:24` Site e2e49site.lamaste-second.local, Authelia-protected  
✅ `18:56:25` …its listed users: e2e49-member  
✅ `18:56:26` B's rules name its group key  
✅ `18:56:26` …and a rule for B's external members  
✅ `18:56:26` …the site's rule names its group, never a user  
✅ `18:56:26` …no rule names a user  
✅ `18:56:26` users.yml gives e2e49-ext B's external group  
✅ `18:56:27` …never B's member group  
✅ `18:56:27` …and nothing else: no Authelia group, no host  
✅ `18:56:27` users.yml gives e2e49-member the site's group (listed)  

## Both signed in at auth.B; Authelia's MainPID from here on

✅ `18:56:30` e2e49-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:56:31` e2e49-ext signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:56:31` Authelia runs (MainPID 159839)  
✅ `18:56:32` After signing in, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `18:56:32` …from its backend  
✅ `18:56:32` …and on the site: 200  
✅ `18:56:32` …Authelia not restarted (MainPID 159839)  

## The authenticated tunnel refuses an external member

✅ `18:56:32` e2e49-ext on the authenticated tunnel: 403  
✅ `18:56:32` …the access-request page  
✅ `18:56:32` …not the domain refusal  
✅ `18:56:32` …never a redirect to a sign-in page  
✅ `18:56:32` …nothing of the tunnel  

## Authelia refuses on its own: the projection calls e2e49-ext a member

✅ `18:56:32` The projection held with e2e49-ext as a member (Gatekeeper would admit them)  
✅ `18:56:33` e2e49-ext on the authenticated tunnel: still 403 — Authelia's rules admit B's external group only on hosts named for them  
✅ `18:56:33` …nothing of the tunnel  
✅ `18:56:36` The panel's projection back: e2e49-ext: 403  
✅ `18:56:36` …the access-request page  
✅ `18:56:36` …not the domain refusal  
✅ `18:56:36` …never a redirect to a sign-in page  

## The restricted tunnel: a direct grant

✅ `18:56:36` e2e49-ext on the restricted tunnel without a grant: 403  
✅ `18:56:36` …the access-request page  
✅ `18:56:36` …not the domain refusal  
✅ `18:56:36` …never a redirect to a sign-in page  
✅ `18:56:37` Granted tunnel 38f15e08-1b2e-4dc8-aa80-7863d5033bf8 to user e2e49-ext  
✅ `18:56:37` users.yml gives e2e49-ext the tunnel's hostname as a group  
✅ `18:56:37` e2e49-ext, granted, on the restricted tunnel: 200 — the same session  
✅ `18:56:37` e2e49-ext on the restricted tunnel: 200  
✅ `18:56:37` …from its backend  
✅ `18:56:37` …still refused on the authenticated one: 403  
✅ `18:56:37` …the access-request page  
✅ `18:56:37` …not the domain refusal  
✅ `18:56:37` …never a redirect to a sign-in page  
✅ `18:56:37` After the grant, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `18:56:37` …from its backend  
✅ `18:56:37` …and on the site: 200  
✅ `18:56:38` …Authelia not restarted (MainPID 159839)  

## Revoked: refused again

✅ `18:56:38` The grant revoked  
✅ `18:56:38` users.yml takes the tunnel's group from e2e49-ext  
✅ `18:56:38` e2e49-ext on the restricted tunnel: 403 within 30 s  
✅ `18:56:38` …e2e49-ext, the grant revoked: 403  
✅ `18:56:38` …the access-request page  
✅ `18:56:38` …not the domain refusal  
✅ `18:56:38` …never a redirect to a sign-in page  
✅ `18:56:38` After the revocation, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `18:56:38` …from its backend  
✅ `18:56:39` …and on the site: 200  
✅ `18:56:39` …Authelia not restarted (MainPID 159839)  

## A grant to a Lamaste group

✅ `18:56:39` Lamaste group e2e49-team created  
✅ `18:56:39` …e2e49-ext its member  
✅ `18:56:39` Granted tunnel 38f15e08-1b2e-4dc8-aa80-7863d5033bf8 to group e2e49-team  
✅ `18:56:39` users.yml gives e2e49-ext the tunnel's group — through the Lamaste group  
✅ `18:56:39` …never the Lamaste group itself (it lives in Gatekeeper)  
✅ `18:56:40` e2e49-ext, in a granted Lamaste group, on the restricted tunnel: 200  
✅ `18:56:40` e2e49-ext leaves e2e49-team  
✅ `18:56:40` users.yml takes the tunnel's group from e2e49-ext  
✅ `18:56:40` e2e49-ext, no longer in the group: 403  
✅ `18:56:40` After the Lamaste group changes, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `18:56:40` …from its backend  
✅ `18:56:41` …and on the site: 200  
✅ `18:56:41` …Authelia not restarted (MainPID 159839)  

## The static site: only once its listed users name e2e49-ext

✅ `18:56:41` e2e49-ext on the site, not listed: 403  
✅ `18:56:41` …the refusal page names the site  
✅ `18:56:41` …nothing of the site  
✅ `18:56:41` …never a redirect to a sign-in page  
✅ `18:56:41` The site lists e2e49-member and e2e49-ext  
✅ `18:56:41` users.yml gives e2e49-ext the site's group  
✅ `18:56:41` …by the site's id, never its hostname  
✅ `18:56:45` e2e49-ext, listed, on the site: 200 — the same session  
✅ `18:56:45` …the site's page  
✅ `18:56:45` After the site's list, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `18:56:45` …from its backend  
✅ `18:56:45` …and on the site: 200  
✅ `18:56:45` …Authelia not restarted (MainPID 159839)  

## Nobody was signed out

✅ `18:56:46` Authelia's MainPID is the one of before the first change  
✅ `18:56:46` Both sessions are still signed in at auth.lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `104` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `104` |

ℹ️ `18:56:46` Cleaning up test resources...  
