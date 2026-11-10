# Lamaste E2E: 47 — Multi-domain relay: a third domain changes nothing else (Three-VM)

> Started at `2026-11-10 14:06:47 UTC`


## Pre-flight

✅ `14:06:47` Onboarding is complete  
✅ `14:06:48` Agent test-agent is enrolled on the host  
✅ `14:06:48` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## A member of A, a member of B, a tunnel on each

✅ `14:06:49` Domain lamaste-second.local added (201)  
✅ `14:06:49` …pending until activated  
✅ `14:06:49` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:06:49` …the one required record is auth.lamaste-second.local  
✅ `14:06:50` lamaste-second.local is active  
✅ `14:06:51` User e2e47-a created, member of test.lamaste.local  
✅ `14:06:52` User e2e47-b created, member of lamaste-second.local  
✅ `14:06:52` Both have a directory id  
✅ `14:06:54` Tunnel e2e47a.test.lamaste.local (authenticated), carried by test-agent  
✅ `14:06:57` Tunnel e2e47b.lamaste-second.local (authenticated), carried by test-agent  
✅ `14:07:01` Port 18471: the backend answers through chisel  
✅ `14:07:01` Port 18472: the backend answers through chisel  

## The snapshot: rules, members, reachability

✅ `14:07:02` A's rules admit A's member group  
✅ `14:07:02` B's rules admit B's member group  
✅ `14:07:02` …neither names a user  
✅ `14:07:02` users.yml gives e2e47-a A's member group  
✅ `14:07:02` …not B's  
✅ `14:07:03` users.yml gives e2e47-b B's member group  
✅ `14:07:03` …not A's  
✅ `14:07:05` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:07:07` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:07:33` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:07:34` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:07:35` Each reaches its own domain's tunnel and is refused on the other's  

## Domain C added and activated, with a member of its own and a tunnel

✅ `14:07:36` Domain lamaste-third.local added (201)  
✅ `14:07:36` …pending until activated  
✅ `14:07:36` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `14:07:36` …the one required record is auth.lamaste-third.local  
✅ `14:07:37` lamaste-third.local is active  
✅ `14:07:38` User e2e47-c created, member of lamaste-third.local  
✅ `14:07:38` e2e47-c has a directory id  
✅ `14:07:40` Tunnel e2e47c.lamaste-third.local (authenticated), carried by test-agent  
✅ `14:07:44` Port 18473: the backend answers through chisel  
✅ `14:07:44` Authelia holds a session cookie for C  

## A and B: the same rules, the same members, the same answers

✅ `14:07:44` A's rendered rules are byte-equal to the snapshot  
✅ `14:07:45` B's rendered rules are byte-equal to the snapshot  
✅ `14:07:45` A's member list is unchanged  
✅ `14:07:45` …and B's  
✅ `14:07:45` C has its one member  
✅ `14:07:46` e2e47-a's and e2e47-b's groups in users.yml are unchanged  
✅ `14:08:03` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:08:05` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:08:33` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:08:35` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:08:35` Signed in again: every request answers as before (a@e2e47a=200 a@e2e47b=403 b@e2e47a=403 b@e2e47b=200)  

## C's member: C's tunnel, refused on A and B

✅ `14:08:37` e2e47-c signed in at auth.lamaste-third.local (password, TOTP)  
✅ `14:09:03` e2e47-c signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:09:33` e2e47-c signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:09:33` e2e47-c on C's tunnel: 200  
✅ `14:09:33` …from its backend  
✅ `14:09:33` e2e47-c on A's tunnel: 403  
✅ `14:09:33` …the domain refusal page  
✅ `14:09:33` …naming test.lamaste.local  
✅ `14:09:33` …never a redirect to a sign-in page (no login loop)  
✅ `14:09:33` e2e47-c on B's tunnel: 403  
✅ `14:09:33` …the domain refusal page  
✅ `14:09:33` …naming lamaste-second.local  
✅ `14:09:33` …never a redirect to a sign-in page (no login loop)  
✅ `14:09:34` e2e47-a's session of A opens nothing on C: to C's own sign-in page  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `62` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `62` |

ℹ️ `14:09:34` Cleaning up test resources...  
