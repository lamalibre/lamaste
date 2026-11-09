# Lamaste E2E: 56 — A domain's page language: Turkish where set, English elsewhere (Three-VM)

> Started at `2026-11-09 14:06:44 UTC`


## Pre-flight

✅ `14:06:44` Onboarding is complete  
✅ `14:06:44` Agent test-agent is enrolled on the host  
✅ `14:06:45` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:06:45` The agent VM's lamaste-agent has the apphost command  
✅ `14:06:45` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `14:06:45` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## B and C active; B branded; A, the primary, left alone

✅ `14:06:46` Domain lamaste-second.local added (201)  
✅ `14:06:46` …pending until activated  
✅ `14:06:46` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:06:46` …the one required record is auth.lamaste-second.local  
✅ `14:06:47` lamaste-second.local is active  
✅ `14:06:48` Domain lamaste-third.local added (201)  
✅ `14:06:48` …pending until activated  
✅ `14:06:48` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `14:06:48` …the one required record is auth.lamaste-third.local  
✅ `14:06:50` lamaste-third.local is active  
✅ `14:06:50` No domain has a language yet  
✅ `14:06:51` B branded E2E Marka 56, no warning  
✅ `14:06:51` …rendered  

## B speaks Turkish, C English

✅ `14:06:52` PUT /api/domains/lamaste-second.local/language {language: tr}: 200  
✅ `14:06:52` …changed, tr, no warning  
✅ `14:06:52` PUT /api/domains/lamaste-third.local/language {language: en}: changed, no warning  
✅ `14:06:52` The same language again: unchanged  
✅ `14:06:52` GET /api/domains: A none, B tr, C en  
✅ `14:06:53` B's rendering (brand and language) and C's (language alone) are current  
✅ `14:06:53` …C's rendering: revision 0 (no brand), language en  
✅ `14:06:53` The running Authelia is the pinned release ({"running":"4.39.28","pinned":"4.39.28"})  
✅ `14:06:53` Setting a language restarted no Authelia  

## The sign-in page: lang follows the domain, the menu hidden

✅ `14:06:53` auth.lamaste-second.local/: <html lang="tr" data-authelia-lang="…">  
✅ `14:06:53` …its noscript sentence in Turkish (ASCII character references)  
✅ `14:06:53` …links /brand.css  
✅ `14:06:53` auth.lamaste-second.local/brand.css hides the language menu (#language-button)  
✅ `14:06:53` …and keeps the brand's accent  
✅ `14:06:53` auth.lamaste-third.local/: <html lang="en" data-authelia-lang="…">  
✅ `14:06:54` …no Turkish noscript sentence  
✅ `14:06:54` auth.lamaste-third.local/brand.css hides the menu too (a language, no brand)  
✅ `14:06:54` auth.test.lamaste.local/: Authelia's own <html lang>  
✅ `14:06:54` …not rewritten (no language)  

## Every locale path answers the domain's language

✅ `14:06:54` auth.lamaste-second.local/locales/en/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `14:06:54` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `14:06:54` auth.lamaste-second.local/locales/de-AT/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `14:06:54` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `14:06:54` auth.lamaste-second.local/locales/tr/portal.json: "Loading" is Lamaste's supplement, Yükleniyor  
✅ `14:06:54` …"Powered by" corrected and brand-spliced: Altyapı: E2E Marka 56  
✅ `14:06:55` …settings.json the same file for de-AT and tr  
✅ `14:06:55` …and not C's  
✅ `14:06:55` …consent.json answered for ar as well  
✅ `14:06:55` auth.lamaste-third.local/locales/tr/portal.json: English (Loading)  
✅ `14:06:55` auth.lamaste-third.local/locales/de-AT/portal.json: English (Loading)  
✅ `14:06:55` …Authelia's English, no brand to splice  
✅ `14:06:55` auth.test.lamaste.local/locales/tr/portal.json: Authelia's own (its Turkish lacks "Loading")  
✅ `14:06:55` …and its de-AT is not its English  

## The invitation page and the inviter's page: Turkish on B, English on C and A

✅ `14:06:56` auth.<B|C|A>/invite: 200  
✅ `14:06:56` B: lang="tr"  
✅ `14:06:56` …titled E2E Marka 56 — Daveti kabul edin  
✅ `14:06:56` …its data block: tr, invite.title Daveti kabul edin  
✅ `14:06:56` …invite.invalidLink in Turkish  
✅ `14:06:56` C: lang="en"  
✅ `14:06:56` …the stock English title  
✅ `14:06:56` …its data block: en  
✅ `14:06:56` A (no language): lang="en"  
✅ `14:06:56` …its data block: en  
✅ `14:06:56` B with Accept-Language: en-US: still Turkish (the domain decides)  
✅ `14:06:56` A with Accept-Language: tr-TR: still English  
✅ `14:06:56` B's and C's invitation page: byte for byte the same script  
✅ `14:06:56` …and A's  
✅ `14:06:56` …one Content-Security-Policy on B and C  
✅ `14:06:56` …and A  
✅ `14:06:56` The inviter's page on B: lang="tr"  
✅ `14:06:57` …titled E2E Marka 56 — Kişi davet edin  
✅ `14:06:57` …its data block: tr  
✅ `14:06:57` …on C: Lamaste — Invite People  
✅ `14:06:57` …one Content-Security-Policy on B and C  

## The plugin installed on B; its site before approval: the "not available" page in Turkish

✅ `14:06:57` Fixture built: @lamalibre/e2e-plang-server  
✅ `14:07:06` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-plang-server, @lamalibre/e2e-plang-agent )  
✅ `14:07:06` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:07:07` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T14:07:07.201Z"})  
✅ `14:07:07` …through its own OIDC client  
✅ `14:07:11` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:07:15` Installed @lamalibre/e2e-plang-server@1.0.0, not approved  
✅ `14:07:16` …moved to B  
✅ `14:07:17` Its web surface created, restricted  
✅ `14:07:17` …not served: not approved  
✅ `14:07:18` https://e2e56web.lamaste-second.local/: 503 until it is served  
✅ `14:07:18` …Lamaste's page, lang="tr" (P8)  
✅ `14:07:18` …Uygulama şu anda kullanılamıyor  
✅ `14:07:18` …Lütfen birkaç dakika sonra yeniden deneyin.  
✅ `14:07:18` …in B's brand  
✅ `14:07:18` …not nginx's stock page  
✅ `14:07:18` …its CSP names its style by hash  
✅ `14:07:18` …never cached  

## Approved, hosted, served

✅ `14:07:18` e2e-plang approved  
✅ `14:07:29` …hosted on test-agent ()  
✅ `14:07:45` …its hosting is up  
✅ `14:07:45` …ready: its agent half's first complete sync ended at the head  
✅ `14:07:46` …its web surface served  

## A coordinator (external of B), a member of B and C, a member of A alone; tunnels on B and C

✅ `14:07:46` User e2e56-coord created, member of lamaste-second.local (external)  
✅ `14:07:47` User e2e56-member created, member of lamaste-second.local and lamaste-third.local  
✅ `14:07:47` User e2e56-outsider created, member of test.lamaste.local  
✅ `14:07:49` Tunnel e2e56bauth.lamaste-second.local (authenticated), carried by test-agent  
✅ `14:07:51` Tunnel e2e56bres.lamaste-second.local (restricted), carried by test-agent  
✅ `14:07:53` Tunnel e2e56cres.lamaste-third.local (restricted), carried by test-agent  
✅ `14:07:55` Tunnel e2e56cauth.lamaste-third.local (authenticated), carried by test-agent  
✅ `14:07:56` e2e56-coord entitled as coordinator  
✅ `14:07:56` Granted site 2c254033-e661-4675-b286-c311d74230b8 to user e2e56-coord  
✅ `14:07:56` The audience holds e2e56-coord as coordinator  
✅ `14:07:56` Invitations enabled for e2e-plang  
✅ `14:07:58` e2e56-coord signed in at auth.lamaste-second.local (password, TOTP)  

## The refusals the pages map: each with its code

✅ `14:07:58` A token nobody holds: 404  
✅ `14:07:58` …invitation_not_found  
✅ `14:07:58` e2e56-coord invites ayse@example.test as viewer: 201  
✅ `14:07:58` …a link on the sign-in host, the token in its fragment  
✅ `14:07:58` …and revokes it  
✅ `14:07:58` Its token: 410  
✅ `14:07:58` …invitation_closed  
✅ `14:07:58` The inviter revokes an invitation that does not exist: 404  
✅ `14:07:58` …not_found (the inviter's page's key)  
✅ `14:07:59` e2e56-coord invites deniz@example.test as viewer: 201  
✅ `14:07:59` …a link on the sign-in host, the token in its fragment  
✅ `14:07:59` Accepted  
✅ `14:07:59` Its token once used: 410  
✅ `14:07:59` …invitation_used  
✅ `14:07:59` …the API answers codes, never the page's words  

## The access-request page: Turkish on B, English on C (P6)

✅ `14:08:01` e2e56-invitee-1794233204 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:08:01` e2e56-invitee-1794233204 (external, not granted) on B's authenticated tunnel: 403  
✅ `14:08:01` …the access-request page in Turkish (lang="tr")  
✅ `14:08:01` …Erişim izni gerekiyor  
✅ `14:08:01` …Giriş yapılan hesap: e2e56-invitee-1794233204  
✅ `14:08:01` …its e-mail template's Subject is Konu:  
✅ `14:08:01` …the subject in Turkish  
✅ `14:08:01` …the message templates in Turkish  
✅ `14:08:01` …no English heading  
✅ `14:08:03` e2e56-member signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:08:03` e2e56-member (member of B, no grant) on B's restricted tunnel: 403  
✅ `14:08:03` …in Turkish  
✅ `14:08:32` e2e56-member signed in at auth.lamaste-third.local (password, TOTP)  
✅ `14:08:33` e2e56-member (member of C, no grant) on C's restricted tunnel: 403  
✅ `14:08:33` …the access-request page  
✅ `14:08:33` …not the domain refusal  
✅ `14:08:33` …never a redirect to a sign-in page  
✅ `14:08:33` …in English (lang="en")  
✅ `14:08:33` …Subject:  

## The domain refusal: Turkish on B, English on C (P7)

✅ `14:08:34` e2e56-outsider signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:08:34` e2e56-outsider (member of A alone) on B's tunnel: 403  
✅ `14:08:34` …the domain refusal in Turkish (lang="tr")  
✅ `14:08:34` …lamaste-second.local üyesi değilsiniz  
✅ `14:08:34` …titled İzin verilmiyor — lamaste-second.local  
✅ `14:08:34` …the sign-out link in Turkish, on B's sign-in host  
✅ `14:08:34` …no English  
✅ `14:09:03` e2e56-outsider signed in at auth.lamaste-third.local (password, TOTP)  
✅ `14:09:03` e2e56-outsider on C's tunnel: 403  
✅ `14:09:03` …the domain refusal page  
✅ `14:09:03` …naming lamaste-third.local  
✅ `14:09:03` …never a redirect to a sign-in page (no login loop)  
✅ `14:09:03` …in English (lang="en")  

## Gatekeeper's "not allowed" page follows the domain the path names (P9)

✅ `14:09:03` A shell check of e2e56web.lamaste-second.local without its original request: 403  
✅ `14:09:03` …Gatekeeper's page in Turkish (lang="tr")  
✅ `14:09:03` …İzin verilmiyor  
✅ `14:09:04` …for a host on C: in English  
✅ `14:09:04` …Not Allowed  

## B and C back to unset

✅ `14:09:05` PUT /api/domains/lamaste-second.local/language {language: null}: cleared, no warning  
✅ `14:09:05` auth.lamaste-second.local/: lang no longer rewritten  
✅ `14:09:05` …its de-AT locale is no longer the forced Turkish  
✅ `14:09:05` …its menu shown again (brand.css without the rule)  
✅ `14:09:05` …its invitation page in English  
✅ `14:09:05` …with its brand  
✅ `14:09:05` lamaste-third.local cleared  
✅ `14:09:05` …its language-only rendering is gone  
✅ `14:09:06` auth.lamaste-third.local/brand.css: 404  
✅ `14:09:06` The audit: domain.language.updated for lamaste-second.local, null → tr, then tr → null  
✅ `14:09:06` …for lamaste-third.local, null → en, then en → null  
✅ `14:09:06` Clearing the languages restarted no Authelia  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `172` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `172` |

ℹ️ `14:09:06` Cleaning up test resources...  
