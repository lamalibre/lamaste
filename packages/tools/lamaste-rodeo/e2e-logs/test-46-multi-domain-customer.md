# Lamaste E2E: 46 — Multi-domain relay: a customer on one domain (Three-VM)

> Started at `2026-11-03 10:29:05 UTC`


## Pre-flight

✅ `10:29:05` Onboarding is complete  
✅ `10:29:06` Agent test-agent is enrolled on the host  
✅ `10:29:06` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; two customers, members of B only

✅ `10:29:06` Domain lamaste-second.local added (201)  
✅ `10:29:06` …pending until activated  
✅ `10:29:07` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `10:29:07` …the one required record is auth.lamaste-second.local  
✅ `10:29:08` lamaste-second.local is active  
✅ `10:29:08` User e2e46-cust created, member of lamaste-second.local  
✅ `10:29:09` User e2e46-cust2 created, member of lamaste-second.local  
✅ `10:29:09` Both have a directory id  
✅ `10:29:09` e2e46-cust is a member of B alone  
✅ `10:29:09` A's member list does not hold e2e46-cust  
✅ `10:29:09` B's does  
✅ `10:29:10` A's rendered rules name no user  
✅ `10:29:10` users.yml gives e2e46-cust B's member group  
✅ `10:29:10` …never A's  

## An authenticated tunnel on A and on B; an Authelia-protected site on A

✅ `10:29:11` Tunnel e2e46a.test.lamaste.local (authenticated), carried by test-agent  
✅ `10:29:13` Tunnel e2e46b.lamaste-second.local (authenticated), carried by test-agent  
✅ `10:29:17` Port 18461: the backend answers through chisel  
✅ `10:29:17` Port 18462: the backend answers through chisel  
✅ `10:29:18` Site e2e46site.test.lamaste.local, Authelia-protected  

## Signed in at auth.B: B's tunnel

✅ `10:29:21` e2e46-cust signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:29:22` e2e46-cust2 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:29:22` e2e46-cust on B's tunnel: 200  
✅ `10:29:23` …from its backend  
✅ `10:29:23` e2e46-cust2 on B's tunnel: 200  

## Signed in at auth.A with the same account: A refuses with a page

✅ `10:29:23` A's tunnel without a session: to A's sign-in page  
✅ `10:29:32` e2e46-cust signed in at auth.test.lamaste.local (password, TOTP)  
✅ `10:29:33` e2e46-cust on A's authenticated tunnel: 403  
✅ `10:29:33` …the domain refusal page  
✅ `10:29:33` …naming test.lamaste.local  
✅ `10:29:33` …never a redirect to a sign-in page (no login loop)  
✅ `10:29:33` …nothing of the tunnel  
✅ `10:29:33` …and the page names no user  
✅ `10:29:33` e2e46-cust on A's Authelia-protected site: 403  
✅ `10:29:33` …the refusal page names the site  
✅ `10:29:33` …and A  
✅ `10:29:33` …nothing of the site  
✅ `10:29:33` …never a redirect to a sign-in page  

## Gatekeeper's own check: its projection, not only Authelia

✅ `10:29:33` The projection held without e2e46-cust (Authelia's rules unchanged)  
✅ `10:29:33` …Authelia still admits e2e46-cust on B (B's member group in users.yml)  
✅ `10:29:33` e2e46-cust on B's tunnel: 403 — Gatekeeper refuses a user its projection holds no member of B  
✅ `10:29:33` …with the domain refusal page  
✅ `10:29:33` e2e46-cust2, still in the projection: 200  
✅ `10:29:37` No projection: e2e46-cust2 refused too (403) — Gatekeeper fails closed  
✅ `10:29:41` The panel's projection back: e2e46-cust let through again  

## A customer removed from B is refused there

✅ `10:29:41` e2e46-cust2 removed from B (by username)  
✅ `10:29:41` …the directory lists no domain for e2e46-cust2  
✅ `10:29:41` …nor does B's member list  
✅ `10:29:41` Audited: directory.membership.removed for B, by e2e46-cust2's directory id  
✅ `10:29:41` users.yml takes B's member group from e2e46-cust2  
✅ `10:29:42` …Authelia was not restarted (MainPID 135758)  
✅ `10:29:42` e2e46-cust2's session of before, on B's tunnel: refused (403) — no new sign-in  
✅ `10:29:42` e2e46-cust2, removed from B, on B's tunnel: 403  
✅ `10:29:42` …the domain refusal page  
✅ `10:29:42` …naming lamaste-second.local  
✅ `10:29:42` …never a redirect to a sign-in page (no login loop)  
✅ `10:29:42` …nothing of the tunnel  

## A customer deleted loses every membership, audited by id

✅ `10:29:42` e2e46-cust deleted  
✅ `10:29:42` Audited: directory.membership.removed for B, reason deleted, by directory id  
✅ `10:29:42` …no audit entry names the username  
✅ `10:29:42` B's member list holds e2e46-cust no more  
✅ `10:29:42` …nor does users.yml give anyone of that name a group  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `64` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `64` |

ℹ️ `10:29:42` Cleaning up test resources...  
