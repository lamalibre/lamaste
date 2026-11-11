# Lamaste E2E: 56 — A domain's page language: Turkish where set, English elsewhere (Three-VM)

> Started at `2026-11-10 19:17:15 UTC`


## Pre-flight

✅ `19:17:16` Onboarding is complete  
✅ `19:17:16` Agent test-agent is enrolled on the host  
✅ `19:17:16` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `19:17:17` The agent VM's lamaste-agent has the apphost command  
✅ `19:17:17` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `19:17:17` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## B and C active; B branded; A, the primary, left alone

✅ `19:17:18` Domain lamaste-second.local added (201)  
✅ `19:17:18` …pending until activated  
✅ `19:17:19` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `19:17:19` …the one required record is auth.lamaste-second.local  
✅ `19:17:20` lamaste-second.local is active  
✅ `19:17:20` Domain lamaste-third.local added (201)  
✅ `19:17:20` …pending until activated  
✅ `19:17:21` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `19:17:21` …the one required record is auth.lamaste-third.local  
✅ `19:17:22` lamaste-third.local is active  
✅ `19:17:22` No domain has a language yet  
✅ `19:17:24` B branded E2E Marka 56, no warning  
✅ `19:17:24` …rendered  

## B speaks Turkish, C English

✅ `19:17:26` PUT /api/domains/lamaste-second.local/language {language: tr}: 200  
✅ `19:17:26` …changed, tr, no warning  
✅ `19:17:26` PUT /api/domains/lamaste-third.local/language {language: en}: changed, no warning  
✅ `19:17:26` The same language again: unchanged  
✅ `19:17:27` GET /api/domains: A none, B tr, C en  
✅ `19:17:27` B's rendering (brand and language) and C's (language alone) are current  
✅ `19:17:27` …C's rendering: revision 0 (no brand), language en  
✅ `19:17:27` The running Authelia is the pinned release ({"running":"4.39.28","pinned":"4.39.28"})  
✅ `19:17:28` Setting a language restarted no Authelia  

## The sign-in page: lang follows the domain, the menu hidden

✅ `19:17:28` auth.lamaste-second.local/: <html lang="tr" data-authelia-lang="…">  
✅ `19:17:28` …its noscript sentence in Turkish (ASCII character references)  
✅ `19:17:28` …links /brand.css  
✅ `19:17:28` auth.lamaste-second.local/brand.css hides the language menu (#language-button)  
✅ `19:17:28` …and keeps the brand's accent  
✅ `19:17:28` auth.lamaste-third.local/: <html lang="en" data-authelia-lang="…">  
✅ `19:17:28` …no Turkish noscript sentence  
✅ `19:17:28` auth.lamaste-third.local/brand.css hides the menu too (a language, no brand)  
✅ `19:17:29` auth.test.lamaste.local/: Authelia's own <html lang>  
✅ `19:17:29` …not rewritten (no language)  

## Every locale path answers the domain's language

✅ `19:17:29` auth.lamaste-second.local/locales/en/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `19:17:29` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `19:17:29` auth.lamaste-second.local/locales/de-AT/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `19:17:29` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `19:17:29` auth.lamaste-second.local/locales/tr/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `19:17:29` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `19:17:30` …settings.json the same file for de-AT and tr  
✅ `19:17:30` …and not C's  
✅ `19:17:30` …consent.json answered for ar as well  
✅ `19:17:30` auth.lamaste-third.local/locales/tr/portal.json: English (Loading)  
✅ `19:17:30` auth.lamaste-third.local/locales/de-AT/portal.json: English (Loading)  
✅ `19:17:30` …Authelia's English, no brand to splice  
✅ `19:17:31` auth.test.lamaste.local/locales/tr/portal.json: Authelia's own (its Turkish lacks "Loading")  
✅ `19:17:31` …and its de-AT is not its English  

## The invitation page and the inviter's page: Turkish on B, English on C and A

✅ `19:17:31` auth.<B|C|A>/invite: 200  
✅ `19:17:31` B: lang="tr"  
✅ `19:17:31` …titled E2E Marka 56 — Daveti kabul edin  
✅ `19:17:31` …its data block: tr, invite.title Daveti kabul edin  
✅ `19:17:31` …invite.invalidLink in Turkish  
✅ `19:17:31` C: lang="en"  
✅ `19:17:31` …the stock English title  
✅ `19:17:31` …its data block: en  
✅ `19:17:31` A (no language): lang="en"  
✅ `19:17:32` …its data block: en  
✅ `19:17:32` B with Accept-Language: en-US: still Turkish (the domain decides)  
✅ `19:17:32` A with Accept-Language: tr-TR: still English  
✅ `19:17:32` B's and C's invitation page: byte for byte the same script  
✅ `19:17:32` …and A's  
✅ `19:17:32` …one Content-Security-Policy on B and C  
✅ `19:17:32` …and A  
✅ `19:17:32` The inviter's page on B: lang="tr"  
✅ `19:17:32` …titled E2E Marka 56 — Kişi davet edin  
✅ `19:17:32` …its data block: tr  
✅ `19:17:32` …on C: Lamaste — Invite People  
✅ `19:17:32` …one Content-Security-Policy on B and C  

## The plugin installed on B; its site before approval: the "not available" page in Turkish

✅ `19:17:32` Fixture built: @lamalibre/e2e-plang-server  
✅ `19:17:42` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-plang-server, @lamalibre/e2e-plang-agent )  
✅ `19:17:42` The agent VM reaches it at http://10.13.37.1:4874  
✅ `19:17:43` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T19:17:43.355Z"})  
✅ `19:17:43` …through its own OIDC client  
✅ `19:17:47` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `19:17:52` Installed @lamalibre/e2e-plang-server@1.0.0, not approved  
✅ `19:17:52` …moved to B  
✅ `19:17:55` Its web surface created, restricted  
✅ `19:17:55` …not served: not approved  
✅ `19:17:55` https://e2e56web.lamaste-second.local/: 503 until it is served  
✅ `19:17:55` …Lamaste's page, lang="tr" (P8)  
✅ `19:17:55` …Uygulama şu anda kullanılamıyor  
✅ `19:17:55` …Lütfen birkaç dakika sonra yeniden deneyin.  
✅ `19:17:55` …in B's brand  
✅ `19:17:55` …not nginx's stock page  
✅ `19:17:55` …its CSP names its style by hash  
✅ `19:17:55` …never cached  

## Approved, hosted, served

✅ `19:17:56` e2e-plang approved  
✅ `19:18:07` …hosted on test-agent ()  
✅ `19:18:27` …its hosting is up  
✅ `19:18:27` …ready: its agent half's first complete sync ended at the head  
✅ `19:18:27` …its web surface served  

## A coordinator (external of B), a member of B and C, a member of A alone; tunnels on B and C

✅ `19:18:28` User e2e56-coord created, member of lamaste-second.local (external)  
✅ `19:18:29` User e2e56-member created, member of lamaste-second.local and lamaste-third.local  
✅ `19:18:29` User e2e56-outsider created, member of test.lamaste.local  
✅ `19:18:32` Tunnel e2e56bauth.lamaste-second.local (authenticated), carried by test-agent  
✅ `19:18:35` Tunnel e2e56bres.lamaste-second.local (restricted), carried by test-agent  
✅ `19:18:38` Tunnel e2e56cres.lamaste-third.local (restricted), carried by test-agent  
✅ `19:18:41` Tunnel e2e56cauth.lamaste-third.local (authenticated), carried by test-agent  
✅ `19:18:41` e2e56-coord entitled as coordinator  
✅ `19:18:41` Granted site 006f84cd-218e-42cd-b0e5-d4fc90d0d2de to user e2e56-coord  
✅ `19:18:42` The audience holds e2e56-coord as coordinator  
✅ `19:18:42` Invitations enabled for e2e-plang  
✅ `19:18:44` e2e56-coord signed in at auth.lamaste-second.local (password, TOTP)  

## The refusals the pages map: each with its code

✅ `19:18:44` A token nobody holds: 404  
✅ `19:18:44` …invitation_not_found  
✅ `19:18:44` e2e56-coord invites ayse@example.test as viewer: 201  
✅ `19:18:44` …a link on the sign-in host, the token in its fragment  
✅ `19:18:45` …and revokes it  
✅ `19:18:45` Its token: 410  
✅ `19:18:45` …invitation_closed  
✅ `19:18:45` The inviter revokes an invitation that does not exist: 404  
✅ `19:18:45` …not_found (the inviter's page's key)  
✅ `19:18:45` e2e56-coord invites deniz@example.test as viewer: 201  
✅ `19:18:45` …a link on the sign-in host, the token in its fragment  
✅ `19:18:46` Accepted  
✅ `19:18:46` Its token once used: 410  
✅ `19:18:46` …invitation_used  
✅ `19:18:46` …the API answers codes, never the page's words  

## The access-request page: Turkish on B, English on C (P6)

✅ `19:18:48` e2e56-invitee-1794338235 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `19:18:48` e2e56-invitee-1794338235 (external, not granted) on B's authenticated tunnel: 403  
✅ `19:18:48` …the access-request page in Turkish (lang="tr")  
✅ `19:18:48` …Erişim izni gerekiyor  
✅ `19:18:48` …Giriş yapılan hesap: e2e56-invitee-1794338235  
✅ `19:18:48` …its e-mail template's Subject is Konu:  
✅ `19:18:48` …the subject in Turkish  
✅ `19:18:48` …the message templates in Turkish  
✅ `19:18:48` …no English heading  
✅ `19:18:50` e2e56-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `19:18:51` e2e56-member (member of B, no grant) on B's restricted tunnel: 403  
✅ `19:18:51` …in Turkish  
✅ `19:19:02` e2e56-member signed in at auth.lamaste-third.local (password, TOTP)  
✅ `19:19:03` e2e56-member (member of C, no grant) on C's restricted tunnel: 403  
✅ `19:19:03` …the access-request page  
✅ `19:19:03` …not the domain refusal  
✅ `19:19:03` …never a redirect to a sign-in page  
✅ `19:19:03` …in English (lang="en")  
✅ `19:19:03` …Subject:  

## The domain refusal: Turkish on B, English on C (P7)

✅ `19:19:04` e2e56-outsider signed in at auth.lamaste-second.local (password, TOTP)  
✅ `19:19:05` e2e56-outsider (member of A alone) on B's tunnel: 403  
✅ `19:19:05` …the domain refusal in Turkish (lang="tr")  
✅ `19:19:05` …lamaste-second.local üyesi değilsiniz  
✅ `19:19:05` …titled İzin verilmiyor — lamaste-second.local  
✅ `19:19:05` …the sign-out link in Turkish, on B's sign-in host  
✅ `19:19:05` …no English  
✅ `19:19:32` e2e56-outsider signed in at auth.lamaste-third.local (password, TOTP)  
✅ `19:19:33` e2e56-outsider on C's tunnel: 403  
✅ `19:19:33` …the domain refusal page  
✅ `19:19:33` …naming lamaste-third.local  
✅ `19:19:33` …never a redirect to a sign-in page (no login loop)  
✅ `19:19:33` …in English (lang="en")  

## Gatekeeper's "not allowed" page follows the domain the path names (P9)

✅ `19:19:33` A shell check of e2e56web.lamaste-second.local without its original request: 403  
✅ `19:19:33` …Gatekeeper's page in Turkish (lang="tr")  
✅ `19:19:33` …İzin verilmiyor  
✅ `19:19:33` …for a host on C: in English  
✅ `19:19:33` …Not Allowed  

## B and C back to unset

✅ `19:19:35` PUT /api/domains/lamaste-second.local/language {language: null}: cleared, no warning  
✅ `19:19:35` auth.lamaste-second.local/: lang no longer rewritten  
✅ `19:19:35` …its de-AT locale is no longer the forced Turkish  
✅ `19:19:35` …its menu shown again (brand.css without the rule)  
✅ `19:19:35` …its invitation page in English  
✅ `19:19:35` …with its brand  
✅ `19:19:36` lamaste-third.local cleared  
✅ `19:19:36` …its language-only rendering is gone  
✅ `19:19:36` auth.lamaste-third.local/brand.css: 404  
✅ `19:19:36` The audit: domain.language.updated for lamaste-second.local, null → tr, then tr → null  
✅ `19:19:36` …for lamaste-third.local, null → en, then en → null  
✅ `19:19:36` Clearing the languages restarted no Authelia  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `172` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `172` |

ℹ️ `19:19:36` Cleaning up test resources...  
