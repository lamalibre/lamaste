# Lamaste E2E: 45 — Multi-domain relay: a developer on two domains (Three-VM)

> Started at `2026-10-25 17:25:50 UTC`


## Pre-flight

✅ `17:25:50` Onboarding is complete  
✅ `17:25:50` Agent test-agent is enrolled on the host  
✅ `17:25:50` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B added, its DNS checked, activated

✅ `17:25:51` Domain lamaste-second.local added (201)  
✅ `17:25:51` …pending until activated  
✅ `17:25:51` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `17:25:51` …the one required record is auth.lamaste-second.local  
✅ `17:25:53` lamaste-second.local is active  
✅ `17:25:54` Authelia holds a session cookie for A (test.lamaste.local)  
✅ `17:25:54` …and one for B (lamaste-second.local)  
✅ `17:25:54` A is the primary domain  
✅ `17:25:54` B is not  

## A developer, member of A and B

✅ `17:25:57` User e2e45-dev created, member of test.lamaste.local and lamaste-second.local  
✅ `17:25:57` …one directory id for both domains  
✅ `17:25:57` GET /api/users lists e2e45-dev's domains: A and B  
✅ `17:25:57` A's member list holds e2e45-dev  
✅ `17:25:57` …and B's  
✅ `17:25:57` B's rendered access rules admit e2e45-dev  
✅ `17:25:57` …and end refusing everyone else  

## An authenticated tunnel on A and on B, a restricted one on B

✅ `17:25:58` Tunnel e2e45a.test.lamaste.local (authenticated), carried by test-agent  
✅ `17:25:59` Tunnel e2e45b.lamaste-second.local (authenticated), carried by test-agent  
✅ `17:26:00` Tunnel e2e45r.lamaste-second.local (restricted), carried by test-agent  
✅ `17:26:04` Port 18451: the backend answers through chisel  
✅ `17:26:04` Port 18452: the backend answers through chisel  
✅ `17:26:05` Port 18453: the backend answers through chisel  

## Signed in at auth.A: A's tunnel; B sends them to auth.B

✅ `17:26:05` e2e45-dev's TOTP secret reset (one secret for every domain)  
✅ `17:26:06` e2e45-dev signed in at auth.test.lamaste.local (password, TOTP)  
✅ `17:26:07` A's authenticated tunnel: 200  
✅ `17:26:07` …from its backend  
✅ `17:26:07` B's tunnel without a session: to B's own sign-in page (auth.lamaste-second.local)  
✅ `17:26:07` …with A's session too: a browser never sends A's cookie to B  

## Signed in at auth.B with the same password and TOTP secret: B's tunnel

✅ `17:26:33` e2e45-dev signed in at auth.lamaste-second.local (password, TOTP)  
✅ `17:26:33` B's authenticated tunnel: 200  
✅ `17:26:33` …from its backend  
✅ `17:26:33` A's session still opens A  

## B's restricted tunnel: the access-request page, then a grant

✅ `17:26:33` Without a grant: 403  
✅ `17:26:33` …the access-request page (a member of B, not granted this tunnel)  
✅ `17:26:33` …nothing of the tunnel  
✅ `17:26:33` A grant for e2e45-dev on e2e45r.lamaste-second.local  
✅ `17:26:33` With the grant: 200  
✅ `17:26:33` B's restricted tunnel, granted: 200  
✅ `17:26:33` …from its backend  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `42` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `42` |

ℹ️ `17:26:33` Cleaning up test resources...  
