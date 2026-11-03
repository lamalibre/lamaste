# Lamaste E2E: 47 — Multi-domain relay: a third domain changes nothing else (Three-VM)

> Started at `2026-11-03 10:29:45 UTC`


## Pre-flight

✅ `10:29:45` Onboarding is complete  
✅ `10:29:45` Agent test-agent is enrolled on the host  
✅ `10:29:45` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## A member of A, a member of B, a tunnel on each

✅ `10:29:46` Domain lamaste-second.local added (201)  
✅ `10:29:46` …pending until activated  
✅ `10:29:46` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `10:29:46` …the one required record is auth.lamaste-second.local  
✅ `10:29:47` lamaste-second.local is active  
✅ `10:29:48` User e2e47-a created, member of test.lamaste.local  
✅ `10:29:48` User e2e47-b created, member of lamaste-second.local  
✅ `10:29:48` Both have a directory id  
✅ `10:29:50` Tunnel e2e47a.test.lamaste.local (authenticated), carried by test-agent  
✅ `10:29:52` Tunnel e2e47b.lamaste-second.local (authenticated), carried by test-agent  
✅ `10:29:55` Port 18471: the backend answers through chisel  
✅ `10:29:56` Port 18472: the backend answers through chisel  

## The snapshot: rules, members, reachability

✅ `10:29:56` A's rules admit A's member group  
✅ `10:29:56` B's rules admit B's member group  
✅ `10:29:56` …neither names a user  
✅ `10:29:57` users.yml gives e2e47-a A's member group  
✅ `10:29:57` …not B's  
✅ `10:29:57` users.yml gives e2e47-b B's member group  
✅ `10:29:57` …not A's  
✅ `10:29:59` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `10:30:01` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:30:03` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:30:33` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `10:30:33` Each reaches its own domain's tunnel and is refused on the other's  

## Domain C added and activated, with a member of its own and a tunnel

✅ `10:30:33` Domain lamaste-third.local added (201)  
✅ `10:30:33` …pending until activated  
✅ `10:30:33` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `10:30:33` …the one required record is auth.lamaste-third.local  
✅ `10:30:35` lamaste-third.local is active  
✅ `10:30:35` User e2e47-c created, member of lamaste-third.local  
✅ `10:30:35` e2e47-c has a directory id  
✅ `10:30:37` Tunnel e2e47c.lamaste-third.local (authenticated), carried by test-agent  
✅ `10:30:41` Port 18473: the backend answers through chisel  
✅ `10:30:41` Authelia holds a session cookie for C  

## A and B: the same rules, the same members, the same answers

✅ `10:30:41` A's rendered rules are byte-equal to the snapshot  
✅ `10:30:41` B's rendered rules are byte-equal to the snapshot  
✅ `10:30:41` A's member list is unchanged  
✅ `10:30:41` …and B's  
✅ `10:30:42` C has its one member  
✅ `10:30:42` e2e47-a's and e2e47-b's groups in users.yml are unchanged  
✅ `10:30:44` e2e47-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `10:31:02` e2e47-b signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:31:04` e2e47-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:31:33` e2e47-b signed in at auth.test.lamaste.local (password, TOTP)  
✅ `10:31:33` Signed in again: every request answers as before (a@e2e47a=200 a@e2e47b=403 b@e2e47a=403 b@e2e47b=200)  

## C's member: C's tunnel, refused on A and B

✅ `10:31:34` e2e47-c signed in at auth.lamaste-third.local (password, TOTP)  
✅ `10:32:02` e2e47-c signed in at auth.test.lamaste.local (password, TOTP)  
✅ `10:32:33` e2e47-c signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:32:33` e2e47-c on C's tunnel: 200  
✅ `10:32:33` …from its backend  
✅ `10:32:33` e2e47-c on A's tunnel: 403  
✅ `10:32:33` …the domain refusal page  
✅ `10:32:33` …naming test.lamaste.local  
✅ `10:32:33` …never a redirect to a sign-in page (no login loop)  
✅ `10:32:33` e2e47-c on B's tunnel: 403  
✅ `10:32:33` …the domain refusal page  
✅ `10:32:33` …naming lamaste-second.local  
✅ `10:32:33` …never a redirect to a sign-in page (no login loop)  
✅ `10:32:33` e2e47-a's session of A opens nothing on C: to C's own sign-in page  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `62` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `62` |

ℹ️ `10:32:33` Cleaning up test resources...  
