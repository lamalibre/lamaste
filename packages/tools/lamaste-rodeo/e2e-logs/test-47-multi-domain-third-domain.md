# Lamaste E2E: 47 — Multi-domain relay: a third domain changes nothing else (Three-VM)

> Started at `2026-10-25 18:40:49 UTC`


## Pre-flight

✅ `18:40:49` Onboarding is complete  
✅ `18:40:49` Agent test-agent is enrolled on the host  
✅ `18:40:50` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## A member of A, a member of B, a tunnel on each

✅ `18:40:50` Domain lamaste-second.local added (201)  
✅ `18:40:50` …pending until activated  
✅ `18:40:50` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `18:40:50` …the one required record is auth.lamaste-second.local  
✅ `18:40:52` lamaste-second.local is active  
✅ `18:40:54` User e2e47-a created, member of test.lamaste.local  
✅ `18:40:55` User e2e47-b created, member of lamaste-second.local  
✅ `18:40:55` Both have a directory id  
✅ `18:40:56` Tunnel e2e47a.test.lamaste.local (authenticated), carried by test-agent  
✅ `18:40:58` Tunnel e2e47b.lamaste-second.local (authenticated), carried by test-agent  
✅ `18:41:02` Port 18471: the backend answers through chisel  
✅ `18:41:02` Port 18472: the backend answers through chisel  

## The snapshot: rules, members, reachability

✅ `18:41:02` A's rules admit e2e47-a  
✅ `18:41:02` …not e2e47-b  
✅ `18:41:02` B's rules admit e2e47-b  
✅ `18:41:02` …not e2e47-a  
✅ `18:41:04` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:41:06` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:41:32` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:41:34` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:41:34` Each reaches its own domain's tunnel and is refused on the other's  

## Domain C added and activated, with a member of its own and a tunnel

✅ `18:41:35` Domain lamaste-third.local added (201)  
✅ `18:41:35` …pending until activated  
✅ `18:41:35` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `18:41:35` …the one required record is auth.lamaste-third.local  
✅ `18:41:36` lamaste-third.local is active  
✅ `18:41:38` User e2e47-c created, member of lamaste-third.local  
✅ `18:41:38` e2e47-c has a directory id  
✅ `18:41:39` Tunnel e2e47c.lamaste-third.local (authenticated), carried by test-agent  
✅ `18:41:43` Port 18473: the backend answers through chisel  
✅ `18:41:43` Authelia holds a session cookie for C  

## A and B: the same rules, the same members, the same answers

✅ `18:41:43` A's rendered rules are byte-equal to the snapshot  
✅ `18:41:43` B's rendered rules are byte-equal to the snapshot  
✅ `18:41:44` A's member list is unchanged  
✅ `18:41:44` …and B's  
✅ `18:41:44` C has its one member  
✅ `18:42:03` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:42:04` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:42:33` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:42:34` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:42:35` Signed in again: every request answers as before (a@e2e47a=200 a@e2e47b=403 b@e2e47a=403 b@e2e47b=200)  

## C's member: C's tunnel, refused on A and B

✅ `18:42:36` e2e47-c signed in at auth.lamaste-third.local (password, TOTP)  
✅ `18:43:02` e2e47-c signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:43:33` e2e47-c signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:43:33` e2e47-c on C's tunnel: 200  
✅ `18:43:33` …from its backend  
✅ `18:43:33` e2e47-c on A's tunnel: 403  
✅ `18:43:33` …the domain refusal page  
✅ `18:43:33` …naming test.lamaste.local  
✅ `18:43:33` …never a redirect to a sign-in page (no login loop)  
✅ `18:43:33` e2e47-c on B's tunnel: 403  
✅ `18:43:33` …the domain refusal page  
✅ `18:43:33` …naming lamaste-second.local  
✅ `18:43:33` …never a redirect to a sign-in page (no login loop)  
✅ `18:43:33` e2e47-a's session of A opens nothing on C: to C's own sign-in page  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `58` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `58` |

ℹ️ `18:43:33` Cleaning up test resources...  
