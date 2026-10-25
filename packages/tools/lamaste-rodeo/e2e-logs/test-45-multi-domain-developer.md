# Lamaste E2E: 45 — Multi-domain relay: a developer on two domains (Three-VM)

> Started at `2026-10-25 18:39:20 UTC`


## Pre-flight

✅ `18:39:20` Onboarding is complete  
✅ `18:39:21` Agent test-agent is enrolled on the host  
✅ `18:39:21` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B added, its DNS checked, activated

✅ `18:39:21` Domain lamaste-second.local added (201)  
✅ `18:39:21` …pending until activated  
✅ `18:39:22` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `18:39:22` …the one required record is auth.lamaste-second.local  
✅ `18:39:23` lamaste-second.local is active  
✅ `18:39:23` Authelia holds a session cookie for A (test.lamaste.local)  
✅ `18:39:23` …and one for B (lamaste-second.local)  
✅ `18:39:23` A is the primary domain  
✅ `18:39:23` B is not  

## A developer, member of A and B

✅ `18:39:25` User e2e45-dev created, member of test.lamaste.local and lamaste-second.local  
✅ `18:39:25` …one directory id for both domains  
✅ `18:39:25` GET /api/users lists e2e45-dev's domains: A and B  
✅ `18:39:25` A's member list holds e2e45-dev  
✅ `18:39:25` …and B's  
✅ `18:39:26` B's rendered access rules admit e2e45-dev  
✅ `18:39:26` …and end refusing everyone else  

## An authenticated tunnel on A and on B, a restricted one on B

✅ `18:39:27` Tunnel e2e45a.test.lamaste.local (authenticated), carried by test-agent  
✅ `18:39:28` Tunnel e2e45b.lamaste-second.local (authenticated), carried by test-agent  
✅ `18:39:29` Tunnel e2e45r.lamaste-second.local (restricted), carried by test-agent  
✅ `18:39:33` Port 18451: the backend answers through chisel  
✅ `18:39:33` Port 18452: the backend answers through chisel  
✅ `18:39:33` Port 18453: the backend answers through chisel  

## Signed in at auth.A: A's tunnel; B sends them to auth.B

✅ `18:39:33` e2e45-dev's TOTP secret reset (one secret for every domain)  
✅ `18:39:35` e2e45-dev signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:39:35` A's authenticated tunnel: 200  
✅ `18:39:35` …from its backend  
✅ `18:39:35` B's tunnel without a session: to B's own sign-in page (auth.lamaste-second.local)  
✅ `18:39:35` …with A's session too: a browser never sends A's cookie to B  

## Signed in at auth.B with the same password and TOTP secret: B's tunnel

✅ `18:40:03` e2e45-dev signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:40:03` B's authenticated tunnel: 200  
✅ `18:40:03` …from its backend  
✅ `18:40:03` A's session still opens A  

## B's restricted tunnel: the access-request page, then a grant

✅ `18:40:03` Without a grant: 403  
✅ `18:40:03` …the access-request page (a member of B, not granted this tunnel)  
✅ `18:40:03` …nothing of the tunnel  
✅ `18:40:03` A grant for e2e45-dev on e2e45r.lamaste-second.local  
✅ `18:40:04` With the grant: 200  
✅ `18:40:04` B's restricted tunnel, granted: 200  
✅ `18:40:04` …from its backend  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `42` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `42` |

ℹ️ `18:40:04` Cleaning up test resources...  
