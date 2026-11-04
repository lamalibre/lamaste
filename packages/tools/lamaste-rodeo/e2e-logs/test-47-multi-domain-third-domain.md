# Lamaste E2E: 47 — Multi-domain relay: a third domain changes nothing else (Three-VM)

> Started at `2026-11-04 14:33:16 UTC`


## Pre-flight

✅ `14:33:16` Onboarding is complete  
✅ `14:33:16` Agent test-agent is enrolled on the host  
✅ `14:33:16` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## A member of A, a member of B, a tunnel on each

✅ `14:33:17` Domain lamaste-second.local added (201)  
✅ `14:33:17` …pending until activated  
✅ `14:33:17` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:33:17` …the one required record is auth.lamaste-second.local  
✅ `14:33:18` lamaste-second.local is active  
✅ `14:33:19` User e2e47-a created, member of test.lamaste.local  
✅ `14:33:20` User e2e47-b created, member of lamaste-second.local  
✅ `14:33:20` Both have a directory id  
✅ `14:33:21` Tunnel e2e47a.test.lamaste.local (authenticated), carried by test-agent  
✅ `14:33:23` Tunnel e2e47b.lamaste-second.local (authenticated), carried by test-agent  
✅ `14:33:27` Port 18471: the backend answers through chisel  
✅ `14:33:27` Port 18472: the backend answers through chisel  

## The snapshot: rules, members, reachability

✅ `14:33:28` A's rules admit A's member group  
✅ `14:33:28` B's rules admit B's member group  
✅ `14:33:28` …neither names a user  
✅ `14:33:29` users.yml gives e2e47-a A's member group  
✅ `14:33:29` …not B's  
✅ `14:33:29` users.yml gives e2e47-b B's member group  
✅ `14:33:29` …not A's  
✅ `14:33:31` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:33:33` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:34:03` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:34:04` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:34:05` Each reaches its own domain's tunnel and is refused on the other's  

## Domain C added and activated, with a member of its own and a tunnel

✅ `14:34:05` Domain lamaste-third.local added (201)  
✅ `14:34:05` …pending until activated  
✅ `14:34:05` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `14:34:05` …the one required record is auth.lamaste-third.local  
✅ `14:34:07` lamaste-third.local is active  
✅ `14:34:08` User e2e47-c created, member of lamaste-third.local  
✅ `14:34:09` e2e47-c has a directory id  
✅ `14:34:11` Tunnel e2e47c.lamaste-third.local (authenticated), carried by test-agent  
✅ `14:34:15` Port 18473: the backend answers through chisel  
✅ `14:34:15` Authelia holds a session cookie for C  

## A and B: the same rules, the same members, the same answers

✅ `14:34:16` A's rendered rules are byte-equal to the snapshot  
✅ `14:34:16` B's rendered rules are byte-equal to the snapshot  
✅ `14:34:16` A's member list is unchanged  
✅ `14:34:16` …and B's  
✅ `14:34:16` C has its one member  
✅ `14:34:17` e2e47-a's and e2e47-b's groups in users.yml are unchanged  
✅ `14:34:33` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:34:34` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:35:02` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:35:04` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:35:04` Signed in again: every request answers as before (a@e2e47a=200 a@e2e47b=403 b@e2e47a=403 b@e2e47b=200)  

## C's member: C's tunnel, refused on A and B

✅ `14:35:05` e2e47-c signed in at auth.lamaste-third.local (password, TOTP)  
✅ `14:35:32` e2e47-c signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:36:02` e2e47-c signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:36:02` e2e47-c on C's tunnel: 200  
✅ `14:36:02` …from its backend  
✅ `14:36:02` e2e47-c on A's tunnel: 403  
✅ `14:36:02` …the domain refusal page  
✅ `14:36:02` …naming test.lamaste.local  
✅ `14:36:02` …never a redirect to a sign-in page (no login loop)  
✅ `14:36:03` e2e47-c on B's tunnel: 403  
✅ `14:36:03` …the domain refusal page  
✅ `14:36:03` …naming lamaste-second.local  
✅ `14:36:03` …never a redirect to a sign-in page (no login loop)  
✅ `14:36:03` e2e47-a's session of A opens nothing on C: to C's own sign-in page  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `62` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `62` |

ℹ️ `14:36:03` Cleaning up test resources...  
