# Lamaste E2E: 49 — External members: reach only what names them (Three-VM)

> Started at `2026-11-10 14:12:57 UTC`


## Pre-flight

✅ `14:12:57` Onboarding is complete  
✅ `14:12:57` Agent test-agent is enrolled on the host  
✅ `14:12:58` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; a member and an external member of B

✅ `14:12:58` Domain lamaste-second.local added (201)  
✅ `14:12:58` …pending until activated  
✅ `14:12:58` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:12:59` …the one required record is auth.lamaste-second.local  
✅ `14:13:00` lamaste-second.local is active  
✅ `14:13:01` User e2e49-member created, member of lamaste-second.local  
✅ `14:13:02` User e2e49-ext created, member of lamaste-second.local (external)  
✅ `14:13:02` Both have a directory id  
✅ `14:13:02` GET /api/users: e2e49-ext is an external member of B  
✅ `14:13:02` …e2e49-member a member  
✅ `14:13:02` B's member list marks e2e49-ext external  
✅ `14:13:02` GET /api/domains counts B's external members  

## An authenticated and a restricted tunnel on B; a protected site listing the member

✅ `14:13:05` Tunnel e2e49a.lamaste-second.local (authenticated), carried by test-agent  
✅ `14:13:07` Tunnel e2e49r.lamaste-second.local (restricted), carried by test-agent  
✅ `14:13:11` Port 18491: the backend answers through chisel  
✅ `14:13:11` Port 18492: the backend answers through chisel  
✅ `14:13:14` Site e2e49site.lamaste-second.local, Authelia-protected  
✅ `14:13:15` …its listed users: e2e49-member  
✅ `14:13:15` B's rules name its group key  
✅ `14:13:15` …and a rule for B's external members  
✅ `14:13:15` …the site's rule names its group, never a user  
✅ `14:13:16` …no rule names a user  
✅ `14:13:16` users.yml gives e2e49-ext B's external group  
✅ `14:13:16` …never B's member group  
✅ `14:13:16` …and nothing else: no Authelia group, no host  
✅ `14:13:16` users.yml gives e2e49-member the site's group (listed)  

## Both signed in at auth.B; Authelia's MainPID from here on

✅ `14:13:18` e2e49-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:13:20` e2e49-ext signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:13:21` Authelia runs (MainPID 155464)  
✅ `14:13:21` After signing in, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `14:13:21` …from its backend  
✅ `14:13:21` …and on the site: 200  
✅ `14:13:21` …Authelia not restarted (MainPID 155464)  

## The authenticated tunnel refuses an external member

✅ `14:13:21` e2e49-ext on the authenticated tunnel: 403  
✅ `14:13:21` …the access-request page  
✅ `14:13:21` …not the domain refusal  
✅ `14:13:21` …never a redirect to a sign-in page  
✅ `14:13:21` …nothing of the tunnel  

## Authelia refuses on its own: the projection calls e2e49-ext a member

✅ `14:13:22` The projection held with e2e49-ext as a member (Gatekeeper would admit them)  
✅ `14:13:22` e2e49-ext on the authenticated tunnel: still 403 — Authelia's rules admit B's external group only on hosts named for them  
✅ `14:13:22` …nothing of the tunnel  
✅ `14:13:25` The panel's projection back: e2e49-ext: 403  
✅ `14:13:25` …the access-request page  
✅ `14:13:25` …not the domain refusal  
✅ `14:13:25` …never a redirect to a sign-in page  

## The restricted tunnel: a direct grant

✅ `14:13:26` e2e49-ext on the restricted tunnel without a grant: 403  
✅ `14:13:26` …the access-request page  
✅ `14:13:26` …not the domain refusal  
✅ `14:13:26` …never a redirect to a sign-in page  
✅ `14:13:26` Granted tunnel 46edc28d-59e7-4c46-825a-6aac2219098f to user e2e49-ext  
✅ `14:13:26` users.yml gives e2e49-ext the tunnel's hostname as a group  
✅ `14:13:26` e2e49-ext, granted, on the restricted tunnel: 200 — the same session  
✅ `14:13:26` e2e49-ext on the restricted tunnel: 200  
✅ `14:13:26` …from its backend  
✅ `14:13:27` …still refused on the authenticated one: 403  
✅ `14:13:27` …the access-request page  
✅ `14:13:27` …not the domain refusal  
✅ `14:13:27` …never a redirect to a sign-in page  
✅ `14:13:27` After the grant, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `14:13:27` …from its backend  
✅ `14:13:27` …and on the site: 200  
✅ `14:13:27` …Authelia not restarted (MainPID 155464)  

## Revoked: refused again

✅ `14:13:27` The grant revoked  
✅ `14:13:28` users.yml takes the tunnel's group from e2e49-ext  
✅ `14:13:28` e2e49-ext on the restricted tunnel: 403 within 30 s  
✅ `14:13:28` …e2e49-ext, the grant revoked: 403  
✅ `14:13:28` …the access-request page  
✅ `14:13:28` …not the domain refusal  
✅ `14:13:28` …never a redirect to a sign-in page  
✅ `14:13:28` After the revocation, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `14:13:28` …from its backend  
✅ `14:13:29` …and on the site: 200  
✅ `14:13:29` …Authelia not restarted (MainPID 155464)  

## A grant to a Lamaste group

✅ `14:13:29` Lamaste group e2e49-team created  
✅ `14:13:29` …e2e49-ext its member  
✅ `14:13:29` Granted tunnel 46edc28d-59e7-4c46-825a-6aac2219098f to group e2e49-team  
✅ `14:13:29` users.yml gives e2e49-ext the tunnel's group — through the Lamaste group  
✅ `14:13:30` …never the Lamaste group itself (it lives in Gatekeeper)  
✅ `14:13:31` e2e49-ext, in a granted Lamaste group, on the restricted tunnel: 200  
✅ `14:13:31` e2e49-ext leaves e2e49-team  
✅ `14:13:31` users.yml takes the tunnel's group from e2e49-ext  
✅ `14:13:31` e2e49-ext, no longer in the group: 403  
✅ `14:13:32` After the Lamaste group changes, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `14:13:32` …from its backend  
✅ `14:13:32` …and on the site: 200  
✅ `14:13:32` …Authelia not restarted (MainPID 155464)  

## The static site: only once its listed users name e2e49-ext

✅ `14:13:32` e2e49-ext on the site, not listed: 403  
✅ `14:13:32` …the refusal page names the site  
✅ `14:13:32` …nothing of the site  
✅ `14:13:32` …never a redirect to a sign-in page  
✅ `14:13:32` The site lists e2e49-member and e2e49-ext  
✅ `14:13:33` users.yml gives e2e49-ext the site's group  
✅ `14:13:33` …by the site's id, never its hostname  
✅ `14:13:33` e2e49-ext, listed, on the site: 200 — the same session  
✅ `14:13:33` …the site's page  
✅ `14:13:33` After the site's list, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `14:13:33` …from its backend  
✅ `14:13:33` …and on the site: 200  
✅ `14:13:34` …Authelia not restarted (MainPID 155464)  

## Nobody was signed out

✅ `14:13:34` Authelia's MainPID is the one of before the first change  
✅ `14:13:34` Both sessions are still signed in at auth.lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `104` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `104` |

ℹ️ `14:13:34` Cleaning up test resources...  
