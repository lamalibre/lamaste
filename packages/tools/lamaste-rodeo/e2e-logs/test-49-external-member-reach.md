# Lamaste E2E: 49 — External members: reach only what names them (Three-VM)

> Started at `2026-11-02 16:52:05 UTC`


## Pre-flight

✅ `16:52:05` Onboarding is complete  
✅ `16:52:05` Agent test-agent is enrolled on the host  
✅ `16:52:06` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; a member and an external member of B

✅ `16:52:06` Domain lamaste-second.local added (201)  
✅ `16:52:06` …pending until activated  
✅ `16:52:06` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `16:52:06` …the one required record is auth.lamaste-second.local  
✅ `16:52:08` lamaste-second.local is active  
✅ `16:52:09` User e2e49-member created, member of lamaste-second.local  
✅ `16:52:09` User e2e49-ext created, member of lamaste-second.local (external)  
✅ `16:52:09` Both have a directory id  
✅ `16:52:09` GET /api/users: e2e49-ext is an external member of B  
✅ `16:52:09` …e2e49-member a member  
✅ `16:52:10` B's member list marks e2e49-ext external  
✅ `16:52:10` GET /api/domains counts B's external members  

## An authenticated and a restricted tunnel on B; a protected site listing the member

✅ `16:52:11` Tunnel e2e49a.lamaste-second.local (authenticated), carried by test-agent  
✅ `16:52:14` Tunnel e2e49r.lamaste-second.local (restricted), carried by test-agent  
✅ `16:52:14` Port 18491: the backend answers through chisel  
✅ `16:52:18` Port 18492: the backend answers through chisel  
✅ `16:52:20` Site e2e49site.lamaste-second.local, Authelia-protected  
✅ `16:52:21` …its listed users: e2e49-member  
✅ `16:52:21` B's rules name its group key  
✅ `16:52:21` …and a rule for B's external members  
✅ `16:52:21` …the site's rule names its group, never a user  
✅ `16:52:21` …no rule names a user  
✅ `16:52:21` users.yml gives e2e49-ext B's external group  
✅ `16:52:22` …never B's member group  
✅ `16:52:22` …and nothing else: no Authelia group, no host  
✅ `16:52:22` users.yml gives e2e49-member the site's group (listed)  

## Both signed in at auth.B; Authelia's MainPID from here on

✅ `16:52:24` e2e49-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:52:25` e2e49-ext signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:52:26` Authelia runs (MainPID 150203)  
✅ `16:52:26` After signing in, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `16:52:26` …from its backend  
✅ `16:52:26` …and on the site: 200  
✅ `16:52:26` …Authelia not restarted (MainPID 150203)  

## The authenticated tunnel refuses an external member

✅ `16:52:26` e2e49-ext on the authenticated tunnel: 403  
✅ `16:52:26` …the access-request page  
✅ `16:52:26` …not the domain refusal  
✅ `16:52:26` …never a redirect to a sign-in page  
✅ `16:52:26` …nothing of the tunnel  

## Authelia refuses on its own: the projection calls e2e49-ext a member

✅ `16:52:26` The projection held with e2e49-ext as a member (Gatekeeper would admit them)  
✅ `16:52:26` e2e49-ext on the authenticated tunnel: still 403 — Authelia's rules admit B's external group only on hosts named for them  
✅ `16:52:26` …nothing of the tunnel  
✅ `16:52:30` The panel's projection back: e2e49-ext: 403  
✅ `16:52:30` …the access-request page  
✅ `16:52:30` …not the domain refusal  
✅ `16:52:30` …never a redirect to a sign-in page  

## The restricted tunnel: a direct grant

✅ `16:52:30` e2e49-ext on the restricted tunnel without a grant: 403  
✅ `16:52:30` …the access-request page  
✅ `16:52:30` …not the domain refusal  
✅ `16:52:30` …never a redirect to a sign-in page  
✅ `16:52:30` Granted tunnel 5372591e-e89f-4c09-9ba8-4704d0c003e1 to user e2e49-ext  
✅ `16:52:30` users.yml gives e2e49-ext the tunnel's hostname as a group  
✅ `16:52:31` e2e49-ext, granted, on the restricted tunnel: 200 — the same session  
✅ `16:52:31` e2e49-ext on the restricted tunnel: 200  
✅ `16:52:31` …from its backend  
✅ `16:52:31` …still refused on the authenticated one: 403  
✅ `16:52:31` …the access-request page  
✅ `16:52:31` …not the domain refusal  
✅ `16:52:31` …never a redirect to a sign-in page  
✅ `16:52:31` After the grant, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `16:52:31` …from its backend  
✅ `16:52:31` …and on the site: 200  
✅ `16:52:31` …Authelia not restarted (MainPID 150203)  

## Revoked: refused again

✅ `16:52:31` The grant revoked  
✅ `16:52:31` users.yml takes the tunnel's group from e2e49-ext  
✅ `16:52:31` e2e49-ext on the restricted tunnel: 403 within 30 s  
✅ `16:52:32` …e2e49-ext, the grant revoked: 403  
✅ `16:52:32` …the access-request page  
✅ `16:52:32` …not the domain refusal  
✅ `16:52:32` …never a redirect to a sign-in page  
✅ `16:52:32` After the revocation, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `16:52:32` …from its backend  
✅ `16:52:32` …and on the site: 200  
✅ `16:52:32` …Authelia not restarted (MainPID 150203)  

## A grant to a Lamaste group

✅ `16:52:32` Lamaste group e2e49-team created  
✅ `16:52:32` …e2e49-ext its member  
✅ `16:52:32` Granted tunnel 5372591e-e89f-4c09-9ba8-4704d0c003e1 to group e2e49-team  
✅ `16:52:32` users.yml gives e2e49-ext the tunnel's group — through the Lamaste group  
✅ `16:52:33` …never the Lamaste group itself (it lives in Gatekeeper)  
✅ `16:52:36` e2e49-ext, in a granted Lamaste group, on the restricted tunnel: 200  
✅ `16:52:36` e2e49-ext leaves e2e49-team  
✅ `16:52:36` users.yml takes the tunnel's group from e2e49-ext  
✅ `16:52:36` e2e49-ext, no longer in the group: 403  
✅ `16:52:36` After the Lamaste group changes, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `16:52:36` …from its backend  
✅ `16:52:36` …and on the site: 200  
✅ `16:52:37` …Authelia not restarted (MainPID 150203)  

## The static site: only once its listed users name e2e49-ext

✅ `16:52:37` e2e49-ext on the site, not listed: 403  
✅ `16:52:37` …the refusal page names the site  
✅ `16:52:37` …nothing of the site  
✅ `16:52:37` …never a redirect to a sign-in page  
✅ `16:52:37` The site lists e2e49-member and e2e49-ext  
✅ `16:52:37` users.yml gives e2e49-ext the site's group  
✅ `16:52:37` …by the site's id, never its hostname  
✅ `16:52:40` e2e49-ext, listed, on the site: 200 — the same session  
✅ `16:52:40` …the site's page  
✅ `16:52:41` After the site's list, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `16:52:41` …from its backend  
✅ `16:52:41` …and on the site: 200  
✅ `16:52:41` …Authelia not restarted (MainPID 150203)  

## Nobody was signed out

✅ `16:52:41` Authelia's MainPID is the one of before the first change  
✅ `16:52:41` Both sessions are still signed in at auth.lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `104` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `104` |

ℹ️ `16:52:41` Cleaning up test resources...  
