# Lamaste E2E: 46 — Multi-domain relay: a customer on one domain (Three-VM)

> Started at `2026-11-04 14:32:38 UTC`


## Pre-flight

✅ `14:32:38` Onboarding is complete  
✅ `14:32:38` Agent test-agent is enrolled on the host  
✅ `14:32:38` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; two customers, members of B only

✅ `14:32:39` Domain lamaste-second.local added (201)  
✅ `14:32:39` …pending until activated  
✅ `14:32:39` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:32:39` …the one required record is auth.lamaste-second.local  
✅ `14:32:40` lamaste-second.local is active  
✅ `14:32:41` User e2e46-cust created, member of lamaste-second.local  
✅ `14:32:42` User e2e46-cust2 created, member of lamaste-second.local  
✅ `14:32:42` Both have a directory id  
✅ `14:32:42` e2e46-cust is a member of B alone  
✅ `14:32:42` A's member list does not hold e2e46-cust  
✅ `14:32:42` B's does  
✅ `14:32:43` A's rendered rules name no user  
✅ `14:32:43` users.yml gives e2e46-cust B's member group  
✅ `14:32:43` …never A's  

## An authenticated tunnel on A and on B; an Authelia-protected site on A

✅ `14:32:45` Tunnel e2e46a.test.lamaste.local (authenticated), carried by test-agent  
✅ `14:32:47` Tunnel e2e46b.lamaste-second.local (authenticated), carried by test-agent  
✅ `14:32:51` Port 18461: the backend answers through chisel  
✅ `14:32:51` Port 18462: the backend answers through chisel  
✅ `14:32:53` Site e2e46site.test.lamaste.local, Authelia-protected  

## Signed in at auth.B: B's tunnel

✅ `14:32:55` e2e46-cust signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:32:57` e2e46-cust2 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:32:57` e2e46-cust on B's tunnel: 200  
✅ `14:32:57` …from its backend  
✅ `14:32:57` e2e46-cust2 on B's tunnel: 200  

## Signed in at auth.A with the same account: A refuses with a page

✅ `14:32:57` A's tunnel without a session: to A's sign-in page  
✅ `14:33:02` e2e46-cust signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:33:02` e2e46-cust on A's authenticated tunnel: 403  
✅ `14:33:02` …the domain refusal page  
✅ `14:33:02` …naming test.lamaste.local  
✅ `14:33:02` …never a redirect to a sign-in page (no login loop)  
✅ `14:33:02` …nothing of the tunnel  
✅ `14:33:02` …and the page names no user  
✅ `14:33:02` e2e46-cust on A's Authelia-protected site: 403  
✅ `14:33:02` …the refusal page names the site  
✅ `14:33:02` …and A  
✅ `14:33:02` …nothing of the site  
✅ `14:33:02` …never a redirect to a sign-in page  

## Gatekeeper's own check: its projection, not only Authelia

✅ `14:33:03` The projection held without e2e46-cust (Authelia's rules unchanged)  
✅ `14:33:03` …Authelia still admits e2e46-cust on B (B's member group in users.yml)  
✅ `14:33:03` e2e46-cust on B's tunnel: 403 — Gatekeeper refuses a user its projection holds no member of B  
✅ `14:33:03` …with the domain refusal page  
✅ `14:33:03` e2e46-cust2, still in the projection: 200  
✅ `14:33:07` No projection: e2e46-cust2 refused too (403) — Gatekeeper fails closed  
✅ `14:33:11` The panel's projection back: e2e46-cust let through again  

## A customer removed from B is refused there

✅ `14:33:11` e2e46-cust2 removed from B (by username)  
✅ `14:33:11` …the directory lists no domain for e2e46-cust2  
✅ `14:33:11` …nor does B's member list  
✅ `14:33:11` Audited: directory.membership.removed for B, by e2e46-cust2's directory id  
✅ `14:33:12` users.yml takes B's member group from e2e46-cust2  
✅ `14:33:12` …Authelia was not restarted (MainPID 129646)  
✅ `14:33:12` e2e46-cust2's session of before, on B's tunnel: refused (403) — no new sign-in  
✅ `14:33:12` e2e46-cust2, removed from B, on B's tunnel: 403  
✅ `14:33:12` …the domain refusal page  
✅ `14:33:12` …naming lamaste-second.local  
✅ `14:33:12` …never a redirect to a sign-in page (no login loop)  
✅ `14:33:12` …nothing of the tunnel  

## A customer deleted loses every membership, audited by id

✅ `14:33:12` e2e46-cust deleted  
✅ `14:33:12` Audited: directory.membership.removed for B, reason deleted, by directory id  
✅ `14:33:12` …no audit entry names the username  
✅ `14:33:12` B's member list holds e2e46-cust no more  
✅ `14:33:13` …nor does users.yml give anyone of that name a group  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `64` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `64` |

ℹ️ `14:33:13` Cleaning up test resources...  
