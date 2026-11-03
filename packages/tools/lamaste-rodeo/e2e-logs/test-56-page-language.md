# Lamaste E2E: 56 — A domain's page language: Turkish where set, English elsewhere (Three-VM)

> Started at `2026-11-03 12:29:22 UTC`


## Pre-flight

✅ `12:29:22` Onboarding is complete  
✅ `12:29:22` Agent test-agent is enrolled on the host  
✅ `12:29:23` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `12:29:23` The agent VM's lamaste-agent has the apphost command  
✅ `12:29:23` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `12:29:23` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## B and C active; B branded; A, the primary, left alone

✅ `12:29:24` Domain lamaste-second.local added (201)  
✅ `12:29:24` …pending until activated  
✅ `12:29:24` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `12:29:24` …the one required record is auth.lamaste-second.local  
✅ `12:29:25` lamaste-second.local is active  
✅ `12:29:26` Domain lamaste-third.local added (201)  
✅ `12:29:26` …pending until activated  
✅ `12:29:26` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `12:29:26` …the one required record is auth.lamaste-third.local  
✅ `12:29:27` lamaste-third.local is active  
✅ `12:29:28` No domain has a language yet  
✅ `12:29:29` B branded E2E Marka 56, no warning  
✅ `12:29:29` …rendered  

## B speaks Turkish, C English

✅ `12:29:30` PUT /api/domains/lamaste-second.local/language {language: tr}: 200  
✅ `12:29:30` …changed, tr, no warning  
✅ `12:29:30` PUT /api/domains/lamaste-third.local/language {language: en}: changed, no warning  
✅ `12:29:30` The same language again: unchanged  
✅ `12:29:30` GET /api/domains: A none, B tr, C en  
✅ `12:29:31` B's rendering (brand and language) and C's (language alone) are current  
✅ `12:29:31` …C's rendering: revision 0 (no brand), language en  
✅ `12:29:31` The running Authelia is the pinned release ({"running":"4.39.28","pinned":"4.39.28"})  
✅ `12:29:31` Setting a language restarted no Authelia  

## The sign-in page: lang follows the domain, the menu hidden

✅ `12:29:31` auth.lamaste-second.local/: <html lang="tr" data-authelia-lang="…">  
✅ `12:29:31` …its noscript sentence in Turkish (ASCII character references)  
✅ `12:29:31` …links /brand.css  
✅ `12:29:31` auth.lamaste-second.local/brand.css hides the language menu (#language-button)  
✅ `12:29:31` …and keeps the brand's accent  
✅ `12:29:31` auth.lamaste-third.local/: <html lang="en" data-authelia-lang="…">  
✅ `12:29:32` …no Turkish noscript sentence  
✅ `12:29:32` auth.lamaste-third.local/brand.css hides the menu too (a language, no brand)  
✅ `12:29:32` auth.test.lamaste.local/: Authelia's own <html lang>  
✅ `12:29:32` …not rewritten (no language)  

## Every locale path answers the domain's language

✅ `12:29:32` auth.lamaste-second.local/locales/en/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `12:29:32` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `12:29:32` auth.lamaste-second.local/locales/de-AT/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `12:29:32` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `12:29:32` auth.lamaste-second.local/locales/tr/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `12:29:32` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `12:29:33` …settings.json the same file for de-AT and tr  
✅ `12:29:33` …and not C's  
✅ `12:29:33` …consent.json answered for ar as well  
✅ `12:29:33` auth.lamaste-third.local/locales/tr/portal.json: English (Loading)  
✅ `12:29:33` auth.lamaste-third.local/locales/de-AT/portal.json: English (Loading)  
✅ `12:29:33` …Authelia's English, no brand to splice  
✅ `12:29:33` auth.test.lamaste.local/locales/tr/portal.json: Authelia's own (its Turkish lacks "Loading")  
✅ `12:29:33` …and its de-AT is not its English  

## The invitation page and the inviter's page: Turkish on B, English on C and A

✅ `12:29:34` auth.<B|C|A>/invite: 200  
✅ `12:29:34` B: lang="tr"  
✅ `12:29:34` …titled E2E Marka 56 — Daveti kabul edin  
✅ `12:29:34` …its data block: tr, invite.title Daveti kabul edin  
✅ `12:29:34` …invite.invalidLink in Turkish  
✅ `12:29:34` C: lang="en"  
✅ `12:29:34` …the stock English title  
✅ `12:29:34` …its data block: en  
✅ `12:29:34` A (no language): lang="en"  
✅ `12:29:34` …its data block: en  
✅ `12:29:34` B with Accept-Language: en-US: still Turkish (the domain decides)  
✅ `12:29:34` A with Accept-Language: tr-TR: still English  
✅ `12:29:34` B's and C's invitation page: byte for byte the same script  
✅ `12:29:34` …and A's  
✅ `12:29:34` …one Content-Security-Policy on B and C  
✅ `12:29:34` …and A  
✅ `12:29:34` The inviter's page on B: lang="tr"  
✅ `12:29:34` …titled E2E Marka 56 — Kişi davet edin  
✅ `12:29:34` …its data block: tr  
✅ `12:29:34` …on C: Lamaste — Invite People  
✅ `12:29:35` …one Content-Security-Policy on B and C  

## The plugin installed on B; its site before approval: the "not available" page in Turkish

✅ `12:29:35` Fixture built: @lamalibre/e2e-plang-server  
✅ `12:29:44` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-plang-server, @lamalibre/e2e-plang-agent )  
✅ `12:29:44` The agent VM reaches it at http://10.13.37.1:4874  
✅ `12:29:45` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T12:29:45.238Z"})  
✅ `12:29:45` …through its own OIDC client  
✅ `12:29:49` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `12:29:53` Installed @lamalibre/e2e-plang-server@1.0.0, not approved  
✅ `12:29:54` …moved to B  
✅ `12:29:54` Its web surface created, restricted  
✅ `12:29:54` …not served: not approved  
✅ `12:29:54` https://e2e56web.lamaste-second.local/: 503 until it is served  
✅ `12:29:55` …Lamaste's page, lang="tr" (P8)  
✅ `12:29:55` …Uygulama şu anda kullanılamıyor  
✅ `12:29:55` …Lütfen birkaç dakika sonra yeniden deneyin.  
✅ `12:29:55` …in B's brand  
✅ `12:29:55` …not nginx's stock page  
✅ `12:29:55` …its CSP names its style by hash  
✅ `12:29:55` …never cached  

## Approved, hosted, served

✅ `12:29:55` e2e-plang approved  
✅ `12:30:05` …hosted on test-agent ()  
✅ `12:30:25` …its hosting is up  
✅ `12:30:25` …ready: its agent half's first complete sync ended at the head  
✅ `12:30:25` …its web surface served  

## A coordinator (external of B), a member of B and C, a member of A alone; tunnels on B and C

✅ `12:30:26` User e2e56-coord created, member of lamaste-second.local (external)  
✅ `12:30:27` User e2e56-member created, member of lamaste-second.local and lamaste-third.local  
✅ `12:30:27` User e2e56-outsider created, member of test.lamaste.local  
✅ `12:30:28` Tunnel e2e56bauth.lamaste-second.local (authenticated), carried by test-agent  
✅ `12:30:30` Tunnel e2e56bres.lamaste-second.local (restricted), carried by test-agent  
✅ `12:30:31` Tunnel e2e56cres.lamaste-third.local (restricted), carried by test-agent  
✅ `12:30:32` Tunnel e2e56cauth.lamaste-third.local (authenticated), carried by test-agent  
✅ `12:30:32` e2e56-coord entitled as coordinator  
✅ `12:30:32` Granted site 408f0cfe-57d4-47cf-8550-5cdd8efa1a8e to user e2e56-coord  
✅ `12:30:32` The audience holds e2e56-coord as coordinator  
✅ `12:30:33` Invitations enabled for e2e-plang  
✅ `12:30:35` e2e56-coord signed in at auth.lamaste-second.local (password, TOTP)  

## The refusals the pages map: each with its code

✅ `12:30:35` A token nobody holds: 404  
✅ `12:30:35` …invitation_not_found  
✅ `12:30:35` e2e56-coord invites ayse@example.test as viewer: 201  
✅ `12:30:35` …a link on the sign-in host, the token in its fragment  
✅ `12:30:35` …and revokes it  
✅ `12:30:35` Its token: 410  
✅ `12:30:35` …invitation_closed  
✅ `12:30:35` The inviter revokes an invitation that does not exist: 404  
✅ `12:30:35` …not_found (the inviter's page's key)  
✅ `12:30:35` e2e56-coord invites deniz@example.test as viewer: 201  
✅ `12:30:35` …a link on the sign-in host, the token in its fragment  
✅ `12:30:36` Accepted  
✅ `12:30:36` Its token once used: 410  
✅ `12:30:36` …invitation_used  
✅ `12:30:36` …the API answers codes, never the page's words  

## The access-request page: Turkish on B, English on C (P6)

✅ `12:30:38` e2e56-invitee-1793708962 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `12:30:38` e2e56-invitee-1793708962 (external, not granted) on B's authenticated tunnel: 403  
✅ `12:30:38` …the access-request page in Turkish (lang="tr")  
✅ `12:30:38` …Erişim izni gerekiyor  
✅ `12:30:38` …Giriş yapılan hesap: e2e56-invitee-1793708962  
✅ `12:30:38` …its e-mail template's Subject is Konu:  
✅ `12:30:38` …the subject in Turkish  
✅ `12:30:38` …the message templates in Turkish  
✅ `12:30:38` …no English heading  
✅ `12:30:40` e2e56-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `12:30:40` e2e56-member (member of B, no grant) on B's restricted tunnel: 403  
✅ `12:30:40` …in Turkish  
✅ `12:31:03` e2e56-member signed in at auth.lamaste-third.local (password, TOTP)  
✅ `12:31:03` e2e56-member (member of C, no grant) on C's restricted tunnel: 403  
✅ `12:31:03` …the access-request page  
✅ `12:31:03` …not the domain refusal  
✅ `12:31:03` …never a redirect to a sign-in page  
✅ `12:31:03` …in English (lang="en")  
✅ `12:31:03` …Subject:  

## The domain refusal: Turkish on B, English on C (P7)

✅ `12:31:05` e2e56-outsider signed in at auth.lamaste-second.local (password, TOTP)  
✅ `12:31:05` e2e56-outsider (member of A alone) on B's tunnel: 403  
✅ `12:31:05` …the domain refusal in Turkish (lang="tr")  
✅ `12:31:05` …lamaste-second.local üyesi değilsiniz  
✅ `12:31:05` …titled İzin verilmiyor — lamaste-second.local  
✅ `12:31:05` …the sign-out link in Turkish, on B's sign-in host  
✅ `12:31:05` …no English  
✅ `12:31:33` e2e56-outsider signed in at auth.lamaste-third.local (password, TOTP)  
✅ `12:31:33` e2e56-outsider on C's tunnel: 403  
✅ `12:31:33` …the domain refusal page  
✅ `12:31:33` …naming lamaste-third.local  
✅ `12:31:33` …never a redirect to a sign-in page (no login loop)  
✅ `12:31:33` …in English (lang="en")  

## Gatekeeper's "not allowed" page follows the domain the path names (P9)

✅ `12:31:33` A shell check of e2e56web.lamaste-second.local without its original request: 403  
✅ `12:31:33` …Gatekeeper's page in Turkish (lang="tr")  
✅ `12:31:33` …İzin verilmiyor  
✅ `12:31:33` …for a host on C: in English  
✅ `12:31:33` …Not Allowed  

## B and C back to unset

✅ `12:31:34` PUT /api/domains/lamaste-second.local/language {language: null}: cleared, no warning  
✅ `12:31:34` auth.lamaste-second.local/: lang no longer rewritten  
✅ `12:31:34` …its de-AT locale is no longer the forced Turkish  
✅ `12:31:34` …its menu shown again (brand.css without the rule)  
✅ `12:31:35` …its invitation page in English  
✅ `12:31:35` …with its brand  
✅ `12:31:35` lamaste-third.local cleared  
✅ `12:31:35` …its language-only rendering is gone  
✅ `12:31:35` auth.lamaste-third.local/brand.css: 404  
✅ `12:31:35` The audit: domain.language.updated for lamaste-second.local, null → tr, then tr → null  
✅ `12:31:35` …for lamaste-third.local, null → en, then en → null  
✅ `12:31:35` Clearing the languages restarted no Authelia  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `172` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `172` |

ℹ️ `12:31:35` Cleaning up test resources...  
