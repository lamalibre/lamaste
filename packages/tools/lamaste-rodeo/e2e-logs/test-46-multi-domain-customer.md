# Lamaste E2E: 46 — Multi-domain relay: a customer on one domain (Three-VM)

> Started at `2026-10-25 18:04:17 UTC`


## Pre-flight

✅ `18:04:18` Onboarding is complete  
✅ `18:04:18` Agent test-agent is enrolled on the host  
✅ `18:04:18` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; two customers, members of B only

✅ `18:04:19` Domain lamaste-second.local added (201)  
✅ `18:04:19` …pending until activated  
✅ `18:04:19` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `18:04:19` …the one required record is auth.lamaste-second.local  
✅ `18:04:20` lamaste-second.local is active  
✅ `18:04:22` User e2e46-cust created, member of lamaste-second.local  
✅ `18:04:24` User e2e46-cust2 created, member of lamaste-second.local  
✅ `18:04:24` Both have a directory id  
✅ `18:04:24` e2e46-cust is a member of B alone  
✅ `18:04:24` A's member list does not hold e2e46-cust  
✅ `18:04:24` B's does  
✅ `18:04:24` A's rendered rules never name e2e46-cust  

## An authenticated tunnel on A and on B; an Authelia-protected site on A

✅ `18:04:25` Tunnel e2e46a.test.lamaste.local (authenticated), carried by test-agent  
✅ `18:04:27` Tunnel e2e46b.lamaste-second.local (authenticated), carried by test-agent  
✅ `18:04:31` Port 18461: the backend answers through chisel  
✅ `18:04:31` Port 18462: the backend answers through chisel  
✅ `18:04:32` Site e2e46site.test.lamaste.local, Authelia-protected  

## Signed in at auth.B: B's tunnel

✅ `18:04:34` e2e46-cust signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:04:36` e2e46-cust2 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:04:36` e2e46-cust on B's tunnel: 200  
✅ `18:04:36` …from its backend  
✅ `18:04:36` e2e46-cust2 on B's tunnel: 200  

## Signed in at auth.A with the same account: A refuses with a page

✅ `18:04:36` A's tunnel without a session: to A's sign-in page  
✅ `18:05:03` e2e46-cust signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:05:03` e2e46-cust on A's authenticated tunnel: 403  
✅ `18:05:03` …the domain refusal page  
✅ `18:05:03` …naming test.lamaste.local  
✅ `18:05:03` …never a redirect to a sign-in page (no login loop)  
✅ `18:05:03` …nothing of the tunnel  
✅ `18:05:03` …and the page names no user  
✅ `18:05:03` e2e46-cust on A's Authelia-protected site: 403  
✅ `18:05:03` …the refusal page names the site  
✅ `18:05:03` …and A  
✅ `18:05:03` …nothing of the site  
✅ `18:05:03` …never a redirect to a sign-in page  

## Gatekeeper's own check: its projection, not only Authelia

✅ `18:05:03` The projection held without e2e46-cust (Authelia's rules unchanged)  
✅ `18:05:03` …Authelia still admits e2e46-cust on B  
✅ `18:05:04` e2e46-cust on B's tunnel: 403 — Gatekeeper refuses a user its projection holds no member of B  
✅ `18:05:04` …with the domain refusal page  
✅ `18:05:04` e2e46-cust2, still in the projection: 200  
✅ `18:05:07` No projection: e2e46-cust2 refused too (403) — Gatekeeper fails closed  
✅ `18:05:11` The panel's projection back: e2e46-cust let through again  

## A customer removed from B is refused there

✅ `18:05:12` e2e46-cust2 removed from B (by username)  
✅ `18:05:12` …the directory lists no domain for e2e46-cust2  
✅ `18:05:12` …nor does B's member list  
✅ `18:05:12` Audited: directory.membership.removed for B, by e2e46-cust2's directory id  
✅ `18:05:14` e2e46-cust2 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:05:14` e2e46-cust2, signed in at auth.B again, on B's tunnel: 403  
✅ `18:05:14` …the domain refusal page  
✅ `18:05:14` …naming lamaste-second.local  
✅ `18:05:14` …never a redirect to a sign-in page (no login loop)  
✅ `18:05:14` …nothing of the tunnel  

## A customer deleted loses every membership, audited by id

✅ `18:05:15` e2e46-cust deleted  
✅ `18:05:15` Audited: directory.membership.removed for B, reason deleted, by directory id  
✅ `18:05:15` …no audit entry names the username  
✅ `18:05:15` B's member list holds e2e46-cust no more  
✅ `18:05:16` …nor do B's rendered rules  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `60` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `60` |

ℹ️ `18:05:16` Cleaning up test resources...  
