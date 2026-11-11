# Lamaste E2E: 47 — Multi-domain relay: a third domain changes nothing else (Three-VM)

> Started at `2026-11-11 11:21:48 UTC`


## Pre-flight

✅ `11:21:49` Onboarding is complete  
✅ `11:21:49` Agent test-agent is enrolled on the host  
✅ `11:21:49` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## A member of A, a member of B, a tunnel on each

✅ `11:21:50` Domain lamaste-second.local added (201)  
✅ `11:21:50` …pending until activated  
✅ `11:21:50` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `11:21:50` …the one required record is auth.lamaste-second.local  
✅ `11:21:51` lamaste-second.local is active  
✅ `11:21:53` User e2e47-a created, member of test.lamaste.local  
✅ `11:21:53` User e2e47-b created, member of lamaste-second.local  
✅ `11:21:53` Both have a directory id  
✅ `11:21:57` Tunnel e2e47a.test.lamaste.local (authenticated), carried by test-agent  
✅ `11:22:00` Tunnel e2e47b.lamaste-second.local (authenticated), carried by test-agent  
✅ `11:22:04` Port 18471: the backend answers through chisel  
✅ `11:22:04` Port 18472: the backend answers through chisel  

## The snapshot: rules, members, reachability

✅ `11:22:05` A's rules admit A's member group  
✅ `11:22:05` B's rules admit B's member group  
✅ `11:22:05` …neither names a user  
✅ `11:22:05` users.yml gives e2e47-a A's member group  
✅ `11:22:06` …not B's  
✅ `11:22:06` users.yml gives e2e47-b B's member group  
✅ `11:22:06` …not A's  
✅ `11:22:09` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `11:22:10` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `11:22:32` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `11:22:34` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `11:22:34` Each reaches its own domain's tunnel and is refused on the other's  

## Domain C added and activated, with a member of its own and a tunnel

✅ `11:22:35` Domain lamaste-third.local added (201)  
✅ `11:22:35` …pending until activated  
✅ `11:22:35` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `11:22:35` …the one required record is auth.lamaste-third.local  
✅ `11:22:36` lamaste-third.local is active  
✅ `11:22:37` User e2e47-c created, member of lamaste-third.local  
✅ `11:22:37` e2e47-c has a directory id  
✅ `11:22:40` Tunnel e2e47c.lamaste-third.local (authenticated), carried by test-agent  
✅ `11:22:44` Port 18473: the backend answers through chisel  
✅ `11:22:44` Authelia holds a session cookie for C  

## A and B: the same rules, the same members, the same answers

✅ `11:22:45` A's rendered rules are byte-equal to the snapshot  
✅ `11:22:45` B's rendered rules are byte-equal to the snapshot  
✅ `11:22:45` A's member list is unchanged  
✅ `11:22:45` …and B's  
✅ `11:22:45` C has its one member  
✅ `11:22:46` e2e47-a's and e2e47-b's groups in users.yml are unchanged  
✅ `11:23:03` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `11:23:04` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `11:23:33` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `11:23:34` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `11:23:35` Signed in again: every request answers as before (a@e2e47a=200 a@e2e47b=403 b@e2e47a=403 b@e2e47b=200)  

## C's member: C's tunnel, refused on A and B

✅ `11:23:36` e2e47-c signed in at auth.lamaste-third.local (password, TOTP)  
✅ `11:24:03` e2e47-c signed in at auth.test.lamaste.local (password, TOTP)  
✅ `11:24:33` e2e47-c signed in at auth.lamaste-second.local (password, TOTP)  
✅ `11:24:33` e2e47-c on C's tunnel: 200  
✅ `11:24:33` …from its backend  
✅ `11:24:33` e2e47-c on A's tunnel: 403  
✅ `11:24:33` …the domain refusal page  
✅ `11:24:33` …naming test.lamaste.local  
✅ `11:24:33` …never a redirect to a sign-in page (no login loop)  
✅ `11:24:34` e2e47-c on B's tunnel: 403  
✅ `11:24:34` …the domain refusal page  
✅ `11:24:34` …naming lamaste-second.local  
✅ `11:24:34` …never a redirect to a sign-in page (no login loop)  
✅ `11:24:34` e2e47-a's session of A opens nothing on C: to C's own sign-in page  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `62` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `62` |

ℹ️ `11:24:34` Cleaning up test resources...  
