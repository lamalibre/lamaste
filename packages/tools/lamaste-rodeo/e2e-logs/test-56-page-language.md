# Lamaste E2E: 56 — A domain's page language: Turkish where set, English elsewhere (Three-VM)

> Started at `2026-11-04 15:00:04 UTC`


## Pre-flight

✅ `15:00:05` Onboarding is complete  
✅ `15:00:05` Agent test-agent is enrolled on the host  
✅ `15:00:05` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `15:00:05` The agent VM's lamaste-agent has the apphost command  
✅ `15:00:05` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `15:00:06` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## B and C active; B branded; A, the primary, left alone

✅ `15:00:07` Domain lamaste-second.local added (201)  
✅ `15:00:07` …pending until activated  
✅ `15:00:07` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `15:00:07` …the one required record is auth.lamaste-second.local  
✅ `15:00:08` lamaste-second.local is active  
✅ `15:00:09` Domain lamaste-third.local added (201)  
✅ `15:00:09` …pending until activated  
✅ `15:00:09` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `15:00:09` …the one required record is auth.lamaste-third.local  
✅ `15:00:10` lamaste-third.local is active  
✅ `15:00:11` No domain has a language yet  
✅ `15:00:12` B branded E2E Marka 56, no warning  
✅ `15:00:12` …rendered  

## B speaks Turkish, C English

✅ `15:00:13` PUT /api/domains/lamaste-second.local/language {language: tr}: 200  
✅ `15:00:14` …changed, tr, no warning  
✅ `15:00:14` PUT /api/domains/lamaste-third.local/language {language: en}: changed, no warning  
✅ `15:00:14` The same language again: unchanged  
✅ `15:00:14` GET /api/domains: A none, B tr, C en  
✅ `15:00:15` B's rendering (brand and language) and C's (language alone) are current  
✅ `15:00:15` …C's rendering: revision 0 (no brand), language en  
✅ `15:00:15` The running Authelia is the pinned release ({"running":"4.39.28","pinned":"4.39.28"})  
✅ `15:00:15` Setting a language restarted no Authelia  

## The sign-in page: lang follows the domain, the menu hidden

✅ `15:00:15` auth.lamaste-second.local/: <html lang="tr" data-authelia-lang="…">  
✅ `15:00:16` …its noscript sentence in Turkish (ASCII character references)  
✅ `15:00:16` …links /brand.css  
✅ `15:00:16` auth.lamaste-second.local/brand.css hides the language menu (#language-button)  
✅ `15:00:16` …and keeps the brand's accent  
✅ `15:00:16` auth.lamaste-third.local/: <html lang="en" data-authelia-lang="…">  
✅ `15:00:16` …no Turkish noscript sentence  
✅ `15:00:16` auth.lamaste-third.local/brand.css hides the menu too (a language, no brand)  
✅ `15:00:16` auth.test.lamaste.local/: Authelia's own <html lang>  
✅ `15:00:16` …not rewritten (no language)  

## Every locale path answers the domain's language

✅ `15:00:16` auth.lamaste-second.local/locales/en/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `15:00:16` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `15:00:17` auth.lamaste-second.local/locales/de-AT/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `15:00:17` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `15:00:17` auth.lamaste-second.local/locales/tr/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `15:00:17` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `15:00:17` …settings.json the same file for de-AT and tr  
✅ `15:00:17` …and not C's  
✅ `15:00:18` …consent.json answered for ar as well  
✅ `15:00:18` auth.lamaste-third.local/locales/tr/portal.json: English (Loading)  
✅ `15:00:18` auth.lamaste-third.local/locales/de-AT/portal.json: English (Loading)  
✅ `15:00:18` …Authelia's English, no brand to splice  
✅ `15:00:18` auth.test.lamaste.local/locales/tr/portal.json: Authelia's own (its Turkish lacks "Loading")  
✅ `15:00:18` …and its de-AT is not its English  

## The invitation page and the inviter's page: Turkish on B, English on C and A

✅ `15:00:19` auth.<B|C|A>/invite: 200  
✅ `15:00:19` B: lang="tr"  
✅ `15:00:19` …titled E2E Marka 56 — Daveti kabul edin  
✅ `15:00:19` …its data block: tr, invite.title Daveti kabul edin  
✅ `15:00:19` …invite.invalidLink in Turkish  
✅ `15:00:19` C: lang="en"  
✅ `15:00:19` …the stock English title  
✅ `15:00:19` …its data block: en  
✅ `15:00:19` A (no language): lang="en"  
✅ `15:00:19` …its data block: en  
✅ `15:00:19` B with Accept-Language: en-US: still Turkish (the domain decides)  
✅ `15:00:19` A with Accept-Language: tr-TR: still English  
✅ `15:00:19` B's and C's invitation page: byte for byte the same script  
✅ `15:00:19` …and A's  
✅ `15:00:19` …one Content-Security-Policy on B and C  
✅ `15:00:19` …and A  
✅ `15:00:20` The inviter's page on B: lang="tr"  
✅ `15:00:20` …titled E2E Marka 56 — Kişi davet edin  
✅ `15:00:20` …its data block: tr  
✅ `15:00:20` …on C: Lamaste — Invite People  
✅ `15:00:20` …one Content-Security-Policy on B and C  

## The plugin installed on B; its site before approval: the "not available" page in Turkish

✅ `15:00:20` Fixture built: @lamalibre/e2e-plang-server  
✅ `15:00:23` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-plang-server, @lamalibre/e2e-plang-agent )  
✅ `15:00:23` The agent VM reaches it at http://10.13.37.1:4874  
✅ `15:00:24` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T15:00:24.477Z"})  
✅ `15:00:24` …through its own OIDC client  
✅ `15:00:28` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `15:00:30` Installed @lamalibre/e2e-plang-server@1.0.0, not approved  
✅ `15:00:30` …moved to B  
✅ `15:00:32` Its web surface created, restricted  
✅ `15:00:32` …not served: not approved  
✅ `15:00:32` https://e2e56web.lamaste-second.local/: 503 until it is served  
✅ `15:00:32` …Lamaste's page, lang="tr" (P8)  
✅ `15:00:32` …Uygulama şu anda kullanılamıyor  
✅ `15:00:32` …Lütfen birkaç dakika sonra yeniden deneyin.  
✅ `15:00:33` …in B's brand  
✅ `15:00:33` …not nginx's stock page  
✅ `15:00:33` …its CSP names its style by hash  
✅ `15:00:33` …never cached  

## Approved, hosted, served

✅ `15:00:33` e2e-plang approved  
✅ `15:00:47` …hosted on test-agent ()  
✅ `15:01:09` …its hosting is up  
✅ `15:01:09` …ready: its agent half's first complete sync ended at the head  
✅ `15:01:10` …its web surface served  

## A coordinator (external of B), a member of B and C, a member of A alone; tunnels on B and C

✅ `15:01:11` User e2e56-coord created, member of lamaste-second.local (external)  
✅ `15:01:12` User e2e56-member created, member of lamaste-second.local and lamaste-third.local  
✅ `15:01:13` User e2e56-outsider created, member of test.lamaste.local  
✅ `15:01:16` Tunnel e2e56bauth.lamaste-second.local (authenticated), carried by test-agent  
✅ `15:01:21` Tunnel e2e56bres.lamaste-second.local (restricted), carried by test-agent  
✅ `15:01:25` Tunnel e2e56cres.lamaste-third.local (restricted), carried by test-agent  
✅ `15:01:28` Tunnel e2e56cauth.lamaste-third.local (authenticated), carried by test-agent  
✅ `15:01:28` e2e56-coord entitled as coordinator  
✅ `15:01:28` Granted site 0be9074a-42f2-48d1-8b67-f3cbae7efa12 to user e2e56-coord  
✅ `15:01:28` The audience holds e2e56-coord as coordinator  
✅ `15:01:29` Invitations enabled for e2e-plang  
✅ `15:01:31` e2e56-coord signed in at auth.lamaste-second.local (password, TOTP)  

## The refusals the pages map: each with its code

✅ `15:01:31` A token nobody holds: 404  
✅ `15:01:31` …invitation_not_found  
✅ `15:01:31` e2e56-coord invites ayse@example.test as viewer: 201  
✅ `15:01:31` …a link on the sign-in host, the token in its fragment  
✅ `15:01:31` …and revokes it  
✅ `15:01:31` Its token: 410  
✅ `15:01:32` …invitation_closed  
✅ `15:01:32` The inviter revokes an invitation that does not exist: 404  
✅ `15:01:32` …not_found (the inviter's page's key)  
✅ `15:01:32` e2e56-coord invites deniz@example.test as viewer: 201  
✅ `15:01:32` …a link on the sign-in host, the token in its fragment  
✅ `15:01:33` Accepted  
✅ `15:01:33` Its token once used: 410  
✅ `15:01:33` …invitation_used  
✅ `15:01:33` …the API answers codes, never the page's words  

## The access-request page: Turkish on B, English on C (P6)

✅ `15:01:35` e2e56-invitee-1793804404 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `15:01:35` e2e56-invitee-1793804404 (external, not granted) on B's authenticated tunnel: 403  
✅ `15:01:35` …the access-request page in Turkish (lang="tr")  
✅ `15:01:35` …Erişim izni gerekiyor  
✅ `15:01:35` …Giriş yapılan hesap: e2e56-invitee-1793804404  
✅ `15:01:35` …its e-mail template's Subject is Konu:  
✅ `15:01:35` …the subject in Turkish  
✅ `15:01:35` …the message templates in Turkish  
✅ `15:01:35` …no English heading  
✅ `15:01:37` e2e56-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `15:01:37` e2e56-member (member of B, no grant) on B's restricted tunnel: 403  
✅ `15:01:37` …in Turkish  
✅ `15:02:03` e2e56-member signed in at auth.lamaste-third.local (password, TOTP)  
✅ `15:02:03` e2e56-member (member of C, no grant) on C's restricted tunnel: 403  
✅ `15:02:03` …the access-request page  
✅ `15:02:03` …not the domain refusal  
✅ `15:02:03` …never a redirect to a sign-in page  
✅ `15:02:03` …in English (lang="en")  
✅ `15:02:03` …Subject:  

## The domain refusal: Turkish on B, English on C (P7)

✅ `15:02:05` e2e56-outsider signed in at auth.lamaste-second.local (password, TOTP)  
✅ `15:02:05` e2e56-outsider (member of A alone) on B's tunnel: 403  
✅ `15:02:05` …the domain refusal in Turkish (lang="tr")  
✅ `15:02:05` …lamaste-second.local üyesi değilsiniz  
✅ `15:02:05` …titled İzin verilmiyor — lamaste-second.local  
✅ `15:02:05` …the sign-out link in Turkish, on B's sign-in host  
✅ `15:02:05` …no English  
✅ `15:02:32` e2e56-outsider signed in at auth.lamaste-third.local (password, TOTP)  
✅ `15:02:32` e2e56-outsider on C's tunnel: 403  
✅ `15:02:32` …the domain refusal page  
✅ `15:02:32` …naming lamaste-third.local  
✅ `15:02:33` …never a redirect to a sign-in page (no login loop)  
✅ `15:02:33` …in English (lang="en")  

## Gatekeeper's "not allowed" page follows the domain the path names (P9)

✅ `15:02:33` A shell check of e2e56web.lamaste-second.local without its original request: 403  
✅ `15:02:33` …Gatekeeper's page in Turkish (lang="tr")  
✅ `15:02:33` …İzin verilmiyor  
✅ `15:02:33` …for a host on C: in English  
✅ `15:02:33` …Not Allowed  

## B and C back to unset

✅ `15:02:34` PUT /api/domains/lamaste-second.local/language {language: null}: cleared, no warning  
✅ `15:02:37` auth.lamaste-second.local/: lang no longer rewritten  
✅ `15:02:37` …its de-AT locale is no longer the forced Turkish  
✅ `15:02:38` …its menu shown again (brand.css without the rule)  
✅ `15:02:38` …its invitation page in English  
✅ `15:02:38` …with its brand  
✅ `15:02:38` lamaste-third.local cleared  
✅ `15:02:38` …its language-only rendering is gone  
✅ `15:02:38` auth.lamaste-third.local/brand.css: 404  
✅ `15:02:38` The audit: domain.language.updated for lamaste-second.local, null → tr, then tr → null  
✅ `15:02:39` …for lamaste-third.local, null → en, then en → null  
✅ `15:02:39` Clearing the languages restarted no Authelia  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `172` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `172` |

ℹ️ `15:02:39` Cleaning up test resources...  
