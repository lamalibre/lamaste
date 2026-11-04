# Lamaste E2E: 50 — External members: changing the kind (Three-VM)

> Started at `2026-11-04 14:40:04 UTC`


## Pre-flight

✅ `14:40:04` Onboarding is complete  
✅ `14:40:04` Agent test-agent is enrolled on the host  
✅ `14:40:05` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; a member, a member with an Authelia group, an external member

✅ `14:40:06` Domain lamaste-second.local added (201)  
✅ `14:40:06` …pending until activated  
✅ `14:40:06` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:40:06` …the one required record is auth.lamaste-second.local  
✅ `14:40:08` lamaste-second.local is active  
✅ `14:40:09` User e2e50-member created, member of lamaste-second.local  
✅ `14:40:10` User e2e50-grouped created, member of B, in the Authelia group e2e50team  
✅ `14:40:11` User e2e50-ext created, member of lamaste-second.local (external)  
✅ `14:40:11` Each has a directory id  

## An authenticated tunnel on B; its backend echoes the identity headers

✅ `14:40:14` Tunnel e2e50a.lamaste-second.local (authenticated), carried by test-agent  
✅ `14:40:19` Port 18501: the backend answers through chisel  
✅ `14:40:19` B's rules name its group key  
✅ `14:40:20` users.yml gives e2e50-member B's member group  

## Signed in at auth.B; Authelia's MainPID from here on

✅ `14:40:23` e2e50-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:40:25` e2e50-grouped signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:40:25` Authelia runs (MainPID 151695)  
✅ `14:40:25` e2e50-member on B's authenticated tunnel: 200  
✅ `14:40:25` …from its backend  

## Lamaste's own groups: in users.yml, never shown, never passed on

✅ `14:40:25` users.yml gives e2e50-grouped B's member group beside e2e50team  
✅ `14:40:26` …and keeps e2e50team  
✅ `14:40:26` GET /api/users lists e2e50-grouped's groups as e2e50team alone  
✅ `14:40:26` …and no user's list holds a group of Lamaste's (lamaste:… or a hostname)  
✅ `14:40:26` e2e50-grouped on the tunnel's /e2e-headers: 200  
✅ `14:40:26` …the backend is told the user  
✅ `14:40:26` …and Remote-Groups: e2e50team alone  
✅ `14:40:26` …no group of Lamaste's reaches a backend  

## e2e50-member turned external: the same session is refused

✅ `14:40:26` PUT /api/domains/B/members/e2e50-member {kind: external}  
✅ `14:40:27` …GET /api/users: an external member of B  
✅ `14:40:27` users.yml gives e2e50-member B's external group  
✅ `14:40:27` …in place of the member group  
✅ `14:40:27` e2e50-member's session of before on the authenticated tunnel: 403 within 30 s  
✅ `14:40:28` e2e50-member, external, on the authenticated tunnel: 403  
✅ `14:40:28` …the access-request page  
✅ `14:40:28` …not the domain refusal  
✅ `14:40:28` …never a redirect to a sign-in page  
✅ `14:40:28` Audited: directory.membership.changed member → external, by directory id  
✅ `14:40:28` …Authelia not restarted  

## Turned back: let through again

✅ `14:40:28` PUT /api/domains/B/members/e2e50-member {kind: member}  
✅ `14:40:28` users.yml gives e2e50-member B's member group again  
✅ `14:40:29` e2e50-member's session of before: 200 again — no new sign-in  
✅ `14:40:29` Audited: and back, external → member  
✅ `14:40:29` …Authelia not restarted  

## Refusals: an Authelia group and an external membership

✅ `14:40:29` e2e50-grouped, in e2e50team, made external: 409 external_member_groups  
✅ `14:40:29` …still a member of B  
✅ `14:40:30` e2e50team given to e2e50-ext, an external member: 409 external_member_groups  
✅ `14:40:30` …users.yml gives e2e50-ext B's external group alone  
✅ `14:40:30` A group named like a hostname: 400 reserved_group  
✅ `14:40:30` …or like Lamaste's own (lamaste:m:<key>): 400 reserved_group  
✅ `14:40:31` e2e50-grouped's groups are unchanged  
✅ `14:40:31` Authelia's MainPID is the one of before the first change  
✅ `14:40:31` Both sessions of before are still signed in at auth.lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `54` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `54` |

ℹ️ `14:40:31` Cleaning up test resources...  
