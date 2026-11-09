# Lamaste E2E: 45 — Multi-domain relay: a developer on two domains (Three-VM)

> Started at `2026-11-09 13:40:07 UTC`


## Pre-flight

✅ `13:40:07` Onboarding is complete  
✅ `13:40:07` Agent test-agent is enrolled on the host  
✅ `13:40:07` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B added, its DNS checked, activated

✅ `13:40:08` Domain lamaste-second.local added (201)  
✅ `13:40:08` …pending until activated  
✅ `13:40:08` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `13:40:08` …the one required record is auth.lamaste-second.local  
✅ `13:40:09` lamaste-second.local is active  
✅ `13:40:09` Authelia holds a session cookie for A (test.lamaste.local)  
✅ `13:40:09` …and one for B (lamaste-second.local)  
✅ `13:40:09` A is the primary domain  
✅ `13:40:10` B is not  

## A developer, member of A and B

✅ `13:40:10` User e2e45-dev created, member of test.lamaste.local and lamaste-second.local  
✅ `13:40:10` …one directory id for both domains  
✅ `13:40:10` GET /api/users lists e2e45-dev's domains: A and B  
✅ `13:40:10` A's member list holds e2e45-dev  
✅ `13:40:11` …and B's  
✅ `13:40:11` A and B each have a group key of their own  
✅ `13:40:11` B's rendered access rules admit B's member group  
✅ `13:40:11` …and name no user  
✅ `13:40:11` users.yml gives e2e45-dev A's member group  
✅ `13:40:11` …and B's  
✅ `13:40:11` …and end refusing everyone else  

## An authenticated tunnel on A and on B, a restricted one on B

✅ `13:40:13` Tunnel e2e45a.test.lamaste.local (authenticated), carried by test-agent  
✅ `13:40:14` Tunnel e2e45b.lamaste-second.local (authenticated), carried by test-agent  
✅ `13:40:16` Tunnel e2e45r.lamaste-second.local (restricted), carried by test-agent  
✅ `13:40:20` Port 18451: the backend answers through chisel  
✅ `13:40:20` Port 18452: the backend answers through chisel  
✅ `13:40:20` Port 18453: the backend answers through chisel  

## Signed in at auth.A: A's tunnel; B sends them to auth.B

✅ `13:40:20` e2e45-dev's TOTP secret reset (one secret for every domain)  
✅ `13:40:22` e2e45-dev signed in at auth.test.lamaste.local (password, TOTP)  
✅ `13:40:22` A's authenticated tunnel: 200  
✅ `13:40:22` …from its backend  
✅ `13:40:22` B's tunnel without a session: to B's own sign-in page (auth.lamaste-second.local)  
✅ `13:40:22` …with A's session too: a browser never sends A's cookie to B  

## Signed in at auth.B with the same password and TOTP secret: B's tunnel

✅ `13:40:33` e2e45-dev signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:40:33` B's authenticated tunnel: 200  
✅ `13:40:33` …from its backend  
✅ `13:40:33` A's session still opens A  

## B's restricted tunnel: the access-request page, then a grant

✅ `13:40:33` Without a grant: 403  
✅ `13:40:33` …the access-request page (a member of B, not granted this tunnel)  
✅ `13:40:33` …nothing of the tunnel  
✅ `13:40:33` A grant for e2e45-dev on e2e45r.lamaste-second.local  
✅ `13:40:34` With the grant: 200  
✅ `13:40:34` B's restricted tunnel, granted: 200  
✅ `13:40:34` …from its backend  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `46` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `46` |

ℹ️ `13:40:34` Cleaning up test resources...  
