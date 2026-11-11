# Lamaste E2E: 56 — A domain's page language: Turkish where set, English elsewhere (Three-VM)

> Started at `2026-11-11 10:14:49 UTC`


## Pre-flight

✅ `10:14:49` Onboarding is complete  
✅ `10:14:50` Agent test-agent is enrolled on the host  
✅ `10:14:50` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:14:50` The agent VM's lamaste-agent has the apphost command  
✅ `10:14:50` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `10:14:51` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## B and C active; B branded; A, the primary, left alone

✅ `10:14:52` Domain lamaste-second.local added (201)  
✅ `10:14:52` …pending until activated  
✅ `10:14:53` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `10:14:53` …the one required record is auth.lamaste-second.local  
✅ `10:14:54` lamaste-second.local is active  
✅ `10:14:54` Domain lamaste-third.local added (201)  
✅ `10:14:54` …pending until activated  
✅ `10:14:55` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `10:14:55` …the one required record is auth.lamaste-third.local  
✅ `10:14:56` lamaste-third.local is active  
✅ `10:14:56` No domain has a language yet  
✅ `10:14:58` B branded E2E Marka 56, no warning  
✅ `10:14:58` …rendered  

## B speaks Turkish, C English

✅ `10:15:00` PUT /api/domains/lamaste-second.local/language {language: tr}: 200  
✅ `10:15:00` …changed, tr, no warning  
✅ `10:15:01` PUT /api/domains/lamaste-third.local/language {language: en}: changed, no warning  
✅ `10:15:01` The same language again: unchanged  
✅ `10:15:01` GET /api/domains: A none, B tr, C en  
✅ `10:15:02` B's rendering (brand and language) and C's (language alone) are current  
✅ `10:15:02` …C's rendering: revision 0 (no brand), language en  
✅ `10:15:02` The running Authelia is the pinned release ({"running":"4.39.28","pinned":"4.39.28"})  
✅ `10:15:02` Setting a language restarted no Authelia  

## The sign-in page: lang follows the domain, the menu hidden

✅ `10:15:02` auth.lamaste-second.local/: <html lang="tr" data-authelia-lang="…">  
✅ `10:15:02` …its noscript sentence in Turkish (ASCII character references)  
✅ `10:15:02` …links /brand.css  
✅ `10:15:02` auth.lamaste-second.local/brand.css hides the language menu (#language-button)  
✅ `10:15:02` …and keeps the brand's accent  
✅ `10:15:03` auth.lamaste-third.local/: <html lang="en" data-authelia-lang="…">  
✅ `10:15:03` …no Turkish noscript sentence  
✅ `10:15:03` auth.lamaste-third.local/brand.css hides the menu too (a language, no brand)  
✅ `10:15:03` auth.test.lamaste.local/: Authelia's own <html lang>  
✅ `10:15:03` …not rewritten (no language)  

## Every locale path answers the domain's language

✅ `10:15:03` auth.lamaste-second.local/locales/en/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `10:15:03` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `10:15:03` auth.lamaste-second.local/locales/de-AT/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `10:15:04` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `10:15:04` auth.lamaste-second.local/locales/tr/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `10:15:04` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `10:15:04` …settings.json the same file for de-AT and tr  
✅ `10:15:04` …and not C's  
✅ `10:15:04` …consent.json answered for ar as well  
✅ `10:15:05` auth.lamaste-third.local/locales/tr/portal.json: English (Loading)  
✅ `10:15:05` auth.lamaste-third.local/locales/de-AT/portal.json: English (Loading)  
✅ `10:15:05` …Authelia's English, no brand to splice  
✅ `10:15:05` auth.test.lamaste.local/locales/tr/portal.json: Authelia's own (its Turkish lacks "Loading")  
✅ `10:15:05` …and its de-AT is not its English  

## The invitation page and the inviter's page: Turkish on B, English on C and A

✅ `10:15:06` auth.<B|C|A>/invite: 200  
✅ `10:15:06` B: lang="tr"  
✅ `10:15:06` …titled E2E Marka 56 — Daveti kabul edin  
✅ `10:15:06` …its data block: tr, invite.title Daveti kabul edin  
✅ `10:15:06` …invite.invalidLink in Turkish  
✅ `10:15:06` C: lang="en"  
✅ `10:15:06` …the stock English title  
✅ `10:15:06` …its data block: en  
✅ `10:15:06` A (no language): lang="en"  
✅ `10:15:06` …its data block: en  
✅ `10:15:06` B with Accept-Language: en-US: still Turkish (the domain decides)  
✅ `10:15:06` A with Accept-Language: tr-TR: still English  
✅ `10:15:06` B's and C's invitation page: byte for byte the same script  
✅ `10:15:07` …and A's  
✅ `10:15:07` …one Content-Security-Policy on B and C  
✅ `10:15:07` …and A  
✅ `10:15:07` The inviter's page on B: lang="tr"  
✅ `10:15:07` …titled E2E Marka 56 — Kişi davet edin  
✅ `10:15:07` …its data block: tr  
✅ `10:15:07` …on C: Lamaste — Invite People  
✅ `10:15:07` …one Content-Security-Policy on B and C  

## The plugin installed on B; its site before approval: the "not available" page in Turkish

✅ `10:15:07` Fixture built: @lamalibre/e2e-plang-server  
✅ `10:15:17` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-plang-server, @lamalibre/e2e-plang-agent )  
✅ `10:15:17` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:15:18` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T10:15:18.473Z"})  
✅ `10:15:18` …through its own OIDC client  
✅ `10:15:19` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:15:25` Installed @lamalibre/e2e-plang-server@1.0.0, not approved  
✅ `10:15:25` …moved to B  
✅ `10:15:31` Its web surface created, restricted  
✅ `10:15:31` …not served: not approved  
✅ `10:15:31` https://e2e56web.lamaste-second.local/: 503 until it is served  
✅ `10:15:32` …Lamaste's page, lang="tr" (P8)  
✅ `10:15:32` …Uygulama şu anda kullanılamıyor  
✅ `10:15:32` …Lütfen birkaç dakika sonra yeniden deneyin.  
✅ `10:15:32` …in B's brand  
✅ `10:15:32` …not nginx's stock page  
✅ `10:15:32` …its CSP names its style by hash  
✅ `10:15:32` …never cached  

## Approved, hosted, served

✅ `10:15:33` e2e-plang approved  
✅ `10:16:12` …hosted on test-agent ()  
✅ `10:16:29` …its hosting is up  
✅ `10:16:29` …ready: its agent half's first complete sync ended at the head  
✅ `10:16:30` …its web surface served  

## A coordinator (external of B), a member of B and C, a member of A alone; tunnels on B and C

✅ `10:16:30` User e2e56-coord created, member of lamaste-second.local (external)  
✅ `10:16:31` User e2e56-member created, member of lamaste-second.local and lamaste-third.local  
✅ `10:16:32` User e2e56-outsider created, member of test.lamaste.local  
✅ `10:16:35` Tunnel e2e56bauth.lamaste-second.local (authenticated), carried by test-agent  
✅ `10:16:38` Tunnel e2e56bres.lamaste-second.local (restricted), carried by test-agent  
✅ `10:16:41` Tunnel e2e56cres.lamaste-third.local (restricted), carried by test-agent  
✅ `10:16:44` Tunnel e2e56cauth.lamaste-third.local (authenticated), carried by test-agent  
✅ `10:16:44` e2e56-coord entitled as coordinator  
✅ `10:16:44` Granted site a39f64fe-4a6f-419a-ac2d-d6adfde60d4a to user e2e56-coord  
✅ `10:16:44` The audience holds e2e56-coord as coordinator  
✅ `10:16:44` Invitations enabled for e2e-plang  
✅ `10:16:47` e2e56-coord signed in at auth.lamaste-second.local (password, TOTP)  

## The refusals the pages map: each with its code

✅ `10:16:47` A token nobody holds: 404  
✅ `10:16:47` …invitation_not_found  
✅ `10:16:47` e2e56-coord invites ayse@example.test as viewer: 201  
✅ `10:16:47` …a link on the sign-in host, the token in its fragment  
✅ `10:16:47` …and revokes it  
✅ `10:16:48` Its token: 410  
✅ `10:16:48` …invitation_closed  
✅ `10:16:48` The inviter revokes an invitation that does not exist: 404  
✅ `10:16:48` …not_found (the inviter's page's key)  
✅ `10:16:48` e2e56-coord invites deniz@example.test as viewer: 201  
✅ `10:16:48` …a link on the sign-in host, the token in its fragment  
✅ `10:16:49` Accepted  
✅ `10:16:49` Its token once used: 410  
✅ `10:16:49` …invitation_used  
✅ `10:16:49` …the API answers codes, never the page's words  

## The access-request page: Turkish on B, English on C (P6)

✅ `10:16:51` e2e56-invitee-1794392089 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:16:51` e2e56-invitee-1794392089 (external, not granted) on B's authenticated tunnel: 403  
✅ `10:16:51` …the access-request page in Turkish (lang="tr")  
✅ `10:16:51` …Erişim izni gerekiyor  
✅ `10:16:51` …Giriş yapılan hesap: e2e56-invitee-1794392089  
✅ `10:16:51` …its e-mail template's Subject is Konu:  
✅ `10:16:51` …the subject in Turkish  
✅ `10:16:51` …the message templates in Turkish  
✅ `10:16:51` …no English heading  
✅ `10:16:53` e2e56-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:16:54` e2e56-member (member of B, no grant) on B's restricted tunnel: 403  
✅ `10:16:54` …in Turkish  
✅ `10:17:03` e2e56-member signed in at auth.lamaste-third.local (password, TOTP)  
✅ `10:17:03` e2e56-member (member of C, no grant) on C's restricted tunnel: 403  
✅ `10:17:03` …the access-request page  
✅ `10:17:03` …not the domain refusal  
✅ `10:17:03` …never a redirect to a sign-in page  
✅ `10:17:03` …in English (lang="en")  
✅ `10:17:03` …Subject:  

## The domain refusal: Turkish on B, English on C (P7)

✅ `10:17:05` e2e56-outsider signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:17:05` e2e56-outsider (member of A alone) on B's tunnel: 403  
✅ `10:17:05` …the domain refusal in Turkish (lang="tr")  
✅ `10:17:05` …lamaste-second.local üyesi değilsiniz  
✅ `10:17:05` …titled İzin verilmiyor — lamaste-second.local  
✅ `10:17:05` …the sign-out link in Turkish, on B's sign-in host  
✅ `10:17:05` …no English  
✅ `10:17:33` e2e56-outsider signed in at auth.lamaste-third.local (password, TOTP)  
✅ `10:17:33` e2e56-outsider on C's tunnel: 403  
✅ `10:17:33` …the domain refusal page  
✅ `10:17:33` …naming lamaste-third.local  
✅ `10:17:33` …never a redirect to a sign-in page (no login loop)  
✅ `10:17:33` …in English (lang="en")  

## Gatekeeper's "not allowed" page follows the domain the path names (P9)

✅ `10:17:34` A shell check of e2e56web.lamaste-second.local without its original request: 403  
✅ `10:17:34` …Gatekeeper's page in Turkish (lang="tr")  
✅ `10:17:34` …İzin verilmiyor  
✅ `10:17:34` …for a host on C: in English  
✅ `10:17:34` …Not Allowed  

## B and C back to unset

✅ `10:17:35` PUT /api/domains/lamaste-second.local/language {language: null}: cleared, no warning  
✅ `10:17:36` auth.lamaste-second.local/: lang no longer rewritten  
✅ `10:17:36` …its de-AT locale is no longer the forced Turkish  
✅ `10:17:36` …its menu shown again (brand.css without the rule)  
✅ `10:17:36` …its invitation page in English  
✅ `10:17:36` …with its brand  
✅ `10:17:37` lamaste-third.local cleared  
✅ `10:17:37` …its language-only rendering is gone  
✅ `10:17:37` auth.lamaste-third.local/brand.css: the stock stylesheet (4.13)  
✅ `10:17:37` …without the language rule  
✅ `10:17:37` The audit: domain.language.updated for lamaste-second.local, null → tr, then tr → null  
✅ `10:17:37` …for lamaste-third.local, null → en, then en → null  
✅ `10:17:37` Clearing the languages restarted no Authelia  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `173` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `173` |

ℹ️ `10:17:37` Cleaning up test resources...  
