# Lamaste E2E: 47 — Multi-domain relay: a third domain changes nothing else (Three-VM)

> Started at `2026-11-10 18:49:46 UTC`


## Pre-flight

✅ `18:49:46` Onboarding is complete  
✅ `18:49:47` Agent test-agent is enrolled on the host  
✅ `18:49:47` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## A member of A, a member of B, a tunnel on each

✅ `18:49:48` Domain lamaste-second.local added (201)  
✅ `18:49:48` …pending until activated  
✅ `18:49:48` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `18:49:48` …the one required record is auth.lamaste-second.local  
✅ `18:49:49` lamaste-second.local is active  
✅ `18:49:51` User e2e47-a created, member of test.lamaste.local  
✅ `18:49:51` User e2e47-b created, member of lamaste-second.local  
✅ `18:49:51` Both have a directory id  
✅ `18:49:54` Tunnel e2e47a.test.lamaste.local (authenticated), carried by test-agent  
✅ `18:49:56` Tunnel e2e47b.lamaste-second.local (authenticated), carried by test-agent  
✅ `18:50:01` Port 18471: the backend answers through chisel  
✅ `18:50:01` Port 18472: the backend answers through chisel  

## The snapshot: rules, members, reachability

✅ `18:50:02` A's rules admit A's member group  
✅ `18:50:02` B's rules admit B's member group  
✅ `18:50:02` …neither names a user  
✅ `18:50:02` users.yml gives e2e47-a A's member group  
✅ `18:50:02` …not B's  
✅ `18:50:02` users.yml gives e2e47-b B's member group  
✅ `18:50:03` …not A's  
✅ `18:50:05` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:50:07` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:50:33` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:50:35` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:50:35` Each reaches its own domain's tunnel and is refused on the other's  

## Domain C added and activated, with a member of its own and a tunnel

✅ `18:50:36` Domain lamaste-third.local added (201)  
✅ `18:50:36` …pending until activated  
✅ `18:50:36` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `18:50:36` …the one required record is auth.lamaste-third.local  
✅ `18:50:37` lamaste-third.local is active  
✅ `18:50:38` User e2e47-c created, member of lamaste-third.local  
✅ `18:50:38` e2e47-c has a directory id  
✅ `18:50:41` Tunnel e2e47c.lamaste-third.local (authenticated), carried by test-agent  
✅ `18:50:45` Port 18473: the backend answers through chisel  
✅ `18:50:45` Authelia holds a session cookie for C  

## A and B: the same rules, the same members, the same answers

✅ `18:50:45` A's rendered rules are byte-equal to the snapshot  
✅ `18:50:45` B's rendered rules are byte-equal to the snapshot  
✅ `18:50:45` A's member list is unchanged  
✅ `18:50:46` …and B's  
✅ `18:50:46` C has its one member  
✅ `18:50:46` e2e47-a's and e2e47-b's groups in users.yml are unchanged  
✅ `18:51:03` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:51:05` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:51:32` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:51:34` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:51:34` Signed in again: every request answers as before (a@e2e47a=200 a@e2e47b=403 b@e2e47a=403 b@e2e47b=200)  

## C's member: C's tunnel, refused on A and B

✅ `18:51:36` e2e47-c signed in at auth.lamaste-third.local (password, TOTP)  
✅ `18:52:03` e2e47-c signed in at auth.test.lamaste.local (password, TOTP)  
✅ `18:52:33` e2e47-c signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:52:33` e2e47-c on C's tunnel: 200  
✅ `18:52:33` …from its backend  
✅ `18:52:33` e2e47-c on A's tunnel: 403  
✅ `18:52:33` …the domain refusal page  
✅ `18:52:33` …naming test.lamaste.local  
✅ `18:52:33` …never a redirect to a sign-in page (no login loop)  
✅ `18:52:33` e2e47-c on B's tunnel: 403  
✅ `18:52:33` …the domain refusal page  
✅ `18:52:33` …naming lamaste-second.local  
✅ `18:52:33` …never a redirect to a sign-in page (no login loop)  
✅ `18:52:34` e2e47-a's session of A opens nothing on C: to C's own sign-in page  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `62` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `62` |

ℹ️ `18:52:34` Cleaning up test resources...  
