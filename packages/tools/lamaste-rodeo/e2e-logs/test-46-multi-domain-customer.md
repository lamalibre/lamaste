# Lamaste E2E: 46 — Multi-domain relay: a customer on one domain (Three-VM)

> Started at `2026-11-10 18:48:41 UTC`


## Pre-flight

✅ `18:48:41` Onboarding is complete  
✅ `18:48:41` Agent test-agent is enrolled on the host  
✅ `18:48:41` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; two customers, members of B only

✅ `18:48:42` Domain lamaste-second.local added (201)  
✅ `18:48:42` …pending until activated  
✅ `18:48:42` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `18:48:42` …the one required record is auth.lamaste-second.local  
✅ `18:48:43` lamaste-second.local is active  
✅ `18:48:44` User e2e46-cust created, member of lamaste-second.local  
✅ `18:48:45` User e2e46-cust2 created, member of lamaste-second.local  
✅ `18:48:45` Both have a directory id  
✅ `18:48:45` e2e46-cust is a member of B alone  
✅ `18:48:45` A's member list does not hold e2e46-cust  
✅ `18:48:45` B's does  
✅ `18:48:46` A's rendered rules name no user  
✅ `18:48:46` users.yml gives e2e46-cust B's member group  
✅ `18:48:46` …never A's  

## An authenticated tunnel on A and on B; an Authelia-protected site on A

✅ `18:48:48` Tunnel e2e46a.test.lamaste.local (authenticated), carried by test-agent  
✅ `18:48:50` Tunnel e2e46b.lamaste-second.local (authenticated), carried by test-agent  
✅ `18:48:55` Port 18461: the backend answers through chisel  
✅ `18:48:55` Port 18462: the backend answers through chisel  
✅ `18:48:57` Site e2e46site.test.lamaste.local, Authelia-protected  

## Signed in at auth.B: B's tunnel

✅ `18:48:59` e2e46-cust signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:49:01` e2e46-cust2 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:49:02` e2e46-cust on B's tunnel: 200  
✅ `18:49:02` …from its backend  
✅ `18:49:02` e2e46-cust2 on B's tunnel: 200  

## Signed in at auth.A with the same account: A refuses with a page

✅ `18:49:02` A's tunnel without a session: to A's sign-in page  
✅ `18:49:33` e2e46-cust signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:49:33` e2e46-cust on A's authenticated tunnel: 403  
✅ `18:49:33` …the domain refusal page  
✅ `18:49:33` …naming test.lamaste.local  
✅ `18:49:33` …never a redirect to a sign-in page (no login loop)  
✅ `18:49:33` …nothing of the tunnel  
✅ `18:49:33` …and the page names no user  
✅ `18:49:33` e2e46-cust on A's Authelia-protected site: 403  
✅ `18:49:33` …the refusal page names the site  
✅ `18:49:33` …and A  
✅ `18:49:33` …nothing of the site  
✅ `18:49:33` …never a redirect to a sign-in page  

## Gatekeeper's own check: its projection, not only Authelia

✅ `18:49:34` The projection held without e2e46-cust (Authelia's rules unchanged)  
✅ `18:49:34` …Authelia still admits e2e46-cust on B (B's member group in users.yml)  
✅ `18:49:34` e2e46-cust on B's tunnel: 403 — Gatekeeper refuses a user its projection holds no member of B  
✅ `18:49:34` …with the domain refusal page  
✅ `18:49:34` e2e46-cust2, still in the projection: 200  
✅ `18:49:38` No projection: e2e46-cust2 refused too (403) — Gatekeeper fails closed  
✅ `18:49:38` The panel's projection back: e2e46-cust let through again  

## A customer removed from B is refused there

✅ `18:49:38` e2e46-cust2 removed from B (by username)  
✅ `18:49:39` …the directory lists no domain for e2e46-cust2  
✅ `18:49:39` …nor does B's member list  
✅ `18:49:39` Audited: directory.membership.removed for B, by e2e46-cust2's directory id  
✅ `18:49:39` users.yml takes B's member group from e2e46-cust2  
✅ `18:49:39` …Authelia was not restarted (MainPID 140012)  
✅ `18:49:39` e2e46-cust2's session of before, on B's tunnel: refused (403) — no new sign-in  
✅ `18:49:40` e2e46-cust2, removed from B, on B's tunnel: 403  
✅ `18:49:40` …the domain refusal page  
✅ `18:49:40` …naming lamaste-second.local  
✅ `18:49:40` …never a redirect to a sign-in page (no login loop)  
✅ `18:49:40` …nothing of the tunnel  

## A customer deleted loses every membership, audited by id

✅ `18:49:40` e2e46-cust deleted  
✅ `18:49:40` Audited: directory.membership.removed for B, reason deleted, by directory id  
✅ `18:49:40` …no audit entry names the username  
✅ `18:49:40` B's member list holds e2e46-cust no more  
✅ `18:49:41` …nor does users.yml give anyone of that name a group  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `64` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `64` |

ℹ️ `18:49:41` Cleaning up test resources...  
