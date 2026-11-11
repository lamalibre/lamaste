# Lamaste E2E: 49 — External members: reach only what names them (Three-VM)

> Started at `2026-11-11 11:25:58 UTC`


## Pre-flight

✅ `11:25:58` Onboarding is complete  
✅ `11:25:59` Agent test-agent is enrolled on the host  
✅ `11:25:59` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; a member and an external member of B

✅ `11:26:00` Domain lamaste-second.local added (201)  
✅ `11:26:00` …pending until activated  
✅ `11:26:00` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `11:26:00` …the one required record is auth.lamaste-second.local  
✅ `11:26:01` lamaste-second.local is active  
✅ `11:26:02` User e2e49-member created, member of lamaste-second.local  
✅ `11:26:03` User e2e49-ext created, member of lamaste-second.local (external)  
✅ `11:26:03` Both have a directory id  
✅ `11:26:03` GET /api/users: e2e49-ext is an external member of B  
✅ `11:26:03` …e2e49-member a member  
✅ `11:26:03` B's member list marks e2e49-ext external  
✅ `11:26:03` GET /api/domains counts B's external members  

## An authenticated and a restricted tunnel on B; a protected site listing the member

✅ `11:26:07` Tunnel e2e49a.lamaste-second.local (authenticated), carried by test-agent  
✅ `11:26:10` Tunnel e2e49r.lamaste-second.local (restricted), carried by test-agent  
✅ `11:26:15` Port 18491: the backend answers through chisel  
✅ `11:26:15` Port 18492: the backend answers through chisel  
✅ `11:26:18` Site e2e49site.lamaste-second.local, Authelia-protected  
✅ `11:26:19` …its listed users: e2e49-member  
✅ `11:26:19` B's rules name its group key  
✅ `11:26:20` …and a rule for B's external members  
✅ `11:26:20` …the site's rule names its group, never a user  
✅ `11:26:20` …no rule names a user  
✅ `11:26:20` users.yml gives e2e49-ext B's external group  
✅ `11:26:20` …never B's member group  
✅ `11:26:20` …and nothing else: no Authelia group, no host  
✅ `11:26:21` users.yml gives e2e49-member the site's group (listed)  

## Both signed in at auth.B; Authelia's MainPID from here on

✅ `11:26:23` e2e49-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `11:26:25` e2e49-ext signed in at auth.lamaste-second.local (password, TOTP)  
✅ `11:26:25` Authelia runs (MainPID 388084)  
✅ `11:26:25` After signing in, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `11:26:25` …from its backend  
✅ `11:26:26` …and on the site: 200  
✅ `11:26:26` …Authelia not restarted (MainPID 388084)  

## The authenticated tunnel refuses an external member

✅ `11:26:26` e2e49-ext on the authenticated tunnel: 403  
✅ `11:26:26` …the access-request page  
✅ `11:26:26` …not the domain refusal  
✅ `11:26:26` …never a redirect to a sign-in page  
✅ `11:26:26` …nothing of the tunnel  

## Authelia refuses on its own: the projection calls e2e49-ext a member

✅ `11:26:26` The projection held with e2e49-ext as a member (Gatekeeper would admit them)  
✅ `11:26:26` e2e49-ext on the authenticated tunnel: still 403 — Authelia's rules admit B's external group only on hosts named for them  
✅ `11:26:26` …nothing of the tunnel  
✅ `11:26:30` The panel's projection back: e2e49-ext: 403  
✅ `11:26:30` …the access-request page  
✅ `11:26:30` …not the domain refusal  
✅ `11:26:30` …never a redirect to a sign-in page  

## The restricted tunnel: a direct grant

✅ `11:26:30` e2e49-ext on the restricted tunnel without a grant: 403  
✅ `11:26:30` …the access-request page  
✅ `11:26:30` …not the domain refusal  
✅ `11:26:30` …never a redirect to a sign-in page  
✅ `11:26:30` Granted tunnel 008d910e-7ed4-42f4-bb16-defcc2dbee38 to user e2e49-ext  
✅ `11:26:31` users.yml gives e2e49-ext the tunnel's hostname as a group  
✅ `11:26:31` e2e49-ext, granted, on the restricted tunnel: 200 — the same session  
✅ `11:26:31` e2e49-ext on the restricted tunnel: 200  
✅ `11:26:31` …from its backend  
✅ `11:26:31` …still refused on the authenticated one: 403  
✅ `11:26:31` …the access-request page  
✅ `11:26:31` …not the domain refusal  
✅ `11:26:31` …never a redirect to a sign-in page  
✅ `11:26:31` After the grant, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `11:26:31` …from its backend  
✅ `11:26:31` …and on the site: 200  
✅ `11:26:32` …Authelia not restarted (MainPID 388084)  

## Revoked: refused again

✅ `11:26:32` The grant revoked  
✅ `11:26:32` users.yml takes the tunnel's group from e2e49-ext  
✅ `11:26:32` e2e49-ext on the restricted tunnel: 403 within 30 s  
✅ `11:26:32` …e2e49-ext, the grant revoked: 403  
✅ `11:26:32` …the access-request page  
✅ `11:26:32` …not the domain refusal  
✅ `11:26:32` …never a redirect to a sign-in page  
✅ `11:26:33` After the revocation, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `11:26:33` …from its backend  
✅ `11:26:33` …and on the site: 200  
✅ `11:26:33` …Authelia not restarted (MainPID 388084)  

## A grant to a Lamaste group

✅ `11:26:33` Lamaste group e2e49-team created  
✅ `11:26:33` …e2e49-ext its member  
✅ `11:26:33` Granted tunnel 008d910e-7ed4-42f4-bb16-defcc2dbee38 to group e2e49-team  
✅ `11:26:33` users.yml gives e2e49-ext the tunnel's group — through the Lamaste group  
✅ `11:26:34` …never the Lamaste group itself (it lives in Gatekeeper)  
✅ `11:26:34` e2e49-ext, in a granted Lamaste group, on the restricted tunnel: 200  
✅ `11:26:34` e2e49-ext leaves e2e49-team  
✅ `11:26:34` users.yml takes the tunnel's group from e2e49-ext  
✅ `11:26:34` e2e49-ext, no longer in the group: 403  
✅ `11:26:34` After the Lamaste group changes, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `11:26:34` …from its backend  
✅ `11:26:34` …and on the site: 200  
✅ `11:26:35` …Authelia not restarted (MainPID 388084)  

## The static site: only once its listed users name e2e49-ext

✅ `11:26:35` e2e49-ext on the site, not listed: 403  
✅ `11:26:35` …the refusal page names the site  
✅ `11:26:35` …nothing of the site  
✅ `11:26:35` …never a redirect to a sign-in page  
✅ `11:26:35` The site lists e2e49-member and e2e49-ext  
✅ `11:26:35` users.yml gives e2e49-ext the site's group  
✅ `11:26:35` …by the site's id, never its hostname  
✅ `11:26:39` e2e49-ext, listed, on the site: 200 — the same session  
✅ `11:26:39` …the site's page  
✅ `11:26:39` After the site's list, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `11:26:39` …from its backend  
✅ `11:26:39` …and on the site: 200  
✅ `11:26:39` …Authelia not restarted (MainPID 388084)  

## Nobody was signed out

✅ `11:26:39` Authelia's MainPID is the one of before the first change  
✅ `11:26:40` Both sessions are still signed in at auth.lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `104` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `104` |

ℹ️ `11:26:40` Cleaning up test resources...  
