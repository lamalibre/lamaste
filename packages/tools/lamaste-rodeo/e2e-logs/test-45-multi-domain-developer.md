# Lamaste E2E: 45 — Multi-domain relay: a developer on two domains (Three-VM)

> Started at `2026-11-11 11:19:44 UTC`


## Pre-flight

✅ `11:19:44` Onboarding is complete  
✅ `11:19:44` Agent test-agent is enrolled on the host  
✅ `11:19:44` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B added, its DNS checked, activated

✅ `11:19:45` Domain lamaste-second.local added (201)  
✅ `11:19:45` …pending until activated  
✅ `11:19:45` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `11:19:45` …the one required record is auth.lamaste-second.local  
✅ `11:19:47` lamaste-second.local is active  
✅ `11:19:47` Authelia holds a session cookie for A (test.lamaste.local)  
✅ `11:19:47` …and one for B (lamaste-second.local)  
✅ `11:19:47` A is the primary domain  
✅ `11:19:47` B is not  

## A developer, member of A and B

✅ `11:19:48` User e2e45-dev created, member of test.lamaste.local and lamaste-second.local  
✅ `11:19:48` …one directory id for both domains  
✅ `11:19:48` GET /api/users lists e2e45-dev's domains: A and B  
✅ `11:19:48` A's member list holds e2e45-dev  
✅ `11:19:48` …and B's  
✅ `11:19:49` A and B each have a group key of their own  
✅ `11:19:49` B's rendered access rules admit B's member group  
✅ `11:19:49` …and name no user  
✅ `11:19:49` users.yml gives e2e45-dev A's member group  
✅ `11:19:49` …and B's  
✅ `11:19:50` …and end refusing everyone else  

## An authenticated tunnel on A and on B, a restricted one on B

✅ `11:19:53` Tunnel e2e45a.test.lamaste.local (authenticated), carried by test-agent  
✅ `11:19:56` Tunnel e2e45b.lamaste-second.local (authenticated), carried by test-agent  
✅ `11:19:59` Tunnel e2e45r.lamaste-second.local (restricted), carried by test-agent  
✅ `11:20:04` Port 18451: the backend answers through chisel  
✅ `11:20:04` Port 18452: the backend answers through chisel  
✅ `11:20:04` Port 18453: the backend answers through chisel  

## Signed in at auth.A: A's tunnel; B sends them to auth.B

✅ `11:20:04` e2e45-dev's TOTP secret reset (one secret for every domain)  
✅ `11:20:06` e2e45-dev signed in at auth.test.lamaste.local (password, TOTP)  
✅ `11:20:06` A's authenticated tunnel: 200  
✅ `11:20:06` …from its backend  
✅ `11:20:07` B's tunnel without a session: to B's own sign-in page (auth.lamaste-second.local)  
✅ `11:20:07` …with A's session too: a browser never sends A's cookie to B  

## Signed in at auth.B with the same password and TOTP secret: B's tunnel

✅ `11:20:33` e2e45-dev signed in at auth.lamaste-second.local (password, TOTP)  
✅ `11:20:33` B's authenticated tunnel: 200  
✅ `11:20:33` …from its backend  
✅ `11:20:33` A's session still opens A  

## B's restricted tunnel: the access-request page, then a grant

✅ `11:20:33` Without a grant: 403  
✅ `11:20:33` …the access-request page (a member of B, not granted this tunnel)  
✅ `11:20:33` …nothing of the tunnel  
✅ `11:20:33` A grant for e2e45-dev on e2e45r.lamaste-second.local  
✅ `11:20:34` With the grant: 200  
✅ `11:20:34` B's restricted tunnel, granted: 200  
✅ `11:20:34` …from its backend  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `46` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `46` |

ℹ️ `11:20:34` Cleaning up test resources...  
