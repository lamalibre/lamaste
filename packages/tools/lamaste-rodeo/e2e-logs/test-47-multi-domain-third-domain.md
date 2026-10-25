# Lamaste E2E: 47 — Multi-domain relay: a third domain changes nothing else (Three-VM)

> Started at `2026-10-25 17:27:23 UTC`


## Pre-flight

✅ `17:27:23` Onboarding is complete  
✅ `17:27:23` Agent test-agent is enrolled on the host  
✅ `17:27:24` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## A member of A, a member of B, a tunnel on each

✅ `17:27:24` Domain lamaste-second.local added (201)  
✅ `17:27:24` …pending until activated  
✅ `17:27:24` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `17:27:24` …the one required record is auth.lamaste-second.local  
✅ `17:27:27` lamaste-second.local is active  
✅ `17:27:30` User e2e47-a created, member of test.lamaste.local  
✅ `17:27:32` User e2e47-b created, member of lamaste-second.local  
✅ `17:27:33` Both have a directory id  
✅ `17:27:34` Tunnel e2e47a.test.lamaste.local (authenticated), carried by test-agent  
✅ `17:27:35` Tunnel e2e47b.lamaste-second.local (authenticated), carried by test-agent  
✅ `17:27:39` Port 18471: the backend answers through chisel  
✅ `17:27:39` Port 18472: the backend answers through chisel  

## The snapshot: rules, members, reachability

✅ `17:27:39` A's rules admit e2e47-a  
✅ `17:27:39` …not e2e47-b  
✅ `17:27:39` B's rules admit e2e47-b  
✅ `17:27:39` …not e2e47-a  
✅ `17:27:41` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `17:27:43` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `17:28:04` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `17:28:06` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `17:28:06` Each reaches its own domain's tunnel and is refused on the other's  

## Domain C added and activated, with a member of its own and a tunnel

✅ `17:28:07` Domain lamaste-third.local added (201)  
✅ `17:28:07` …pending until activated  
✅ `17:28:07` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `17:28:07` …the one required record is auth.lamaste-third.local  
✅ `17:28:10` lamaste-third.local is active  
✅ `17:28:13` User e2e47-c created, member of lamaste-third.local  
✅ `17:28:13` e2e47-c has a directory id  
✅ `17:28:14` Tunnel e2e47c.lamaste-third.local (authenticated), carried by test-agent  
✅ `17:28:18` Port 18473: the backend answers through chisel  
✅ `17:28:18` Authelia holds a session cookie for C  

## A and B: the same rules, the same members, the same answers

✅ `17:28:19` A's rendered rules are byte-equal to the snapshot  
✅ `17:28:19` B's rendered rules are byte-equal to the snapshot  
✅ `17:28:19` A's member list is unchanged  
✅ `17:28:19` …and B's  
✅ `17:28:19` C has its one member  
✅ `17:28:33` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `17:28:34` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `17:29:03` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `17:29:05` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `17:29:05` Signed in again: every request answers as before (a@e2e47a=200 a@e2e47b=403 b@e2e47a=403 b@e2e47b=200)  

## C's member: C's tunnel, refused on A and B

✅ `17:29:06` e2e47-c signed in at auth.lamaste-third.local (password, TOTP)  
✅ `17:29:32` e2e47-c signed in at auth.test.lamaste.local (password, TOTP)  
✅ `17:30:05` e2e47-c signed in at auth.lamaste-second.local (password, TOTP)  
✅ `17:30:05` e2e47-c on C's tunnel: 200  
✅ `17:30:05` …from its backend  
✅ `17:30:05` e2e47-c on A's tunnel: 403  
✅ `17:30:05` …the domain refusal page  
✅ `17:30:05` …naming test.lamaste.local  
✅ `17:30:05` …never a redirect to a sign-in page (no login loop)  
✅ `17:30:05` e2e47-c on B's tunnel: 403  
✅ `17:30:05` …the domain refusal page  
✅ `17:30:05` …naming lamaste-second.local  
✅ `17:30:05` …never a redirect to a sign-in page (no login loop)  
✅ `17:30:05` e2e47-a's session of A opens nothing on C: to C's own sign-in page  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `58` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `58` |

ℹ️ `17:30:05` Cleaning up test resources...  
