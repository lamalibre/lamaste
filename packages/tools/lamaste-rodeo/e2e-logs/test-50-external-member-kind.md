# Lamaste E2E: 50 — External members: changing the kind (Three-VM)

> Started at `2026-11-10 14:13:38 UTC`


## Pre-flight

✅ `14:13:38` Onboarding is complete  
✅ `14:13:38` Agent test-agent is enrolled on the host  
✅ `14:13:38` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; a member, a member with an Authelia group, an external member

✅ `14:13:39` Domain lamaste-second.local added (201)  
✅ `14:13:39` …pending until activated  
✅ `14:13:39` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:13:39` …the one required record is auth.lamaste-second.local  
✅ `14:13:41` lamaste-second.local is active  
✅ `14:13:42` User e2e50-member created, member of lamaste-second.local  
✅ `14:13:43` User e2e50-grouped created, member of B, in the Authelia group e2e50team  
✅ `14:13:45` User e2e50-ext created, member of lamaste-second.local (external)  
✅ `14:13:45` Each has a directory id  

## An authenticated tunnel on B; its backend echoes the identity headers

✅ `14:13:47` Tunnel e2e50a.lamaste-second.local (authenticated), carried by test-agent  
✅ `14:13:51` Port 18501: the backend answers through chisel  
✅ `14:13:52` B's rules name its group key  
✅ `14:13:52` users.yml gives e2e50-member B's member group  

## Signed in at auth.B; Authelia's MainPID from here on

✅ `14:13:54` e2e50-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:13:56` e2e50-grouped signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:13:57` Authelia runs (MainPID 158497)  
✅ `14:13:57` e2e50-member on B's authenticated tunnel: 200  
✅ `14:13:57` …from its backend  

## Lamaste's own groups: in users.yml, never shown, never passed on

✅ `14:13:58` users.yml gives e2e50-grouped B's member group beside e2e50team  
✅ `14:13:58` …and keeps e2e50team  
✅ `14:13:58` GET /api/users lists e2e50-grouped's groups as e2e50team alone  
✅ `14:13:58` …and no user's list holds a group of Lamaste's (lamaste:… or a hostname)  
✅ `14:13:59` e2e50-grouped on the tunnel's /e2e-headers: 200  
✅ `14:13:59` …the backend is told the user  
✅ `14:13:59` …and Remote-Groups: e2e50team alone  
✅ `14:13:59` …no group of Lamaste's reaches a backend  

## e2e50-member turned external: the same session is refused

✅ `14:14:00` PUT /api/domains/B/members/e2e50-member {kind: external}  
✅ `14:14:00` …GET /api/users: an external member of B  
✅ `14:14:00` users.yml gives e2e50-member B's external group  
✅ `14:14:00` …in place of the member group  
✅ `14:14:01` e2e50-member's session of before on the authenticated tunnel: 403 within 30 s  
✅ `14:14:01` e2e50-member, external, on the authenticated tunnel: 403  
✅ `14:14:01` …the access-request page  
✅ `14:14:01` …not the domain refusal  
✅ `14:14:01` …never a redirect to a sign-in page  
✅ `14:14:01` Audited: directory.membership.changed member → external, by directory id  
✅ `14:14:02` …Authelia not restarted  

## Turned back: let through again

✅ `14:14:02` PUT /api/domains/B/members/e2e50-member {kind: member}  
✅ `14:14:02` users.yml gives e2e50-member B's member group again  
✅ `14:14:02` e2e50-member's session of before: 200 again — no new sign-in  
✅ `14:14:03` Audited: and back, external → member  
✅ `14:14:03` …Authelia not restarted  

## Refusals: an Authelia group and an external membership

✅ `14:14:03` e2e50-grouped, in e2e50team, made external: 409 external_member_groups  
✅ `14:14:03` …still a member of B  
✅ `14:14:04` e2e50team given to e2e50-ext, an external member: 409 external_member_groups  
✅ `14:14:04` …users.yml gives e2e50-ext B's external group alone  
✅ `14:14:04` A group named like a hostname: 400 reserved_group  
✅ `14:14:05` …or like Lamaste's own (lamaste:m:<key>): 400 reserved_group  
✅ `14:14:05` e2e50-grouped's groups are unchanged  
✅ `14:14:05` Authelia's MainPID is the one of before the first change  
✅ `14:14:05` Both sessions of before are still signed in at auth.lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `54` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `54` |

ℹ️ `14:14:05` Cleaning up test resources...  
