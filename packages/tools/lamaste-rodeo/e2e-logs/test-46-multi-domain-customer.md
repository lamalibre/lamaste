# Lamaste E2E: 46 — Multi-domain relay: a customer on one domain (Three-VM)

> Started at `2026-11-10 14:06:07 UTC`


## Pre-flight

✅ `14:06:07` Onboarding is complete  
✅ `14:06:08` Agent test-agent is enrolled on the host  
✅ `14:06:08` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; two customers, members of B only

✅ `14:06:08` Domain lamaste-second.local added (201)  
✅ `14:06:08` …pending until activated  
✅ `14:06:09` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:06:09` …the one required record is auth.lamaste-second.local  
✅ `14:06:10` lamaste-second.local is active  
✅ `14:06:11` User e2e46-cust created, member of lamaste-second.local  
✅ `14:06:12` User e2e46-cust2 created, member of lamaste-second.local  
✅ `14:06:12` Both have a directory id  
✅ `14:06:12` e2e46-cust is a member of B alone  
✅ `14:06:12` A's member list does not hold e2e46-cust  
✅ `14:06:12` B's does  
✅ `14:06:13` A's rendered rules name no user  
✅ `14:06:13` users.yml gives e2e46-cust B's member group  
✅ `14:06:13` …never A's  

## An authenticated tunnel on A and on B; an Authelia-protected site on A

✅ `14:06:15` Tunnel e2e46a.test.lamaste.local (authenticated), carried by test-agent  
✅ `14:06:17` Tunnel e2e46b.lamaste-second.local (authenticated), carried by test-agent  
✅ `14:06:22` Port 18461: the backend answers through chisel  
✅ `14:06:22` Port 18462: the backend answers through chisel  
✅ `14:06:24` Site e2e46site.test.lamaste.local, Authelia-protected  

## Signed in at auth.B: B's tunnel

✅ `14:06:27` e2e46-cust signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:06:28` e2e46-cust2 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:06:29` e2e46-cust on B's tunnel: 200  
✅ `14:06:29` …from its backend  
✅ `14:06:29` e2e46-cust2 on B's tunnel: 200  

## Signed in at auth.A with the same account: A refuses with a page

✅ `14:06:29` A's tunnel without a session: to A's sign-in page  
✅ `14:06:33` e2e46-cust signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:06:33` e2e46-cust on A's authenticated tunnel: 403  
✅ `14:06:33` …the domain refusal page  
✅ `14:06:33` …naming test.lamaste.local  
✅ `14:06:33` …never a redirect to a sign-in page (no login loop)  
✅ `14:06:33` …nothing of the tunnel  
✅ `14:06:33` …and the page names no user  
✅ `14:06:34` e2e46-cust on A's Authelia-protected site: 403  
✅ `14:06:34` …the refusal page names the site  
✅ `14:06:34` …and A  
✅ `14:06:34` …nothing of the site  
✅ `14:06:34` …never a redirect to a sign-in page  

## Gatekeeper's own check: its projection, not only Authelia

✅ `14:06:34` The projection held without e2e46-cust (Authelia's rules unchanged)  
✅ `14:06:34` …Authelia still admits e2e46-cust on B (B's member group in users.yml)  
✅ `14:06:34` e2e46-cust on B's tunnel: 403 — Gatekeeper refuses a user its projection holds no member of B  
✅ `14:06:34` …with the domain refusal page  
✅ `14:06:34` e2e46-cust2, still in the projection: 200  
✅ `14:06:38` No projection: e2e46-cust2 refused too (403) — Gatekeeper fails closed  
✅ `14:06:42` The panel's projection back: e2e46-cust let through again  

## A customer removed from B is refused there

✅ `14:06:42` e2e46-cust2 removed from B (by username)  
✅ `14:06:42` …the directory lists no domain for e2e46-cust2  
✅ `14:06:43` …nor does B's member list  
✅ `14:06:43` Audited: directory.membership.removed for B, by e2e46-cust2's directory id  
✅ `14:06:43` users.yml takes B's member group from e2e46-cust2  
✅ `14:06:43` …Authelia was not restarted (MainPID 135956)  
✅ `14:06:43` e2e46-cust2's session of before, on B's tunnel: refused (403) — no new sign-in  
✅ `14:06:43` e2e46-cust2, removed from B, on B's tunnel: 403  
✅ `14:06:43` …the domain refusal page  
✅ `14:06:43` …naming lamaste-second.local  
✅ `14:06:43` …never a redirect to a sign-in page (no login loop)  
✅ `14:06:43` …nothing of the tunnel  

## A customer deleted loses every membership, audited by id

✅ `14:06:44` e2e46-cust deleted  
✅ `14:06:44` Audited: directory.membership.removed for B, reason deleted, by directory id  
✅ `14:06:44` …no audit entry names the username  
✅ `14:06:44` B's member list holds e2e46-cust no more  
✅ `14:06:44` …nor does users.yml give anyone of that name a group  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `64` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `64` |

ℹ️ `14:06:44` Cleaning up test resources...  
