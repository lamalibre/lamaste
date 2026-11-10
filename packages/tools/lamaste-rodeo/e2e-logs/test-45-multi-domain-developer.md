# Lamaste E2E: 45 — Multi-domain relay: a developer on two domains (Three-VM)

> Started at `2026-11-10 18:47:46 UTC`


## Pre-flight

✅ `18:47:46` Onboarding is complete  
✅ `18:47:46` Agent test-agent is enrolled on the host  
✅ `18:47:47` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B added, its DNS checked, activated

✅ `18:47:48` Domain lamaste-second.local added (201)  
✅ `18:47:48` …pending until activated  
✅ `18:47:48` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `18:47:48` …the one required record is auth.lamaste-second.local  
✅ `18:47:49` lamaste-second.local is active  
✅ `18:47:49` Authelia holds a session cookie for A (test.lamaste.local)  
✅ `18:47:49` …and one for B (lamaste-second.local)  
✅ `18:47:49` A is the primary domain  
✅ `18:47:50` B is not  

## A developer, member of A and B

✅ `18:47:50` User e2e45-dev created, member of test.lamaste.local and lamaste-second.local  
✅ `18:47:50` …one directory id for both domains  
✅ `18:47:51` GET /api/users lists e2e45-dev's domains: A and B  
✅ `18:47:51` A's member list holds e2e45-dev  
✅ `18:47:51` …and B's  
✅ `18:47:51` A and B each have a group key of their own  
✅ `18:47:51` B's rendered access rules admit B's member group  
✅ `18:47:52` …and name no user  
✅ `18:47:52` users.yml gives e2e45-dev A's member group  
✅ `18:47:52` …and B's  
✅ `18:47:52` …and end refusing everyone else  

## An authenticated tunnel on A and on B, a restricted one on B

✅ `18:47:54` Tunnel e2e45a.test.lamaste.local (authenticated), carried by test-agent  
✅ `18:47:56` Tunnel e2e45b.lamaste-second.local (authenticated), carried by test-agent  
✅ `18:47:58` Tunnel e2e45r.lamaste-second.local (restricted), carried by test-agent  
✅ `18:47:59` Port 18451: the backend answers through chisel  
✅ `18:47:59` Port 18452: the backend answers through chisel  
✅ `18:48:03` Port 18453: the backend answers through chisel  

## Signed in at auth.A: A's tunnel; B sends them to auth.B

✅ `18:48:03` e2e45-dev's TOTP secret reset (one secret for every domain)  
✅ `18:48:05` e2e45-dev signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:48:05` A's authenticated tunnel: 200  
✅ `18:48:05` …from its backend  
✅ `18:48:05` B's tunnel without a session: to B's own sign-in page (auth.lamaste-second.local)  
✅ `18:48:05` …with A's session too: a browser never sends A's cookie to B  

## Signed in at auth.B with the same password and TOTP secret: B's tunnel

✅ `18:48:32` e2e45-dev signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:48:33` B's authenticated tunnel: 200  
✅ `18:48:33` …from its backend  
✅ `18:48:33` A's session still opens A  

## B's restricted tunnel: the access-request page, then a grant

✅ `18:48:33` Without a grant: 403  
✅ `18:48:33` …the access-request page (a member of B, not granted this tunnel)  
✅ `18:48:33` …nothing of the tunnel  
✅ `18:48:33` A grant for e2e45-dev on e2e45r.lamaste-second.local  
✅ `18:48:33` With the grant: 200  
✅ `18:48:33` B's restricted tunnel, granted: 200  
✅ `18:48:33` …from its backend  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `46` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `46` |

ℹ️ `18:48:34` Cleaning up test resources...  
