# Lamaste E2E: 45 — Multi-domain relay: a developer on two domains (Three-VM)

> Started at `2026-11-02 16:45:02 UTC`


## Pre-flight

✅ `16:45:02` Onboarding is complete  
✅ `16:45:03` Agent test-agent is enrolled on the host  
✅ `16:45:03` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B added, its DNS checked, activated

✅ `16:45:03` Domain lamaste-second.local added (201)  
✅ `16:45:03` …pending until activated  
✅ `16:45:03` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `16:45:03` …the one required record is auth.lamaste-second.local  
✅ `16:45:05` lamaste-second.local is active  
✅ `16:45:05` Authelia holds a session cookie for A (test.lamaste.local)  
✅ `16:45:05` …and one for B (lamaste-second.local)  
✅ `16:45:05` A is the primary domain  
✅ `16:45:05` B is not  

## A developer, member of A and B

✅ `16:45:06` User e2e45-dev created, member of test.lamaste.local and lamaste-second.local  
✅ `16:45:06` …one directory id for both domains  
✅ `16:45:06` GET /api/users lists e2e45-dev's domains: A and B  
✅ `16:45:06` A's member list holds e2e45-dev  
✅ `16:45:06` …and B's  
✅ `16:45:07` A and B each have a group key of their own  
✅ `16:45:07` B's rendered access rules admit B's member group  
✅ `16:45:07` …and name no user  
✅ `16:45:07` users.yml gives e2e45-dev A's member group  
✅ `16:45:07` …and B's  
✅ `16:45:07` …and end refusing everyone else  

## An authenticated tunnel on A and on B, a restricted one on B

✅ `16:45:08` Tunnel e2e45a.test.lamaste.local (authenticated), carried by test-agent  
✅ `16:45:10` Tunnel e2e45b.lamaste-second.local (authenticated), carried by test-agent  
✅ `16:45:11` Tunnel e2e45r.lamaste-second.local (restricted), carried by test-agent  
✅ `16:45:15` Port 18451: the backend answers through chisel  
✅ `16:45:15` Port 18452: the backend answers through chisel  
✅ `16:45:15` Port 18453: the backend answers through chisel  

## Signed in at auth.A: A's tunnel; B sends them to auth.B

✅ `16:45:16` e2e45-dev's TOTP secret reset (one secret for every domain)  
✅ `16:45:17` e2e45-dev signed in at auth.test.lamaste.local (password, TOTP)  
✅ `16:45:18` A's authenticated tunnel: 200  
✅ `16:45:18` …from its backend  
✅ `16:45:18` B's tunnel without a session: to B's own sign-in page (auth.lamaste-second.local)  
✅ `16:45:18` …with A's session too: a browser never sends A's cookie to B  

## Signed in at auth.B with the same password and TOTP secret: B's tunnel

✅ `16:45:32` e2e45-dev signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:45:33` B's authenticated tunnel: 200  
✅ `16:45:33` …from its backend  
✅ `16:45:33` A's session still opens A  

## B's restricted tunnel: the access-request page, then a grant

✅ `16:45:33` Without a grant: 403  
✅ `16:45:33` …the access-request page (a member of B, not granted this tunnel)  
✅ `16:45:33` …nothing of the tunnel  
✅ `16:45:33` A grant for e2e45-dev on e2e45r.lamaste-second.local  
✅ `16:45:33` With the grant: 200  
✅ `16:45:33` B's restricted tunnel, granted: 200  
✅ `16:45:33` …from its backend  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `46` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `46` |

ℹ️ `16:45:33` Cleaning up test resources...  
