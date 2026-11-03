# Lamaste E2E: 45 — Multi-domain relay: a developer on two domains (Three-VM)

> Started at `2026-11-03 10:28:38 UTC`


## Pre-flight

✅ `10:28:38` Onboarding is complete  
✅ `10:28:39` Agent test-agent is enrolled on the host  
✅ `10:28:39` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B added, its DNS checked, activated

✅ `10:28:39` Domain lamaste-second.local added (201)  
✅ `10:28:39` …pending until activated  
✅ `10:28:39` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `10:28:39` …the one required record is auth.lamaste-second.local  
✅ `10:28:41` lamaste-second.local is active  
✅ `10:28:41` Authelia holds a session cookie for A (test.lamaste.local)  
✅ `10:28:41` …and one for B (lamaste-second.local)  
✅ `10:28:41` A is the primary domain  
✅ `10:28:41` B is not  

## A developer, member of A and B

✅ `10:28:42` User e2e45-dev created, member of test.lamaste.local and lamaste-second.local  
✅ `10:28:42` …one directory id for both domains  
✅ `10:28:42` GET /api/users lists e2e45-dev's domains: A and B  
✅ `10:28:42` A's member list holds e2e45-dev  
✅ `10:28:42` …and B's  
✅ `10:28:42` A and B each have a group key of their own  
✅ `10:28:42` B's rendered access rules admit B's member group  
✅ `10:28:42` …and name no user  
✅ `10:28:43` users.yml gives e2e45-dev A's member group  
✅ `10:28:43` …and B's  
✅ `10:28:43` …and end refusing everyone else  

## An authenticated tunnel on A and on B, a restricted one on B

✅ `10:28:44` Tunnel e2e45a.test.lamaste.local (authenticated), carried by test-agent  
✅ `10:28:45` Tunnel e2e45b.lamaste-second.local (authenticated), carried by test-agent  
✅ `10:28:47` Tunnel e2e45r.lamaste-second.local (restricted), carried by test-agent  
✅ `10:28:51` Port 18451: the backend answers through chisel  
✅ `10:28:51` Port 18452: the backend answers through chisel  
✅ `10:28:51` Port 18453: the backend answers through chisel  

## Signed in at auth.A: A's tunnel; B sends them to auth.B

✅ `10:28:52` e2e45-dev's TOTP secret reset (one secret for every domain)  
✅ `10:28:53` e2e45-dev signed in at auth.test.lamaste.local (password, TOTP)  
✅ `10:28:53` A's authenticated tunnel: 200  
✅ `10:28:53` …from its backend  
✅ `10:28:53` B's tunnel without a session: to B's own sign-in page (auth.lamaste-second.local)  
✅ `10:28:53` …with A's session too: a browser never sends A's cookie to B  

## Signed in at auth.B with the same password and TOTP secret: B's tunnel

✅ `10:29:02` e2e45-dev signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:29:02` B's authenticated tunnel: 200  
✅ `10:29:02` …from its backend  
✅ `10:29:03` A's session still opens A  

## B's restricted tunnel: the access-request page, then a grant

✅ `10:29:03` Without a grant: 403  
✅ `10:29:03` …the access-request page (a member of B, not granted this tunnel)  
✅ `10:29:03` …nothing of the tunnel  
✅ `10:29:03` A grant for e2e45-dev on e2e45r.lamaste-second.local  
✅ `10:29:03` With the grant: 200  
✅ `10:29:03` B's restricted tunnel, granted: 200  
✅ `10:29:03` …from its backend  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `46` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `46` |

ℹ️ `10:29:03` Cleaning up test resources...  
