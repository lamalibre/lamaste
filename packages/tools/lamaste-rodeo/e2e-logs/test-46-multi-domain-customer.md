# Lamaste E2E: 46 — Multi-domain relay: a customer on one domain (Three-VM)

> Started at `2026-11-09 13:40:36 UTC`


## Pre-flight

✅ `13:40:36` Onboarding is complete  
✅ `13:40:36` Agent test-agent is enrolled on the host  
✅ `13:40:37` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; two customers, members of B only

✅ `13:40:37` Domain lamaste-second.local added (201)  
✅ `13:40:37` …pending until activated  
✅ `13:40:37` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `13:40:37` …the one required record is auth.lamaste-second.local  
✅ `13:40:38` lamaste-second.local is active  
✅ `13:40:39` User e2e46-cust created, member of lamaste-second.local  
✅ `13:40:40` User e2e46-cust2 created, member of lamaste-second.local  
✅ `13:40:40` Both have a directory id  
✅ `13:40:40` e2e46-cust is a member of B alone  
✅ `13:40:40` A's member list does not hold e2e46-cust  
✅ `13:40:40` B's does  
✅ `13:40:40` A's rendered rules name no user  
✅ `13:40:40` users.yml gives e2e46-cust B's member group  
✅ `13:40:40` …never A's  

## An authenticated tunnel on A and on B; an Authelia-protected site on A

✅ `13:40:42` Tunnel e2e46a.test.lamaste.local (authenticated), carried by test-agent  
✅ `13:40:43` Tunnel e2e46b.lamaste-second.local (authenticated), carried by test-agent  
✅ `13:40:47` Port 18461: the backend answers through chisel  
✅ `13:40:47` Port 18462: the backend answers through chisel  
✅ `13:40:49` Site e2e46site.test.lamaste.local, Authelia-protected  

## Signed in at auth.B: B's tunnel

✅ `13:40:51` e2e46-cust signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:40:52` e2e46-cust2 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:40:52` e2e46-cust on B's tunnel: 200  
✅ `13:40:53` …from its backend  
✅ `13:40:53` e2e46-cust2 on B's tunnel: 200  

## Signed in at auth.A with the same account: A refuses with a page

✅ `13:40:53` A's tunnel without a session: to A's sign-in page  
✅ `13:41:02` e2e46-cust signed in at auth.test.lamaste.local (password, TOTP)  
✅ `13:41:03` e2e46-cust on A's authenticated tunnel: 403  
✅ `13:41:03` …the domain refusal page  
✅ `13:41:03` …naming test.lamaste.local  
✅ `13:41:03` …never a redirect to a sign-in page (no login loop)  
✅ `13:41:03` …nothing of the tunnel  
✅ `13:41:03` …and the page names no user  
✅ `13:41:03` e2e46-cust on A's Authelia-protected site: 403  
✅ `13:41:03` …the refusal page names the site  
✅ `13:41:03` …and A  
✅ `13:41:03` …nothing of the site  
✅ `13:41:03` …never a redirect to a sign-in page  

## Gatekeeper's own check: its projection, not only Authelia

✅ `13:41:03` The projection held without e2e46-cust (Authelia's rules unchanged)  
✅ `13:41:03` …Authelia still admits e2e46-cust on B (B's member group in users.yml)  
✅ `13:41:03` e2e46-cust on B's tunnel: 403 — Gatekeeper refuses a user its projection holds no member of B  
✅ `13:41:03` …with the domain refusal page  
✅ `13:41:03` e2e46-cust2, still in the projection: 200  
✅ `13:41:07` No projection: e2e46-cust2 refused too (403) — Gatekeeper fails closed  
✅ `13:41:10` The panel's projection back: e2e46-cust let through again  

## A customer removed from B is refused there

✅ `13:41:11` e2e46-cust2 removed from B (by username)  
✅ `13:41:11` …the directory lists no domain for e2e46-cust2  
✅ `13:41:11` …nor does B's member list  
✅ `13:41:11` Audited: directory.membership.removed for B, by e2e46-cust2's directory id  
✅ `13:41:11` users.yml takes B's member group from e2e46-cust2  
✅ `13:41:11` …Authelia was not restarted (MainPID 136311)  
✅ `13:41:11` e2e46-cust2's session of before, on B's tunnel: refused (403) — no new sign-in  
✅ `13:41:11` e2e46-cust2, removed from B, on B's tunnel: 403  
✅ `13:41:11` …the domain refusal page  
✅ `13:41:11` …naming lamaste-second.local  
✅ `13:41:11` …never a redirect to a sign-in page (no login loop)  
✅ `13:41:11` …nothing of the tunnel  

## A customer deleted loses every membership, audited by id

✅ `13:41:12` e2e46-cust deleted  
✅ `13:41:12` Audited: directory.membership.removed for B, reason deleted, by directory id  
✅ `13:41:12` …no audit entry names the username  
✅ `13:41:12` B's member list holds e2e46-cust no more  
✅ `13:41:12` …nor does users.yml give anyone of that name a group  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `64` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `64` |

ℹ️ `13:41:12` Cleaning up test resources...  
