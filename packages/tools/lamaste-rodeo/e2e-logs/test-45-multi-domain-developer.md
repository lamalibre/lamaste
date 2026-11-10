# Lamaste E2E: 45 — Multi-domain relay: a developer on two domains (Three-VM)

> Started at `2026-11-10 14:05:12 UTC`


## Pre-flight

✅ `14:05:12` Onboarding is complete  
✅ `14:05:12` Agent test-agent is enrolled on the host  
✅ `14:05:12` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B added, its DNS checked, activated

✅ `14:05:13` Domain lamaste-second.local added (201)  
✅ `14:05:13` …pending until activated  
✅ `14:05:14` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:05:14` …the one required record is auth.lamaste-second.local  
✅ `14:05:15` lamaste-second.local is active  
✅ `14:05:15` Authelia holds a session cookie for A (test.lamaste.local)  
✅ `14:05:15` …and one for B (lamaste-second.local)  
✅ `14:05:15` A is the primary domain  
✅ `14:05:16` B is not  

## A developer, member of A and B

✅ `14:05:16` User e2e45-dev created, member of test.lamaste.local and lamaste-second.local  
✅ `14:05:16` …one directory id for both domains  
✅ `14:05:17` GET /api/users lists e2e45-dev's domains: A and B  
✅ `14:05:17` A's member list holds e2e45-dev  
✅ `14:05:17` …and B's  
✅ `14:05:17` A and B each have a group key of their own  
✅ `14:05:17` B's rendered access rules admit B's member group  
✅ `14:05:17` …and name no user  
✅ `14:05:18` users.yml gives e2e45-dev A's member group  
✅ `14:05:18` …and B's  
✅ `14:05:18` …and end refusing everyone else  

## An authenticated tunnel on A and on B, a restricted one on B

✅ `14:05:20` Tunnel e2e45a.test.lamaste.local (authenticated), carried by test-agent  
✅ `14:05:22` Tunnel e2e45b.lamaste-second.local (authenticated), carried by test-agent  
✅ `14:05:25` Tunnel e2e45r.lamaste-second.local (restricted), carried by test-agent  
✅ `14:05:26` Port 18451: the backend answers through chisel  
✅ `14:05:26` Port 18452: the backend answers through chisel  
✅ `14:05:29` Port 18453: the backend answers through chisel  

## Signed in at auth.A: A's tunnel; B sends them to auth.B

✅ `14:05:30` e2e45-dev's TOTP secret reset (one secret for every domain)  
✅ `14:05:31` e2e45-dev signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:05:32` A's authenticated tunnel: 200  
✅ `14:05:32` …from its backend  
✅ `14:05:32` B's tunnel without a session: to B's own sign-in page (auth.lamaste-second.local)  
✅ `14:05:32` …with A's session too: a browser never sends A's cookie to B  

## Signed in at auth.B with the same password and TOTP secret: B's tunnel

✅ `14:06:03` e2e45-dev signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:06:03` B's authenticated tunnel: 200  
✅ `14:06:03` …from its backend  
✅ `14:06:03` A's session still opens A  

## B's restricted tunnel: the access-request page, then a grant

✅ `14:06:04` Without a grant: 403  
✅ `14:06:04` …the access-request page (a member of B, not granted this tunnel)  
✅ `14:06:04` …nothing of the tunnel  
✅ `14:06:04` A grant for e2e45-dev on e2e45r.lamaste-second.local  
✅ `14:06:04` With the grant: 200  
✅ `14:06:04` B's restricted tunnel, granted: 200  
✅ `14:06:04` …from its backend  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `46` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `46` |

ℹ️ `14:06:04` Cleaning up test resources...  
