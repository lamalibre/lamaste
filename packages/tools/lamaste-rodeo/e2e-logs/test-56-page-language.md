# Lamaste E2E: 56 — A domain's page language: Turkish where set, English elsewhere (Three-VM)

> Started at `2026-11-10 14:33:31 UTC`


## Pre-flight

✅ `14:33:32` Onboarding is complete  
✅ `14:33:32` Agent test-agent is enrolled on the host  
✅ `14:33:32` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:33:32` The agent VM's lamaste-agent has the apphost command  
✅ `14:33:32` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `14:33:33` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## B and C active; B branded; A, the primary, left alone

✅ `14:33:35` Domain lamaste-second.local added (201)  
✅ `14:33:35` …pending until activated  
✅ `14:33:35` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:33:35` …the one required record is auth.lamaste-second.local  
✅ `14:33:36` lamaste-second.local is active  
✅ `14:33:37` Domain lamaste-third.local added (201)  
✅ `14:33:37` …pending until activated  
✅ `14:33:37` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `14:33:37` …the one required record is auth.lamaste-third.local  
✅ `14:33:38` lamaste-third.local is active  
✅ `14:33:39` No domain has a language yet  
✅ `14:33:40` B branded E2E Marka 56, no warning  
✅ `14:33:40` …rendered  

## B speaks Turkish, C English

✅ `14:33:42` PUT /api/domains/lamaste-second.local/language {language: tr}: 200  
✅ `14:33:42` …changed, tr, no warning  
✅ `14:33:43` PUT /api/domains/lamaste-third.local/language {language: en}: changed, no warning  
✅ `14:33:43` The same language again: unchanged  
✅ `14:33:44` GET /api/domains: A none, B tr, C en  
✅ `14:33:44` B's rendering (brand and language) and C's (language alone) are current  
✅ `14:33:44` …C's rendering: revision 0 (no brand), language en  
✅ `14:33:44` The running Authelia is the pinned release ({"running":"4.39.28","pinned":"4.39.28"})  
✅ `14:33:44` Setting a language restarted no Authelia  

## The sign-in page: lang follows the domain, the menu hidden

✅ `14:33:44` auth.lamaste-second.local/: <html lang="tr" data-authelia-lang="…">  
✅ `14:33:45` …its noscript sentence in Turkish (ASCII character references)  
✅ `14:33:45` …links /brand.css  
✅ `14:33:45` auth.lamaste-second.local/brand.css hides the language menu (#language-button)  
✅ `14:33:45` …and keeps the brand's accent  
✅ `14:33:45` auth.lamaste-third.local/: <html lang="en" data-authelia-lang="…">  
✅ `14:33:45` …no Turkish noscript sentence  
✅ `14:33:45` auth.lamaste-third.local/brand.css hides the menu too (a language, no brand)  
✅ `14:33:46` auth.test.lamaste.local/: Authelia's own <html lang>  
✅ `14:33:46` …not rewritten (no language)  

## Every locale path answers the domain's language

✅ `14:33:46` auth.lamaste-second.local/locales/en/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `14:33:46` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `14:33:46` auth.lamaste-second.local/locales/de-AT/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `14:33:46` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `14:33:46` auth.lamaste-second.local/locales/tr/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `14:33:46` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `14:33:47` …settings.json the same file for de-AT and tr  
✅ `14:33:47` …and not C's  
✅ `14:33:47` …consent.json answered for ar as well  
✅ `14:33:47` auth.lamaste-third.local/locales/tr/portal.json: English (Loading)  
✅ `14:33:47` auth.lamaste-third.local/locales/de-AT/portal.json: English (Loading)  
✅ `14:33:48` …Authelia's English, no brand to splice  
✅ `14:33:48` auth.test.lamaste.local/locales/tr/portal.json: Authelia's own (its Turkish lacks "Loading")  
✅ `14:33:48` …and its de-AT is not its English  

## The invitation page and the inviter's page: Turkish on B, English on C and A

✅ `14:33:48` auth.<B|C|A>/invite: 200  
✅ `14:33:48` B: lang="tr"  
✅ `14:33:48` …titled E2E Marka 56 — Daveti kabul edin  
✅ `14:33:48` …its data block: tr, invite.title Daveti kabul edin  
✅ `14:33:49` …invite.invalidLink in Turkish  
✅ `14:33:49` C: lang="en"  
✅ `14:33:49` …the stock English title  
✅ `14:33:49` …its data block: en  
✅ `14:33:49` A (no language): lang="en"  
✅ `14:33:49` …its data block: en  
✅ `14:33:49` B with Accept-Language: en-US: still Turkish (the domain decides)  
✅ `14:33:49` A with Accept-Language: tr-TR: still English  
✅ `14:33:49` B's and C's invitation page: byte for byte the same script  
✅ `14:33:49` …and A's  
✅ `14:33:49` …one Content-Security-Policy on B and C  
✅ `14:33:49` …and A  
✅ `14:33:49` The inviter's page on B: lang="tr"  
✅ `14:33:49` …titled E2E Marka 56 — Kişi davet edin  
✅ `14:33:49` …its data block: tr  
✅ `14:33:49` …on C: Lamaste — Invite People  
✅ `14:33:49` …one Content-Security-Policy on B and C  

## The plugin installed on B; its site before approval: the "not available" page in Turkish

✅ `14:33:50` Fixture built: @lamalibre/e2e-plang-server  
✅ `14:33:59` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-plang-server, @lamalibre/e2e-plang-agent )  
✅ `14:33:59` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:34:00` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T14:34:00.409Z"})  
✅ `14:34:00` …through its own OIDC client  
✅ `14:34:04` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:34:09` Installed @lamalibre/e2e-plang-server@1.0.0, not approved  
✅ `14:34:09` …moved to B  
✅ `14:34:12` Its web surface created, restricted  
✅ `14:34:12` …not served: not approved  
✅ `14:34:12` https://e2e56web.lamaste-second.local/: 503 until it is served  
✅ `14:34:12` …Lamaste's page, lang="tr" (P8)  
✅ `14:34:12` …Uygulama şu anda kullanılamıyor  
✅ `14:34:12` …Lütfen birkaç dakika sonra yeniden deneyin.  
✅ `14:34:12` …in B's brand  
✅ `14:34:12` …not nginx's stock page  
✅ `14:34:12` …its CSP names its style by hash  
✅ `14:34:12` …never cached  

## Approved, hosted, served

✅ `14:34:13` e2e-plang approved  
✅ `14:34:24` …hosted on test-agent ()  
✅ `14:34:37` …its hosting is up  
✅ `14:34:37` …ready: its agent half's first complete sync ended at the head  
✅ `14:34:37` …its web surface served  

## A coordinator (external of B), a member of B and C, a member of A alone; tunnels on B and C

✅ `14:34:38` User e2e56-coord created, member of lamaste-second.local (external)  
✅ `14:34:39` User e2e56-member created, member of lamaste-second.local and lamaste-third.local  
✅ `14:34:40` User e2e56-outsider created, member of test.lamaste.local  
✅ `14:34:43` Tunnel e2e56bauth.lamaste-second.local (authenticated), carried by test-agent  
✅ `14:34:46` Tunnel e2e56bres.lamaste-second.local (restricted), carried by test-agent  
✅ `14:34:49` Tunnel e2e56cres.lamaste-third.local (restricted), carried by test-agent  
✅ `14:34:52` Tunnel e2e56cauth.lamaste-third.local (authenticated), carried by test-agent  
✅ `14:34:52` e2e56-coord entitled as coordinator  
✅ `14:34:53` Granted site 36949db7-9ff6-49dc-94da-7841348fd2f5 to user e2e56-coord  
✅ `14:34:53` The audience holds e2e56-coord as coordinator  
✅ `14:34:53` Invitations enabled for e2e-plang  
✅ `14:34:55` e2e56-coord signed in at auth.lamaste-second.local (password, TOTP)  

## The refusals the pages map: each with its code

✅ `14:34:56` A token nobody holds: 404  
✅ `14:34:56` …invitation_not_found  
✅ `14:34:56` e2e56-coord invites ayse@example.test as viewer: 201  
✅ `14:34:56` …a link on the sign-in host, the token in its fragment  
✅ `14:34:56` …and revokes it  
✅ `14:34:56` Its token: 410  
✅ `14:34:56` …invitation_closed  
✅ `14:34:56` The inviter revokes an invitation that does not exist: 404  
✅ `14:34:56` …not_found (the inviter's page's key)  
✅ `14:34:57` e2e56-coord invites deniz@example.test as viewer: 201  
✅ `14:34:57` …a link on the sign-in host, the token in its fragment  
✅ `14:34:57` Accepted  
✅ `14:34:58` Its token once used: 410  
✅ `14:34:58` …invitation_used  
✅ `14:34:58` …the API answers codes, never the page's words  

## The access-request page: Turkish on B, English on C (P6)

✅ `14:34:59` e2e56-invitee-1794321211 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:35:00` e2e56-invitee-1794321211 (external, not granted) on B's authenticated tunnel: 403  
✅ `14:35:00` …the access-request page in Turkish (lang="tr")  
✅ `14:35:00` …Erişim izni gerekiyor  
✅ `14:35:00` …Giriş yapılan hesap: e2e56-invitee-1794321211  
✅ `14:35:00` …its e-mail template's Subject is Konu:  
✅ `14:35:00` …the subject in Turkish  
✅ `14:35:00` …the message templates in Turkish  
✅ `14:35:00` …no English heading  
✅ `14:35:01` e2e56-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:35:02` e2e56-member (member of B, no grant) on B's restricted tunnel: 403  
✅ `14:35:02` …in Turkish  
✅ `14:35:32` e2e56-member signed in at auth.lamaste-third.local (password, TOTP)  
✅ `14:35:33` e2e56-member (member of C, no grant) on C's restricted tunnel: 403  
✅ `14:35:33` …the access-request page  
✅ `14:35:33` …not the domain refusal  
✅ `14:35:33` …never a redirect to a sign-in page  
✅ `14:35:33` …in English (lang="en")  
✅ `14:35:33` …Subject:  

## The domain refusal: Turkish on B, English on C (P7)

✅ `14:35:35` e2e56-outsider signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:35:35` e2e56-outsider (member of A alone) on B's tunnel: 403  
✅ `14:35:35` …the domain refusal in Turkish (lang="tr")  
✅ `14:35:35` …lamaste-second.local üyesi değilsiniz  
✅ `14:35:35` …titled İzin verilmiyor — lamaste-second.local  
✅ `14:35:35` …the sign-out link in Turkish, on B's sign-in host  
✅ `14:35:35` …no English  
✅ `14:36:03` e2e56-outsider signed in at auth.lamaste-third.local (password, TOTP)  
✅ `14:36:03` e2e56-outsider on C's tunnel: 403  
✅ `14:36:03` …the domain refusal page  
✅ `14:36:03` …naming lamaste-third.local  
✅ `14:36:03` …never a redirect to a sign-in page (no login loop)  
✅ `14:36:03` …in English (lang="en")  

## Gatekeeper's "not allowed" page follows the domain the path names (P9)

✅ `14:36:03` A shell check of e2e56web.lamaste-second.local without its original request: 403  
✅ `14:36:03` …Gatekeeper's page in Turkish (lang="tr")  
✅ `14:36:03` …İzin verilmiyor  
✅ `14:36:03` …for a host on C: in English  
✅ `14:36:03` …Not Allowed  

## B and C back to unset

✅ `14:36:05` PUT /api/domains/lamaste-second.local/language {language: null}: cleared, no warning  
✅ `14:36:05` auth.lamaste-second.local/: lang no longer rewritten  
✅ `14:36:05` …its de-AT locale is no longer the forced Turkish  
✅ `14:36:05` …its menu shown again (brand.css without the rule)  
✅ `14:36:05` …its invitation page in English  
✅ `14:36:05` …with its brand  
✅ `14:36:06` lamaste-third.local cleared  
✅ `14:36:06` …its language-only rendering is gone  
✅ `14:36:06` auth.lamaste-third.local/brand.css: 404  
✅ `14:36:06` The audit: domain.language.updated for lamaste-second.local, null → tr, then tr → null  
✅ `14:36:06` …for lamaste-third.local, null → en, then en → null  
✅ `14:36:07` Clearing the languages restarted no Authelia  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `172` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `172` |

ℹ️ `14:36:07` Cleaning up test resources...  
