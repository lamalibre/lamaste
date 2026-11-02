# Lamaste E2E: 47 — Multi-domain relay: a third domain changes nothing else (Three-VM)

> Started at `2026-11-02 16:46:15 UTC`


## Pre-flight

✅ `16:46:16` Onboarding is complete  
✅ `16:46:16` Agent test-agent is enrolled on the host  
✅ `16:46:16` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## A member of A, a member of B, a tunnel on each

✅ `16:46:17` Domain lamaste-second.local added (201)  
✅ `16:46:17` …pending until activated  
✅ `16:46:17` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `16:46:17` …the one required record is auth.lamaste-second.local  
✅ `16:46:18` lamaste-second.local is active  
✅ `16:46:19` User e2e47-a created, member of test.lamaste.local  
✅ `16:46:20` User e2e47-b created, member of lamaste-second.local  
✅ `16:46:20` Both have a directory id  
✅ `16:46:22` Tunnel e2e47a.test.lamaste.local (authenticated), carried by test-agent  
✅ `16:46:24` Tunnel e2e47b.lamaste-second.local (authenticated), carried by test-agent  
✅ `16:46:28` Port 18471: the backend answers through chisel  
✅ `16:46:28` Port 18472: the backend answers through chisel  

## The snapshot: rules, members, reachability

✅ `16:46:29` A's rules admit A's member group  
✅ `16:46:29` B's rules admit B's member group  
✅ `16:46:29` …neither names a user  
✅ `16:46:30` users.yml gives e2e47-a A's member group  
✅ `16:46:30` …not B's  
✅ `16:46:30` users.yml gives e2e47-b B's member group  
✅ `16:46:30` …not A's  
✅ `16:46:32` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `16:46:34` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:47:02` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:47:03` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `16:47:03` Each reaches its own domain's tunnel and is refused on the other's  

## Domain C added and activated, with a member of its own and a tunnel

✅ `16:47:04` Domain lamaste-third.local added (201)  
✅ `16:47:04` …pending until activated  
✅ `16:47:04` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `16:47:04` …the one required record is auth.lamaste-third.local  
✅ `16:47:06` lamaste-third.local is active  
✅ `16:47:07` User e2e47-c created, member of lamaste-third.local  
✅ `16:47:07` e2e47-c has a directory id  
✅ `16:47:08` Tunnel e2e47c.lamaste-third.local (authenticated), carried by test-agent  
✅ `16:47:12` Port 18473: the backend answers through chisel  
✅ `16:47:12` Authelia holds a session cookie for C  

## A and B: the same rules, the same members, the same answers

✅ `16:47:12` A's rendered rules are byte-equal to the snapshot  
✅ `16:47:12` B's rendered rules are byte-equal to the snapshot  
✅ `16:47:12` A's member list is unchanged  
✅ `16:47:13` …and B's  
✅ `16:47:13` C has its one member  
✅ `16:47:13` e2e47-a's and e2e47-b's groups in users.yml are unchanged  
✅ `16:47:32` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `16:47:34` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:48:03` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:48:04` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `16:48:05` Signed in again: every request answers as before (a@e2e47a=200 a@e2e47b=403 b@e2e47a=403 b@e2e47b=200)  

## C's member: C's tunnel, refused on A and B

✅ `16:48:06` e2e47-c signed in at auth.lamaste-third.local (password, TOTP)  
✅ `16:48:32` e2e47-c signed in at auth.test.lamaste.local (password, TOTP)  
✅ `16:49:02` e2e47-c signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:49:03` e2e47-c on C's tunnel: 200  
✅ `16:49:03` …from its backend  
✅ `16:49:03` e2e47-c on A's tunnel: 403  
✅ `16:49:03` …the domain refusal page  
✅ `16:49:03` …naming test.lamaste.local  
✅ `16:49:03` …never a redirect to a sign-in page (no login loop)  
✅ `16:49:03` e2e47-c on B's tunnel: 403  
✅ `16:49:03` …the domain refusal page  
✅ `16:49:03` …naming lamaste-second.local  
✅ `16:49:03` …never a redirect to a sign-in page (no login loop)  
✅ `16:49:03` e2e47-a's session of A opens nothing on C: to C's own sign-in page  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `62` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `62` |

ℹ️ `16:49:03` Cleaning up test resources...  
