# Lamaste E2E: 50 — External members: changing the kind (Three-VM)

> Started at `2026-11-02 16:52:44 UTC`


## Pre-flight

✅ `16:52:44` Onboarding is complete  
✅ `16:52:45` Agent test-agent is enrolled on the host  
✅ `16:52:45` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domain B; a member, a member with an Authelia group, an external member

✅ `16:52:45` Domain lamaste-second.local added (201)  
✅ `16:52:45` …pending until activated  
✅ `16:52:45` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `16:52:45` …the one required record is auth.lamaste-second.local  
✅ `16:52:47` lamaste-second.local is active  
✅ `16:52:48` User e2e50-member created, member of lamaste-second.local  
✅ `16:52:48` User e2e50-grouped created, member of B, in the Authelia group e2e50team  
✅ `16:52:49` User e2e50-ext created, member of lamaste-second.local (external)  
✅ `16:52:49` Each has a directory id  

## An authenticated tunnel on B; its backend echoes the identity headers

✅ `16:52:51` Tunnel e2e50a.lamaste-second.local (authenticated), carried by test-agent  
✅ `16:52:54` Port 18501: the backend answers through chisel  
✅ `16:52:55` B's rules name its group key  
✅ `16:52:55` users.yml gives e2e50-member B's member group  

## Signed in at auth.B; Authelia's MainPID from here on

✅ `16:52:57` e2e50-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:52:58` e2e50-grouped signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:52:59` Authelia runs (MainPID 153240)  
✅ `16:52:59` e2e50-member on B's authenticated tunnel: 200  
✅ `16:52:59` …from its backend  

## Lamaste's own groups: in users.yml, never shown, never passed on

✅ `16:52:59` users.yml gives e2e50-grouped B's member group beside e2e50team  
✅ `16:52:59` …and keeps e2e50team  
✅ `16:52:59` GET /api/users lists e2e50-grouped's groups as e2e50team alone  
✅ `16:52:59` …and no user's list holds a group of Lamaste's (lamaste:… or a hostname)  
✅ `16:52:59` e2e50-grouped on the tunnel's /e2e-headers: 200  
✅ `16:52:59` …the backend is told the user  
✅ `16:52:59` …and Remote-Groups: e2e50team alone  
✅ `16:52:59` …no group of Lamaste's reaches a backend  

## e2e50-member turned external: the same session is refused

✅ `16:52:59` PUT /api/domains/B/members/e2e50-member {kind: external}  
✅ `16:53:00` …GET /api/users: an external member of B  
✅ `16:53:00` users.yml gives e2e50-member B's external group  
✅ `16:53:00` …in place of the member group  
✅ `16:53:00` e2e50-member's session of before on the authenticated tunnel: 403 within 30 s  
✅ `16:53:00` e2e50-member, external, on the authenticated tunnel: 403  
✅ `16:53:00` …the access-request page  
✅ `16:53:00` …not the domain refusal  
✅ `16:53:00` …never a redirect to a sign-in page  
✅ `16:53:00` Audited: directory.membership.changed member → external, by directory id  
✅ `16:53:00` …Authelia not restarted  

## Turned back: let through again

✅ `16:53:00` PUT /api/domains/B/members/e2e50-member {kind: member}  
✅ `16:53:01` users.yml gives e2e50-member B's member group again  
✅ `16:53:04` e2e50-member's session of before: 200 again — no new sign-in  
✅ `16:53:04` Audited: and back, external → member  
✅ `16:53:04` …Authelia not restarted  

## Refusals: an Authelia group and an external membership

✅ `16:53:05` e2e50-grouped, in e2e50team, made external: 409 external_member_groups  
✅ `16:53:05` …still a member of B  
✅ `16:53:05` e2e50team given to e2e50-ext, an external member: 409 external_member_groups  
✅ `16:53:05` …users.yml gives e2e50-ext B's external group alone  
✅ `16:53:05` A group named like a hostname: 400 reserved_group  
✅ `16:53:05` …or like Lamaste's own (lamaste:m:<key>): 400 reserved_group  
✅ `16:53:05` e2e50-grouped's groups are unchanged  
✅ `16:53:05` Authelia's MainPID is the one of before the first change  
✅ `16:53:06` Both sessions of before are still signed in at auth.lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `54` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `54` |

ℹ️ `16:53:06` Cleaning up test resources...  
