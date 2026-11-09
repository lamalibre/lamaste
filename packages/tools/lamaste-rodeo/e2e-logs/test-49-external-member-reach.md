# Lamaste E2E: 49 — External members: reach only what names them (Three-VM)

> Started at `2026-11-09 13:47:19 UTC`


## Pre-flight

✅ `13:47:19` Onboarding is complete  
✅ `13:47:19` Agent test-agent is enrolled on the host  
✅ `13:47:20` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; a member and an external member of B

✅ `13:47:20` Domain lamaste-second.local added (201)  
✅ `13:47:20` …pending until activated  
✅ `13:47:20` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `13:47:20` …the one required record is auth.lamaste-second.local  
✅ `13:47:21` lamaste-second.local is active  
✅ `13:47:22` User e2e49-member created, member of lamaste-second.local  
✅ `13:47:23` User e2e49-ext created, member of lamaste-second.local (external)  
✅ `13:47:23` Both have a directory id  
✅ `13:47:23` GET /api/users: e2e49-ext is an external member of B  
✅ `13:47:23` …e2e49-member a member  
✅ `13:47:23` B's member list marks e2e49-ext external  
✅ `13:47:23` GET /api/domains counts B's external members  

## An authenticated and a restricted tunnel on B; a protected site listing the member

✅ `13:47:24` Tunnel e2e49a.lamaste-second.local (authenticated), carried by test-agent  
✅ `13:47:26` Tunnel e2e49r.lamaste-second.local (restricted), carried by test-agent  
✅ `13:47:30` Port 18491: the backend answers through chisel  
✅ `13:47:30` Port 18492: the backend answers through chisel  
✅ `13:47:32` Site e2e49site.lamaste-second.local, Authelia-protected  
✅ `13:47:32` …its listed users: e2e49-member  
✅ `13:47:32` B's rules name its group key  
✅ `13:47:33` …and a rule for B's external members  
✅ `13:47:33` …the site's rule names its group, never a user  
✅ `13:47:33` …no rule names a user  
✅ `13:47:33` users.yml gives e2e49-ext B's external group  
✅ `13:47:33` …never B's member group  
✅ `13:47:33` …and nothing else: no Authelia group, no host  
✅ `13:47:33` users.yml gives e2e49-member the site's group (listed)  

## Both signed in at auth.B; Authelia's MainPID from here on

✅ `13:47:35` e2e49-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:47:37` e2e49-ext signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:47:37` Authelia runs (MainPID 155903)  
✅ `13:47:37` After signing in, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `13:47:37` …from its backend  
✅ `13:47:37` …and on the site: 200  
✅ `13:47:37` …Authelia not restarted (MainPID 155903)  

## The authenticated tunnel refuses an external member

✅ `13:47:37` e2e49-ext on the authenticated tunnel: 403  
✅ `13:47:37` …the access-request page  
✅ `13:47:37` …not the domain refusal  
✅ `13:47:37` …never a redirect to a sign-in page  
✅ `13:47:37` …nothing of the tunnel  

## Authelia refuses on its own: the projection calls e2e49-ext a member

✅ `13:47:37` The projection held with e2e49-ext as a member (Gatekeeper would admit them)  
✅ `13:47:38` e2e49-ext on the authenticated tunnel: still 403 — Authelia's rules admit B's external group only on hosts named for them  
✅ `13:47:38` …nothing of the tunnel  
✅ `13:47:41` The panel's projection back: e2e49-ext: 403  
✅ `13:47:41` …the access-request page  
✅ `13:47:41` …not the domain refusal  
✅ `13:47:41` …never a redirect to a sign-in page  

## The restricted tunnel: a direct grant

✅ `13:47:41` e2e49-ext on the restricted tunnel without a grant: 403  
✅ `13:47:41` …the access-request page  
✅ `13:47:41` …not the domain refusal  
✅ `13:47:41` …never a redirect to a sign-in page  
✅ `13:47:41` Granted tunnel ce85ebc6-5943-4bbf-b847-84fcdf56440f to user e2e49-ext  
✅ `13:47:41` users.yml gives e2e49-ext the tunnel's hostname as a group  
✅ `13:47:41` e2e49-ext, granted, on the restricted tunnel: 200 — the same session  
✅ `13:47:42` e2e49-ext on the restricted tunnel: 200  
✅ `13:47:42` …from its backend  
✅ `13:47:42` …still refused on the authenticated one: 403  
✅ `13:47:42` …the access-request page  
✅ `13:47:42` …not the domain refusal  
✅ `13:47:42` …never a redirect to a sign-in page  
✅ `13:47:42` After the grant, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `13:47:42` …from its backend  
✅ `13:47:42` …and on the site: 200  
✅ `13:47:42` …Authelia not restarted (MainPID 155903)  

## Revoked: refused again

✅ `13:47:42` The grant revoked  
✅ `13:47:42` users.yml takes the tunnel's group from e2e49-ext  
✅ `13:47:42` e2e49-ext on the restricted tunnel: 403 within 30 s  
✅ `13:47:43` …e2e49-ext, the grant revoked: 403  
✅ `13:47:43` …the access-request page  
✅ `13:47:43` …not the domain refusal  
✅ `13:47:43` …never a redirect to a sign-in page  
✅ `13:47:43` After the revocation, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `13:47:43` …from its backend  
✅ `13:47:43` …and on the site: 200  
✅ `13:47:43` …Authelia not restarted (MainPID 155903)  

## A grant to a Lamaste group

✅ `13:47:43` Lamaste group e2e49-team created  
✅ `13:47:43` …e2e49-ext its member  
✅ `13:47:43` Granted tunnel ce85ebc6-5943-4bbf-b847-84fcdf56440f to group e2e49-team  
✅ `13:47:43` users.yml gives e2e49-ext the tunnel's group — through the Lamaste group  
✅ `13:47:44` …never the Lamaste group itself (it lives in Gatekeeper)  
✅ `13:47:47` e2e49-ext, in a granted Lamaste group, on the restricted tunnel: 200  
✅ `13:47:47` e2e49-ext leaves e2e49-team  
✅ `13:47:47` users.yml takes the tunnel's group from e2e49-ext  
✅ `13:47:47` e2e49-ext, no longer in the group: 403  
✅ `13:47:47` After the Lamaste group changes, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `13:47:47` …from its backend  
✅ `13:47:47` …and on the site: 200  
✅ `13:47:47` …Authelia not restarted (MainPID 155903)  

## The static site: only once its listed users name e2e49-ext

✅ `13:47:48` e2e49-ext on the site, not listed: 403  
✅ `13:47:48` …the refusal page names the site  
✅ `13:47:48` …nothing of the site  
✅ `13:47:48` …never a redirect to a sign-in page  
✅ `13:47:48` The site lists e2e49-member and e2e49-ext  
✅ `13:47:48` users.yml gives e2e49-ext the site's group  
✅ `13:47:48` …by the site's id, never its hostname  
✅ `13:47:51` e2e49-ext, listed, on the site: 200 — the same session  
✅ `13:47:51` …the site's page  
✅ `13:47:51` After the site's list, e2e49-member's session of before on the authenticated tunnel: 200  
✅ `13:47:51` …from its backend  
✅ `13:47:52` …and on the site: 200  
✅ `13:47:52` …Authelia not restarted (MainPID 155903)  

## Nobody was signed out

✅ `13:47:52` Authelia's MainPID is the one of before the first change  
✅ `13:47:52` Both sessions are still signed in at auth.lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `104` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `104` |

ℹ️ `13:47:52` Cleaning up test resources...  
