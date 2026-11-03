# Lamaste E2E: 56 — A domain's page language: Turkish where set, English elsewhere (Three-VM)

> Started at `2026-11-03 10:55:46 UTC`


## Pre-flight

✅ `10:55:46` Onboarding is complete  
✅ `10:55:47` Agent test-agent is enrolled on the host  
✅ `10:55:47` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:55:47` The agent VM's lamaste-agent has the apphost command  
✅ `10:55:47` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `10:55:47` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## B and C active; B branded; A, the primary, left alone

✅ `10:55:49` Domain lamaste-second.local added (201)  
✅ `10:55:49` …pending until activated  
✅ `10:55:49` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `10:55:49` …the one required record is auth.lamaste-second.local  
✅ `10:55:51` lamaste-second.local is active  
✅ `10:55:51` Domain lamaste-third.local added (201)  
✅ `10:55:51` …pending until activated  
✅ `10:55:51` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `10:55:51` …the one required record is auth.lamaste-third.local  
✅ `10:55:53` lamaste-third.local is active  
✅ `10:55:53` No domain has a language yet  
✅ `10:55:54` B branded E2E Marka 56, no warning  
✅ `10:55:54` …rendered  

## B speaks Turkish, C English

✅ `10:55:55` PUT /api/domains/lamaste-second.local/language {language: tr}: 200  
✅ `10:55:55` …changed, tr, no warning  
✅ `10:55:55` PUT /api/domains/lamaste-third.local/language {language: en}: changed, no warning  
✅ `10:55:55` The same language again: unchanged  
✅ `10:55:56` GET /api/domains: A none, B tr, C en  
✅ `10:55:56` B's rendering (brand and language) and C's (language alone) are current  
✅ `10:55:56` …C's rendering: revision 0 (no brand), language en  
✅ `10:55:56` The running Authelia is the pinned release ({"running":"4.39.28","pinned":"4.39.28"})  
✅ `10:55:56` Setting a language restarted no Authelia  

## The sign-in page: lang follows the domain, the menu hidden

✅ `10:55:57` auth.lamaste-second.local/: <html lang="tr" data-authelia-lang="…">  
✅ `10:55:57` …its noscript sentence in Turkish (ASCII character references)  
✅ `10:55:57` …links /brand.css  
✅ `10:55:57` auth.lamaste-second.local/brand.css hides the language menu (#language-button)  
✅ `10:55:57` …and keeps the brand's accent  
✅ `10:55:57` auth.lamaste-third.local/: <html lang="en" data-authelia-lang="…">  
✅ `10:55:57` …no Turkish noscript sentence  
✅ `10:55:57` auth.lamaste-third.local/brand.css hides the menu too (a language, no brand)  
✅ `10:55:57` auth.test.lamaste.local/: Authelia's own <html lang>  
✅ `10:55:57` …not rewritten (no language)  

## Every locale path answers the domain's language

✅ `10:55:57` auth.lamaste-second.local/locales/en/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `10:55:57` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `10:55:58` auth.lamaste-second.local/locales/de-AT/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `10:55:58` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `10:55:58` auth.lamaste-second.local/locales/tr/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `10:55:58` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `10:55:58` …settings.json the same file for de-AT and tr  
✅ `10:55:58` …and not C's  
✅ `10:55:58` …consent.json answered for ar as well  
✅ `10:55:58` auth.lamaste-third.local/locales/tr/portal.json: English (Loading)  
✅ `10:55:59` auth.lamaste-third.local/locales/de-AT/portal.json: English (Loading)  
✅ `10:55:59` …Authelia's English, no brand to splice  
✅ `10:55:59` auth.test.lamaste.local/locales/tr/portal.json: Authelia's own (its Turkish lacks "Loading")  
✅ `10:55:59` …and its de-AT is not its English  

## The invitation page and the inviter's page: Turkish on B, English on C and A

✅ `10:56:00` auth.<B|C|A>/invite: 200  
✅ `10:56:00` B: lang="tr"  
✅ `10:56:00` …titled E2E Marka 56 — Daveti kabul edin  
✅ `10:56:00` …its data block: tr, invite.title Daveti kabul edin  
✅ `10:56:00` …invite.invalidLink in Turkish  
✅ `10:56:00` C: lang="en"  
✅ `10:56:00` …the stock English title  
✅ `10:56:00` …its data block: en  
✅ `10:56:00` A (no language): lang="en"  
✅ `10:56:00` …its data block: en  
✅ `10:56:00` B with Accept-Language: en-US: still Turkish (the domain decides)  
✅ `10:56:00` A with Accept-Language: tr-TR: still English  
✅ `10:56:00` B's and C's invitation page: byte for byte the same script  
✅ `10:56:00` …and A's  
✅ `10:56:00` …one Content-Security-Policy on B and C  
✅ `10:56:00` …and A  
✅ `10:56:00` The inviter's page on B: lang="tr"  
✅ `10:56:00` …titled E2E Marka 56 — Kişi davet edin  
✅ `10:56:00` …its data block: tr  
✅ `10:56:00` …on C: Lamaste — Invite People  
✅ `10:56:00` …one Content-Security-Policy on B and C  

## The plugin installed on B; its site before approval: the "not available" page in Turkish

✅ `10:56:01` Fixture built: @lamalibre/e2e-plang-server  
✅ `10:56:09` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-plang-server, @lamalibre/e2e-plang-agent )  
✅ `10:56:09` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:56:10` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T10:56:10.401Z"})  
✅ `10:56:10` …through its own OIDC client  
✅ `10:56:14` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:56:18` Installed @lamalibre/e2e-plang-server@1.0.0, not approved  
✅ `10:56:19` …moved to B  
✅ `10:56:21` Its web surface created, restricted  
✅ `10:56:21` …not served: not approved  
✅ `10:56:21` https://e2e56web.lamaste-second.local/: 503 until it is served  
✅ `10:56:21` …Lamaste's page, lang="tr" (P8)  
✅ `10:56:21` …Uygulama şu anda kullanılamıyor  
✅ `10:56:21` …Lütfen birkaç dakika sonra yeniden deneyin.  
✅ `10:56:21` …in B's brand  
✅ `10:56:21` …not nginx's stock page  
✅ `10:56:21` …its CSP names its style by hash  
✅ `10:56:21` …never cached  

## Approved, hosted, served

✅ `10:56:22` e2e-plang approved  
✅ `10:56:32` …hosted on test-agent ()  
✅ `10:56:48` …its hosting is up  
✅ `10:56:48` …ready: its agent half's first complete sync ended at the head  
✅ `10:56:49` …its web surface served  

## A coordinator (external of B), a member of B and C, a member of A alone; tunnels on B and C

✅ `10:56:49` User e2e56-coord created, member of lamaste-second.local (external)  
✅ `10:56:50` User e2e56-member created, member of lamaste-second.local and lamaste-third.local  
✅ `10:56:50` User e2e56-outsider created, member of test.lamaste.local  
✅ `10:56:53` Tunnel e2e56bauth.lamaste-second.local (authenticated), carried by test-agent  
✅ `10:56:55` Tunnel e2e56bres.lamaste-second.local (restricted), carried by test-agent  
✅ `10:56:57` Tunnel e2e56cres.lamaste-third.local (restricted), carried by test-agent  
✅ `10:57:00` Tunnel e2e56cauth.lamaste-third.local (authenticated), carried by test-agent  
✅ `10:57:00` e2e56-coord entitled as coordinator  
✅ `10:57:00` Granted site bd048949-5edb-4621-9ca6-a2689b793fed to user e2e56-coord  
✅ `10:57:00` The audience holds e2e56-coord as coordinator  
✅ `10:57:00` Invitations enabled for e2e-plang  
✅ `10:57:02` e2e56-coord signed in at auth.lamaste-second.local (password, TOTP)  

## The refusals the pages map: each with its code

✅ `10:57:02` A token nobody holds: 404  
✅ `10:57:02` …invitation_not_found  
✅ `10:57:03` e2e56-coord invites ayse@example.test as viewer: 201  
✅ `10:57:03` …a link on the sign-in host, the token in its fragment  
✅ `10:57:03` …and revokes it  
✅ `10:57:03` Its token: 410  
✅ `10:57:03` …invitation_closed  
✅ `10:57:03` The inviter revokes an invitation that does not exist: 404  
✅ `10:57:03` …not_found (the inviter's page's key)  
✅ `10:57:03` e2e56-coord invites deniz@example.test as viewer: 201  
✅ `10:57:03` …a link on the sign-in host, the token in its fragment  
✅ `10:57:04` Accepted  
✅ `10:57:04` Its token once used: 410  
✅ `10:57:04` …invitation_used  
✅ `10:57:04` …the API answers codes, never the page's words  

## The access-request page: Turkish on B, English on C (P6)

✅ `10:57:05` e2e56-invitee-1793703346 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:57:06` e2e56-invitee-1793703346 (external, not granted) on B's authenticated tunnel: 403  
✅ `10:57:06` …the access-request page in Turkish (lang="tr")  
✅ `10:57:06` …Erişim izni gerekiyor  
✅ `10:57:06` …Giriş yapılan hesap: e2e56-invitee-1793703346  
✅ `10:57:06` …its e-mail template's Subject is Konu:  
✅ `10:57:06` …the subject in Turkish  
✅ `10:57:06` …the message templates in Turkish  
✅ `10:57:06` …no English heading  
✅ `10:57:07` e2e56-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:57:08` e2e56-member (member of B, no grant) on B's restricted tunnel: 403  
✅ `10:57:08` …in Turkish  
✅ `10:57:32` e2e56-member signed in at auth.lamaste-third.local (password, TOTP)  
✅ `10:57:32` e2e56-member (member of C, no grant) on C's restricted tunnel: 403  
✅ `10:57:32` …the access-request page  
✅ `10:57:32` …not the domain refusal  
✅ `10:57:32` …never a redirect to a sign-in page  
✅ `10:57:32` …in English (lang="en")  
✅ `10:57:32` …Subject:  

## The domain refusal: Turkish on B, English on C (P7)

✅ `10:57:34` e2e56-outsider signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:57:34` e2e56-outsider (member of A alone) on B's tunnel: 403  
✅ `10:57:34` …the domain refusal in Turkish (lang="tr")  
✅ `10:57:34` …lamaste-second.local üyesi değilsiniz  
✅ `10:57:34` …titled İzin verilmiyor — lamaste-second.local  
✅ `10:57:34` …the sign-out link in Turkish, on B's sign-in host  
✅ `10:57:34` …no English  
✅ `10:58:03` e2e56-outsider signed in at auth.lamaste-third.local (password, TOTP)  
✅ `10:58:03` e2e56-outsider on C's tunnel: 403  
✅ `10:58:03` …the domain refusal page  
✅ `10:58:03` …naming lamaste-third.local  
✅ `10:58:03` …never a redirect to a sign-in page (no login loop)  
✅ `10:58:03` …in English (lang="en")  

## Gatekeeper's "not allowed" page follows the domain the path names (P9)

✅ `10:58:03` A shell check of e2e56web.lamaste-second.local without its original request: 403  
✅ `10:58:03` …Gatekeeper's page in Turkish (lang="tr")  
✅ `10:58:03` …İzin verilmiyor  
✅ `10:58:03` …for a host on C: in English  
✅ `10:58:03` …Not Allowed  

## B and C back to unset

✅ `10:58:04` PUT /api/domains/lamaste-second.local/language {language: null}: cleared, no warning  
✅ `10:58:04` auth.lamaste-second.local/: lang no longer rewritten  
✅ `10:58:05` …its de-AT locale is no longer the forced Turkish  
✅ `10:58:05` …its menu shown again (brand.css without the rule)  
✅ `10:58:05` …its invitation page in English  
✅ `10:58:05` …with its brand  
✅ `10:58:05` lamaste-third.local cleared  
✅ `10:58:05` …its language-only rendering is gone  
✅ `10:58:05` auth.lamaste-third.local/brand.css: 404  
✅ `10:58:05` The audit: domain.language.updated for lamaste-second.local, null → tr, then tr → null  
✅ `10:58:06` …for lamaste-third.local, null → en, then en → null  
✅ `10:58:06` Clearing the languages restarted no Authelia  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `172` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `172` |

ℹ️ `10:58:06` Cleaning up test resources...  
