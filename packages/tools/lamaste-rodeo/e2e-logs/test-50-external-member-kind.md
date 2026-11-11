# Lamaste E2E: 50 — External members: changing the kind (Three-VM)

> Started at `2026-11-11 11:26:46 UTC`


## Pre-flight

✅ `11:26:46` Onboarding is complete  
✅ `11:26:46` Agent test-agent is enrolled on the host  
✅ `11:26:46` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; a member, a member with an Authelia group, an external member

✅ `11:26:47` Domain lamaste-second.local added (201)  
✅ `11:26:47` …pending until activated  
✅ `11:26:47` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `11:26:47` …the one required record is auth.lamaste-second.local  
✅ `11:26:49` lamaste-second.local is active  
✅ `11:26:50` User e2e50-member created, member of lamaste-second.local  
✅ `11:26:51` User e2e50-grouped created, member of B, in the Authelia group e2e50team  
✅ `11:26:51` User e2e50-ext created, member of lamaste-second.local (external)  
✅ `11:26:51` Each has a directory id  

## An authenticated tunnel on B; its backend echoes the identity headers

✅ `11:26:55` Tunnel e2e50a.lamaste-second.local (authenticated), carried by test-agent  
✅ `11:26:59` Port 18501: the backend answers through chisel  
✅ `11:26:59` B's rules name its group key  
✅ `11:26:59` users.yml gives e2e50-member B's member group  

## Signed in at auth.B; Authelia's MainPID from here on

✅ `11:27:01` e2e50-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `11:27:03` e2e50-grouped signed in at auth.lamaste-second.local (password, TOTP)  
✅ `11:27:03` Authelia runs (MainPID 391128)  
✅ `11:27:04` e2e50-member on B's authenticated tunnel: 200  
✅ `11:27:04` …from its backend  

## Lamaste's own groups: in users.yml, never shown, never passed on

✅ `11:27:04` users.yml gives e2e50-grouped B's member group beside e2e50team  
✅ `11:27:04` …and keeps e2e50team  
✅ `11:27:04` GET /api/users lists e2e50-grouped's groups as e2e50team alone  
✅ `11:27:04` …and no user's list holds a group of Lamaste's (lamaste:… or a hostname)  
✅ `11:27:04` e2e50-grouped on the tunnel's /e2e-headers: 200  
✅ `11:27:04` …the backend is told the user  
✅ `11:27:04` …and Remote-Groups: e2e50team alone  
✅ `11:27:04` …no group of Lamaste's reaches a backend  

## e2e50-member turned external: the same session is refused

✅ `11:27:04` PUT /api/domains/B/members/e2e50-member {kind: external}  
✅ `11:27:05` …GET /api/users: an external member of B  
✅ `11:27:05` users.yml gives e2e50-member B's external group  
✅ `11:27:05` …in place of the member group  
✅ `11:27:05` e2e50-member's session of before on the authenticated tunnel: 403 within 30 s  
✅ `11:27:05` e2e50-member, external, on the authenticated tunnel: 403  
✅ `11:27:05` …the access-request page  
✅ `11:27:05` …not the domain refusal  
✅ `11:27:05` …never a redirect to a sign-in page  
✅ `11:27:05` Audited: directory.membership.changed member → external, by directory id  
✅ `11:27:06` …Authelia not restarted  

## Turned back: let through again

✅ `11:27:06` PUT /api/domains/B/members/e2e50-member {kind: member}  
✅ `11:27:06` users.yml gives e2e50-member B's member group again  
✅ `11:27:06` e2e50-member's session of before: 200 again — no new sign-in  
✅ `11:27:06` Audited: and back, external → member  
✅ `11:27:06` …Authelia not restarted  

## Refusals: an Authelia group and an external membership

✅ `11:27:06` e2e50-grouped, in e2e50team, made external: 409 external_member_groups  
✅ `11:27:07` …still a member of B  
✅ `11:27:07` e2e50team given to e2e50-ext, an external member: 409 external_member_groups  
✅ `11:27:07` …users.yml gives e2e50-ext B's external group alone  
✅ `11:27:07` A group named like a hostname: 400 reserved_group  
✅ `11:27:07` …or like Lamaste's own (lamaste:m:<key>): 400 reserved_group  
✅ `11:27:08` e2e50-grouped's groups are unchanged  
✅ `11:27:08` Authelia's MainPID is the one of before the first change  
✅ `11:27:08` Both sessions of before are still signed in at auth.lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `54` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `54` |

ℹ️ `11:27:08` Cleaning up test resources...  
