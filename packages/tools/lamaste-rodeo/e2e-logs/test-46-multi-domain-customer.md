# Lamaste E2E: 46 — Multi-domain relay: a customer on one domain (Three-VM)

> Started at `2026-11-02 16:45:36 UTC`


## Pre-flight

✅ `16:45:36` Onboarding is complete  
✅ `16:45:36` Agent test-agent is enrolled on the host  
✅ `16:45:36` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; two customers, members of B only

✅ `16:45:37` Domain lamaste-second.local added (201)  
✅ `16:45:37` …pending until activated  
✅ `16:45:37` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `16:45:37` …the one required record is auth.lamaste-second.local  
✅ `16:45:39` lamaste-second.local is active  
✅ `16:45:39` User e2e46-cust created, member of lamaste-second.local  
✅ `16:45:40` User e2e46-cust2 created, member of lamaste-second.local  
✅ `16:45:40` Both have a directory id  
✅ `16:45:40` e2e46-cust is a member of B alone  
✅ `16:45:40` A's member list does not hold e2e46-cust  
✅ `16:45:40` B's does  
✅ `16:45:41` A's rendered rules name no user  
✅ `16:45:41` users.yml gives e2e46-cust B's member group  
✅ `16:45:41` …never A's  

## An authenticated tunnel on A and on B; an Authelia-protected site on A

✅ `16:45:42` Tunnel e2e46a.test.lamaste.local (authenticated), carried by test-agent  
✅ `16:45:44` Tunnel e2e46b.lamaste-second.local (authenticated), carried by test-agent  
✅ `16:45:48` Port 18461: the backend answers through chisel  
✅ `16:45:48` Port 18462: the backend answers through chisel  
✅ `16:45:49` Site e2e46site.test.lamaste.local, Authelia-protected  

## Signed in at auth.B: B's tunnel

✅ `16:45:52` e2e46-cust signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:45:53` e2e46-cust2 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:45:54` e2e46-cust on B's tunnel: 200  
✅ `16:45:54` …from its backend  
✅ `16:45:54` e2e46-cust2 on B's tunnel: 200  

## Signed in at auth.A with the same account: A refuses with a page

✅ `16:45:54` A's tunnel without a session: to A's sign-in page  
✅ `16:46:02` e2e46-cust signed in at auth.test.lamaste.local (password, TOTP)  
✅ `16:46:03` e2e46-cust on A's authenticated tunnel: 403  
✅ `16:46:03` …the domain refusal page  
✅ `16:46:03` …naming test.lamaste.local  
✅ `16:46:03` …never a redirect to a sign-in page (no login loop)  
✅ `16:46:03` …nothing of the tunnel  
✅ `16:46:03` …and the page names no user  
✅ `16:46:03` e2e46-cust on A's Authelia-protected site: 403  
✅ `16:46:03` …the refusal page names the site  
✅ `16:46:03` …and A  
✅ `16:46:03` …nothing of the site  
✅ `16:46:03` …never a redirect to a sign-in page  

## Gatekeeper's own check: its projection, not only Authelia

✅ `16:46:03` The projection held without e2e46-cust (Authelia's rules unchanged)  
✅ `16:46:03` …Authelia still admits e2e46-cust on B (B's member group in users.yml)  
✅ `16:46:04` e2e46-cust on B's tunnel: 403 — Gatekeeper refuses a user its projection holds no member of B  
✅ `16:46:04` …with the domain refusal page  
✅ `16:46:04` e2e46-cust2, still in the projection: 200  
✅ `16:46:08` No projection: e2e46-cust2 refused too (403) — Gatekeeper fails closed  
✅ `16:46:11` The panel's projection back: e2e46-cust let through again  

## A customer removed from B is refused there

✅ `16:46:11` e2e46-cust2 removed from B (by username)  
✅ `16:46:12` …the directory lists no domain for e2e46-cust2  
✅ `16:46:12` …nor does B's member list  
✅ `16:46:12` Audited: directory.membership.removed for B, by e2e46-cust2's directory id  
✅ `16:46:12` users.yml takes B's member group from e2e46-cust2  
✅ `16:46:12` …Authelia was not restarted (MainPID 131011)  
✅ `16:46:12` e2e46-cust2's session of before, on B's tunnel: refused (403) — no new sign-in  
✅ `16:46:12` e2e46-cust2, removed from B, on B's tunnel: 403  
✅ `16:46:12` …the domain refusal page  
✅ `16:46:12` …naming lamaste-second.local  
✅ `16:46:12` …never a redirect to a sign-in page (no login loop)  
✅ `16:46:12` …nothing of the tunnel  

## A customer deleted loses every membership, audited by id

✅ `16:46:12` e2e46-cust deleted  
✅ `16:46:13` Audited: directory.membership.removed for B, reason deleted, by directory id  
✅ `16:46:13` …no audit entry names the username  
✅ `16:46:13` B's member list holds e2e46-cust no more  
✅ `16:46:13` …nor does users.yml give anyone of that name a group  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `64` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `64` |

ℹ️ `16:46:13` Cleaning up test resources...  
