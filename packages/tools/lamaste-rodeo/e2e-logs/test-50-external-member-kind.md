# Lamaste E2E: 50 — External members: changing the kind (Three-VM)

> Started at `2026-11-10 18:56:52 UTC`


## Pre-flight

✅ `18:56:52` Onboarding is complete  
✅ `18:56:52` Agent test-agent is enrolled on the host  
✅ `18:56:52` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; a member, a member with an Authelia group, an external member

✅ `18:56:53` Domain lamaste-second.local added (201)  
✅ `18:56:53` …pending until activated  
✅ `18:56:53` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `18:56:53` …the one required record is auth.lamaste-second.local  
✅ `18:56:55` lamaste-second.local is active  
✅ `18:56:56` User e2e50-member created, member of lamaste-second.local  
✅ `18:56:56` User e2e50-grouped created, member of B, in the Authelia group e2e50team  
✅ `18:56:57` User e2e50-ext created, member of lamaste-second.local (external)  
✅ `18:56:57` Each has a directory id  

## An authenticated tunnel on B; its backend echoes the identity headers

✅ `18:56:59` Tunnel e2e50a.lamaste-second.local (authenticated), carried by test-agent  
✅ `18:57:03` Port 18501: the backend answers through chisel  
✅ `18:57:04` B's rules name its group key  
✅ `18:57:04` users.yml gives e2e50-member B's member group  

## Signed in at auth.B; Authelia's MainPID from here on

✅ `18:57:06` e2e50-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:57:08` e2e50-grouped signed in at auth.lamaste-second.local (password, TOTP)  
✅ `18:57:08` Authelia runs (MainPID 162871)  
✅ `18:57:08` e2e50-member on B's authenticated tunnel: 200  
✅ `18:57:08` …from its backend  

## Lamaste's own groups: in users.yml, never shown, never passed on

✅ `18:57:09` users.yml gives e2e50-grouped B's member group beside e2e50team  
✅ `18:57:09` …and keeps e2e50team  
✅ `18:57:09` GET /api/users lists e2e50-grouped's groups as e2e50team alone  
✅ `18:57:09` …and no user's list holds a group of Lamaste's (lamaste:… or a hostname)  
✅ `18:57:09` e2e50-grouped on the tunnel's /e2e-headers: 200  
✅ `18:57:09` …the backend is told the user  
✅ `18:57:09` …and Remote-Groups: e2e50team alone  
✅ `18:57:09` …no group of Lamaste's reaches a backend  

## e2e50-member turned external: the same session is refused

✅ `18:57:09` PUT /api/domains/B/members/e2e50-member {kind: external}  
✅ `18:57:09` …GET /api/users: an external member of B  
✅ `18:57:10` users.yml gives e2e50-member B's external group  
✅ `18:57:10` …in place of the member group  
✅ `18:57:10` e2e50-member's session of before on the authenticated tunnel: 403 within 30 s  
✅ `18:57:10` e2e50-member, external, on the authenticated tunnel: 403  
✅ `18:57:10` …the access-request page  
✅ `18:57:10` …not the domain refusal  
✅ `18:57:10` …never a redirect to a sign-in page  
✅ `18:57:10` Audited: directory.membership.changed member → external, by directory id  
✅ `18:57:10` …Authelia not restarted  

## Turned back: let through again

✅ `18:57:11` PUT /api/domains/B/members/e2e50-member {kind: member}  
✅ `18:57:11` users.yml gives e2e50-member B's member group again  
✅ `18:57:11` e2e50-member's session of before: 200 again — no new sign-in  
✅ `18:57:11` Audited: and back, external → member  
✅ `18:57:11` …Authelia not restarted  

## Refusals: an Authelia group and an external membership

✅ `18:57:11` e2e50-grouped, in e2e50team, made external: 409 external_member_groups  
✅ `18:57:12` …still a member of B  
✅ `18:57:12` e2e50team given to e2e50-ext, an external member: 409 external_member_groups  
✅ `18:57:12` …users.yml gives e2e50-ext B's external group alone  
✅ `18:57:12` A group named like a hostname: 400 reserved_group  
✅ `18:57:12` …or like Lamaste's own (lamaste:m:<key>): 400 reserved_group  
✅ `18:57:12` e2e50-grouped's groups are unchanged  
✅ `18:57:13` Authelia's MainPID is the one of before the first change  
✅ `18:57:13` Both sessions of before are still signed in at auth.lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `54` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `54` |

ℹ️ `18:57:13` Cleaning up test resources...  
