# Lamaste E2E: 50 — External members: changing the kind (Three-VM)

> Started at `2026-11-09 13:47:54 UTC`


## Pre-flight

✅ `13:47:55` Onboarding is complete  
✅ `13:47:55` Agent test-agent is enrolled on the host  
✅ `13:47:55` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; a member, a member with an Authelia group, an external member

✅ `13:47:55` Domain lamaste-second.local added (201)  
✅ `13:47:55` …pending until activated  
✅ `13:47:56` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `13:47:56` …the one required record is auth.lamaste-second.local  
✅ `13:47:57` lamaste-second.local is active  
✅ `13:47:58` User e2e50-member created, member of lamaste-second.local  
✅ `13:47:58` User e2e50-grouped created, member of B, in the Authelia group e2e50team  
✅ `13:47:59` User e2e50-ext created, member of lamaste-second.local (external)  
✅ `13:47:59` Each has a directory id  

## An authenticated tunnel on B; its backend echoes the identity headers

✅ `13:48:00` Tunnel e2e50a.lamaste-second.local (authenticated), carried by test-agent  
✅ `13:48:04` Port 18501: the backend answers through chisel  
✅ `13:48:04` B's rules name its group key  
✅ `13:48:04` users.yml gives e2e50-member B's member group  

## Signed in at auth.B; Authelia's MainPID from here on

✅ `13:48:06` e2e50-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:48:08` e2e50-grouped signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:48:08` Authelia runs (MainPID 158935)  
✅ `13:48:08` e2e50-member on B's authenticated tunnel: 200  
✅ `13:48:08` …from its backend  

## Lamaste's own groups: in users.yml, never shown, never passed on

✅ `13:48:08` users.yml gives e2e50-grouped B's member group beside e2e50team  
✅ `13:48:08` …and keeps e2e50team  
✅ `13:48:09` GET /api/users lists e2e50-grouped's groups as e2e50team alone  
✅ `13:48:09` …and no user's list holds a group of Lamaste's (lamaste:… or a hostname)  
✅ `13:48:09` e2e50-grouped on the tunnel's /e2e-headers: 200  
✅ `13:48:09` …the backend is told the user  
✅ `13:48:09` …and Remote-Groups: e2e50team alone  
✅ `13:48:09` …no group of Lamaste's reaches a backend  

## e2e50-member turned external: the same session is refused

✅ `13:48:09` PUT /api/domains/B/members/e2e50-member {kind: external}  
✅ `13:48:09` …GET /api/users: an external member of B  
✅ `13:48:09` users.yml gives e2e50-member B's external group  
✅ `13:48:09` …in place of the member group  
✅ `13:48:09` e2e50-member's session of before on the authenticated tunnel: 403 within 30 s  
✅ `13:48:09` e2e50-member, external, on the authenticated tunnel: 403  
✅ `13:48:09` …the access-request page  
✅ `13:48:09` …not the domain refusal  
✅ `13:48:09` …never a redirect to a sign-in page  
✅ `13:48:09` Audited: directory.membership.changed member → external, by directory id  
✅ `13:48:10` …Authelia not restarted  

## Turned back: let through again

✅ `13:48:10` PUT /api/domains/B/members/e2e50-member {kind: member}  
✅ `13:48:10` users.yml gives e2e50-member B's member group again  
✅ `13:48:13` e2e50-member's session of before: 200 again — no new sign-in  
✅ `13:48:13` Audited: and back, external → member  
✅ `13:48:13` …Authelia not restarted  

## Refusals: an Authelia group and an external membership

✅ `13:48:13` e2e50-grouped, in e2e50team, made external: 409 external_member_groups  
✅ `13:48:14` …still a member of B  
✅ `13:48:14` e2e50team given to e2e50-ext, an external member: 409 external_member_groups  
✅ `13:48:14` …users.yml gives e2e50-ext B's external group alone  
✅ `13:48:14` A group named like a hostname: 400 reserved_group  
✅ `13:48:14` …or like Lamaste's own (lamaste:m:<key>): 400 reserved_group  
✅ `13:48:14` e2e50-grouped's groups are unchanged  
✅ `13:48:14` Authelia's MainPID is the one of before the first change  
✅ `13:48:14` Both sessions of before are still signed in at auth.lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `54` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `54` |

ℹ️ `13:48:14` Cleaning up test resources...  
