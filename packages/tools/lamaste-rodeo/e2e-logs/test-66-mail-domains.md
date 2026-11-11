# Lamaste E2E: 66 — Mail across domains: each portal its own reset link (Three-VM)

> Started at `2026-11-11 10:39:53 UTC`


## Pre-flight

✅ `10:39:53` Onboarding is complete  
✅ `10:39:53` Agent test-agent is enrolled on the host  
✅ `10:39:54` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `10:39:55` Domain lamaste-second.local added (201)  
✅ `10:39:55` …pending until activated  
✅ `10:39:55` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `10:39:55` …the one required record is auth.lamaste-second.local  
✅ `10:39:57` lamaste-second.local is active  
✅ `10:39:57` Domain lamaste-third.local added (201)  
✅ `10:39:57` …pending until activated  
✅ `10:39:58` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `10:39:58` …the one required record is auth.lamaste-third.local  
✅ `10:39:59` lamaste-third.local is active  
✅ `10:40:00` B speaks Turkish  
✅ `10:40:06` The SMTP sink answers on the host VM's 127.0.0.1:2467  
✅ `10:40:06` User e2e58-b-1794393593 <e2e58-b-1794393593@e2e-mail.example.com>, member of lamaste-second.local  
✅ `10:40:07` User e2e58-c-1794393593 <e2e58-c-1794393593@e2e-mail.example.com>, member of lamaste-third.local  

## B's own transport, no relay transport

✅ `10:40:09` PUT /api/domains/lamaste-second.local/mail: B's own transport to the sink  
✅ `10:40:09` …a domain row of its own  
✅ `10:40:09` The relay has no transport  
✅ `10:40:09` auth.lamaste-second.local/ links https://auth.lamaste-second.local/reset  
✅ `10:40:09` auth.test.lamaste.local/ (cannot send) links no reset page  
✅ `10:40:10` auth.lamaste-third.local/ (cannot send) links none  
✅ `10:40:10` A reset on auth.lamaste-third.local: 404  
✅ `10:40:10` …reset_unavailable  

## A member of B forgets their password: Turkish, From B's sender

✅ `10:40:11` POST auth.lamaste-second.local/api/account/reset/start (by address): 202  
✅ `10:40:11` The mail is in the sink  
✅ `10:40:11` …From B's sender  
✅ `10:40:11` …in Turkish: Şifrenizi sıfırlayın  
✅ `10:40:11` …its link on auth.lamaste-second.local  
✅ `10:40:11` …naming the username  

## The relay's transport added: every portal its own reset link

✅ `10:40:13` PUT /api/settings/mail: the relay's transport  
✅ `10:40:13` auth.test.lamaste.local/ links https://auth.test.lamaste.local/reset  
✅ `10:40:13` auth.lamaste-second.local/ links https://auth.lamaste-second.local/reset  
✅ `10:40:13` auth.lamaste-third.local/ links https://auth.lamaste-third.local/reset  
✅ `10:40:14` Authelia's one custom_url is the primary's; the vhosts give each portal its own  

## A member of C: English, From the relay's sender

✅ `10:40:15` POST auth.lamaste-third.local/api/account/reset/start: 202  
✅ `10:40:15` The mail is in the sink  
✅ `10:40:15` …From the relay's sender  
✅ `10:40:15` …in English  
✅ `10:40:15` …its link on auth.lamaste-third.local  

## A reset for a member of B asked on C's portal: no mail

✅ `10:40:16` auth.lamaste-third.local: the same answer  
✅ `10:40:22` …but no mail: e2e58-b-1794393593 is no member of C  

## B's own transport removed: the relay's carries its mail

✅ `10:40:22` DELETE /api/domains/lamaste-second.local/mail  
✅ `10:40:22` auth.lamaste-second.local/ still links its own /reset  
✅ `10:40:23` POST /api/domains/lamaste-second.local/mail/test: sent  
✅ `10:40:23` …mailed  
✅ `10:40:23` …From the relay's sender, still in B's Turkish  

## A second reset while the first link is live: no new mail

✅ `10:40:24` Another reset on auth.lamaste-second.local: the same answer  
✅ `10:40:29` …no new mail: the link mailed minutes ago still works  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `50` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `50` |

ℹ️ `10:40:29` Cleaning up test resources...  
