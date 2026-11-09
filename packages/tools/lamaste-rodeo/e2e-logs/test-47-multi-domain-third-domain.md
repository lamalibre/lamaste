# Lamaste E2E: 47 — Multi-domain relay: a third domain changes nothing else (Three-VM)

> Started at `2026-11-09 13:41:14 UTC`


## Pre-flight

✅ `13:41:14` Onboarding is complete  
✅ `13:41:15` Agent test-agent is enrolled on the host  
✅ `13:41:15` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## A member of A, a member of B, a tunnel on each

✅ `13:41:15` Domain lamaste-second.local added (201)  
✅ `13:41:15` …pending until activated  
✅ `13:41:15` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `13:41:15` …the one required record is auth.lamaste-second.local  
✅ `13:41:17` lamaste-second.local is active  
✅ `13:41:17` User e2e47-a created, member of test.lamaste.local  
✅ `13:41:18` User e2e47-b created, member of lamaste-second.local  
✅ `13:41:18` Both have a directory id  
✅ `13:41:19` Tunnel e2e47a.test.lamaste.local (authenticated), carried by test-agent  
✅ `13:41:21` Tunnel e2e47b.lamaste-second.local (authenticated), carried by test-agent  
✅ `13:41:25` Port 18471: the backend answers through chisel  
✅ `13:41:25` Port 18472: the backend answers through chisel  

## The snapshot: rules, members, reachability

✅ `13:41:25` A's rules admit A's member group  
✅ `13:41:25` B's rules admit B's member group  
✅ `13:41:26` …neither names a user  
✅ `13:41:26` users.yml gives e2e47-a A's member group  
✅ `13:41:26` …not B's  
✅ `13:41:26` users.yml gives e2e47-b B's member group  
✅ `13:41:26` …not A's  
✅ `13:41:28` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `13:41:30` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:41:31` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:42:03` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `13:42:03` Each reaches its own domain's tunnel and is refused on the other's  

## Domain C added and activated, with a member of its own and a tunnel

✅ `13:42:04` Domain lamaste-third.local added (201)  
✅ `13:42:04` …pending until activated  
✅ `13:42:04` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `13:42:04` …the one required record is auth.lamaste-third.local  
✅ `13:42:05` lamaste-third.local is active  
✅ `13:42:06` User e2e47-c created, member of lamaste-third.local  
✅ `13:42:06` e2e47-c has a directory id  
✅ `13:42:07` Tunnel e2e47c.lamaste-third.local (authenticated), carried by test-agent  
✅ `13:42:11` Port 18473: the backend answers through chisel  
✅ `13:42:11` Authelia holds a session cookie for C  

## A and B: the same rules, the same members, the same answers

✅ `13:42:11` A's rendered rules are byte-equal to the snapshot  
✅ `13:42:11` B's rendered rules are byte-equal to the snapshot  
✅ `13:42:11` A's member list is unchanged  
✅ `13:42:12` …and B's  
✅ `13:42:12` C has its one member  
✅ `13:42:12` e2e47-a's and e2e47-b's groups in users.yml are unchanged  
✅ `13:42:14` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `13:42:33` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:42:34` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:43:03` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `13:43:03` Signed in again: every request answers as before (a@e2e47a=200 a@e2e47b=403 b@e2e47a=403 b@e2e47b=200)  

## C's member: C's tunnel, refused on A and B

✅ `13:43:04` e2e47-c signed in at auth.lamaste-third.local (password, TOTP)  
✅ `13:43:32` e2e47-c signed in at auth.test.lamaste.local (password, TOTP)  
✅ `13:44:02` e2e47-c signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:44:03` e2e47-c on C's tunnel: 200  
✅ `13:44:03` …from its backend  
✅ `13:44:03` e2e47-c on A's tunnel: 403  
✅ `13:44:03` …the domain refusal page  
✅ `13:44:03` …naming test.lamaste.local  
✅ `13:44:03` …never a redirect to a sign-in page (no login loop)  
✅ `13:44:03` e2e47-c on B's tunnel: 403  
✅ `13:44:03` …the domain refusal page  
✅ `13:44:03` …naming lamaste-second.local  
✅ `13:44:03` …never a redirect to a sign-in page (no login loop)  
✅ `13:44:03` e2e47-a's session of A opens nothing on C: to C's own sign-in page  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `62` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `62` |

ℹ️ `13:44:03` Cleaning up test resources...  
