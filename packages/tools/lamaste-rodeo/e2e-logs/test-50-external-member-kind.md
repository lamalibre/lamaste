# Lamaste E2E: 50 — External members: changing the kind (Three-VM)

> Started at `2026-11-03 10:36:30 UTC`


## Pre-flight

✅ `10:36:31` Onboarding is complete  
✅ `10:36:31` Agent test-agent is enrolled on the host  
✅ `10:36:31` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; a member, a member with an Authelia group, an external member

✅ `10:36:32` Domain lamaste-second.local added (201)  
✅ `10:36:32` …pending until activated  
✅ `10:36:32` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `10:36:32` …the one required record is auth.lamaste-second.local  
✅ `10:36:33` lamaste-second.local is active  
✅ `10:36:34` User e2e50-member created, member of lamaste-second.local  
✅ `10:36:34` User e2e50-grouped created, member of B, in the Authelia group e2e50team  
✅ `10:36:35` User e2e50-ext created, member of lamaste-second.local (external)  
✅ `10:36:35` Each has a directory id  

## An authenticated tunnel on B; its backend echoes the identity headers

✅ `10:36:37` Tunnel e2e50a.lamaste-second.local (authenticated), carried by test-agent  
✅ `10:36:41` Port 18501: the backend answers through chisel  
✅ `10:36:41` B's rules name its group key  
✅ `10:36:41` users.yml gives e2e50-member B's member group  

## Signed in at auth.B; Authelia's MainPID from here on

✅ `10:36:44` e2e50-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:36:46` e2e50-grouped signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:36:46` Authelia runs (MainPID 158196)  
✅ `10:36:47` e2e50-member on B's authenticated tunnel: 200  
✅ `10:36:47` …from its backend  

## Lamaste's own groups: in users.yml, never shown, never passed on

✅ `10:36:47` users.yml gives e2e50-grouped B's member group beside e2e50team  
✅ `10:36:47` …and keeps e2e50team  
✅ `10:36:47` GET /api/users lists e2e50-grouped's groups as e2e50team alone  
✅ `10:36:47` …and no user's list holds a group of Lamaste's (lamaste:… or a hostname)  
✅ `10:36:47` e2e50-grouped on the tunnel's /e2e-headers: 200  
✅ `10:36:47` …the backend is told the user  
✅ `10:36:47` …and Remote-Groups: e2e50team alone  
✅ `10:36:47` …no group of Lamaste's reaches a backend  

## e2e50-member turned external: the same session is refused

✅ `10:36:47` PUT /api/domains/B/members/e2e50-member {kind: external}  
✅ `10:36:48` …GET /api/users: an external member of B  
✅ `10:36:48` users.yml gives e2e50-member B's external group  
✅ `10:36:48` …in place of the member group  
✅ `10:36:48` e2e50-member's session of before on the authenticated tunnel: 403 within 30 s  
✅ `10:36:48` e2e50-member, external, on the authenticated tunnel: 403  
✅ `10:36:48` …the access-request page  
✅ `10:36:48` …not the domain refusal  
✅ `10:36:48` …never a redirect to a sign-in page  
✅ `10:36:48` Audited: directory.membership.changed member → external, by directory id  
✅ `10:36:48` …Authelia not restarted  

## Turned back: let through again

✅ `10:36:48` PUT /api/domains/B/members/e2e50-member {kind: member}  
✅ `10:36:48` users.yml gives e2e50-member B's member group again  
✅ `10:36:52` e2e50-member's session of before: 200 again — no new sign-in  
✅ `10:36:52` Audited: and back, external → member  
✅ `10:36:52` …Authelia not restarted  

## Refusals: an Authelia group and an external membership

✅ `10:36:52` e2e50-grouped, in e2e50team, made external: 409 external_member_groups  
✅ `10:36:52` …still a member of B  
✅ `10:36:52` e2e50team given to e2e50-ext, an external member: 409 external_member_groups  
✅ `10:36:53` …users.yml gives e2e50-ext B's external group alone  
✅ `10:36:53` A group named like a hostname: 400 reserved_group  
✅ `10:36:53` …or like Lamaste's own (lamaste:m:<key>): 400 reserved_group  
✅ `10:36:53` e2e50-grouped's groups are unchanged  
✅ `10:36:53` Authelia's MainPID is the one of before the first change  
✅ `10:36:53` Both sessions of before are still signed in at auth.lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `54` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `54` |

ℹ️ `10:36:53` Cleaning up test resources...  
