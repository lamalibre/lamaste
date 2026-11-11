# Lamaste E2E: 52 — Per-domain branding: two brands, a stock third (Three-VM)

> Started at `2026-11-11 10:04:48 UTC`


## Pre-flight

✅ `10:04:49` Onboarding is complete  
✅ `10:04:49` Agent test-agent is enrolled on the host  
✅ `10:04:49` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domains B and C active; the image fixtures

✅ `10:04:50` Domain lamaste-second.local added (201)  
✅ `10:04:50` …pending until activated  
✅ `10:04:50` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `10:04:50` …the one required record is auth.lamaste-second.local  
✅ `10:04:52` lamaste-second.local is active  
✅ `10:04:52` Domain lamaste-third.local added (201)  
✅ `10:04:52` …pending until activated  
✅ `10:04:53` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `10:04:53` …the one required record is auth.lamaste-third.local  
✅ `10:04:54` lamaste-third.local is active  
✅ `10:04:55` Four image fixtures written on the host VM, each with a digest  
✅ `10:04:55` …all four distinct  
✅ `10:04:55` Authelia's asset directory holds the placeholder logo (/etc/authelia/assets/logo.png)  
✅ `10:04:55` nginx's mime.types names a type for .ico (image/x-icon)  

## Brand A (dark, logo, ICO favicon) and brand B (light, logo, PNG favicon); C stays stock

✅ `10:04:57` PUT /api/domains/test.lamaste.local/branding: Brand A, dark, #1d4ed8, support contact  
✅ `10:04:57` …created at revision 1, dark, no warning  
✅ `10:04:58` PUT …/branding/logo: logo A (base64 in JSON)  
✅ `10:04:58` …revision 2, a 48×48 PNG, no warning  
✅ `10:04:58` …the answer's digest is the fixture's  
✅ `10:05:00` PUT …/branding/favicon: favicon A, an ICO — revision 3, its digest, no warning  
✅ `10:05:01` PUT /api/domains/lamaste-second.local/branding: Brand B, light, #b91c1c, nothing else  
✅ `10:05:02` Logo B set — revision 2, the fixture's digest  
✅ `10:05:04` Favicon B set, a PNG — revision 3, the fixture's digest  
✅ `10:05:04` lamaste-third.local has no brand  
✅ `10:05:04` Both brands are rendered at their revision (renderedCurrent)  

## The sign-in pages: theme, logo switch, stylesheet — C is the stock page

✅ `10:05:04` auth.test.lamaste.local/: 200  
✅ `10:05:04` …data-theme="dark" (A's theme)  
✅ `10:05:04` …data-logooverride="true" (A serves a logo)  
✅ `10:05:04` …links /brand.css  
✅ `10:05:04` …Authelia's Content-Security-Policy is sent, style-src 'self' as Authelia writes it  
✅ `10:05:04` …no light theme left anywhere in the page  
✅ `10:05:04` auth.lamaste-second.local/: data-theme="light" (B's theme)  
✅ `10:05:04` …data-logooverride="true" (B serves a logo)  
✅ `10:05:04` …links /brand.css  
✅ `10:05:04` auth.lamaste-third.local/: 200  
✅ `10:05:04` …data-theme="light" (the stock theme)  
✅ `10:05:04` …data-logooverride="false" (the placeholder is never shown)  
✅ `10:05:04` …links /brand.css: the stock stylesheet (4.14: the change-password link)  
✅ `10:05:04` …the same CSP as a branded domain's  

## /brand.css: the accent, the hidden footer, the asset headers

✅ `10:05:05` auth.test.lamaste.local/brand.css: 200  
✅ `10:05:05` …text/css (by the extension)  
✅ `10:05:05` …X-Content-Type-Options: nosniff  
✅ `10:05:05` …Cache-Control: public, max-age=0, must-revalidate  
✅ `10:05:05` …--primary is A's accent  
✅ `10:05:05` …the "Powered by" footer link is hidden  
✅ `10:05:05` auth.lamaste-second.local/brand.css: --primary is B's accent  
✅ `10:05:05` auth.lamaste-third.local/brand.css: 200, the stock stylesheet (no brand)  
✅ `10:05:05` …no brand colours, the change-password link's rules alone  

## The logos and favicons: the fixtures' bytes; C gets Authelia's

✅ `10:05:05` auth.test.lamaste.local/static/media/logo.png: logo A's bytes, image/png  
✅ `10:05:05` auth.lamaste-second.local/static/media/logo.png: logo B's bytes  
✅ `10:05:05` auth.lamaste-third.local/static/media/logo.png: Authelia's placeholder (the asset directory's logo.png)  
✅ `10:05:05` auth.test.lamaste.local/favicon.ico: favicon A's bytes, image/x-icon  
✅ `10:05:06` auth.lamaste-second.local/favicon.ico: favicon B's PNG bytes under the .ico name, image/x-icon by the extension  
✅ `10:05:06` auth.lamaste-third.local/favicon.ico: 200, Authelia's own  
✅ `10:05:06` …not favicon A  
✅ `10:05:06` …not favicon B  

## The locale files: the brand name in place of {{authelia}}, in English and Turkish

✅ `10:05:06` auth.test.lamaste.local/locales/en/portal.json: "Login - {{authelia}}" → "Login - Brand A"  
✅ `10:05:06` …"Powered by {{authelia}}" → "Powered by Brand A"  
✅ `10:05:06` …no {{authelia}} left in any value  
✅ `10:05:06` auth.test.lamaste.local/locales/tr/portal.json: the Turkish title carries Brand A (Giriş - Brand A)  
✅ `10:05:06` …and no placeholder  
✅ `10:05:06` auth.lamaste-second.local/locales/en/portal.json says Brand B  
✅ `10:05:06` auth.lamaste-third.local/locales/en/portal.json is Authelia's own: the title still interpolates {{authelia}}  
✅ `10:05:06` …no brand of another domain  
✅ `10:05:06` auth.test.lamaste.local/locales/en/settings.json carries Brand A too  

## The invitation page: A's branded, C's the stock page, the same script

✅ `10:05:07` auth.test.lamaste.local/invite/x: 200  
✅ `10:05:07` …titled Brand A — Accept Invitation  
✅ `10:05:07` …the brand's name in the header  
✅ `10:05:07` …and its tagline  
✅ `10:05:07` …the logo from the same origin  
✅ `10:05:07` …its colours from /brand.css (the inline style is one text for every brand: one CSP hash a release)  
✅ `10:05:07` …which carries the accent  
✅ `10:05:07` auth.lamaste-third.local/invite/x: 200  
✅ `10:05:07` …the stock page  
✅ `10:05:07` …no brand header  
✅ `10:05:07` Both pages carry a script of the same length  
✅ `10:05:07` …byte for byte the same script (the API calls, and the CSP hash, are one)  

## A member of A; a tunnel on each domain (B and C authenticated, A restricted)

✅ `10:05:08` User e2e52-a created, member of test.lamaste.local  
✅ `10:05:08` e2e52-a has a directory id  
✅ `10:05:10` Tunnel e2e52b.lamaste-second.local (authenticated), carried by test-agent  
✅ `10:05:12` Tunnel e2e52a.test.lamaste.local (restricted), carried by test-agent  
✅ `10:05:15` Tunnel e2e52c.lamaste-third.local (authenticated), carried by test-agent  
✅ `10:05:17` e2e52-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:05:33` e2e52-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `10:06:03` e2e52-a signed in at auth.lamaste-third.local (password, TOTP)  

## The domain refusal on B's tunnel carries brand B

✅ `10:06:03` e2e52-a (a member of A) on B's tunnel: 403  
✅ `10:06:03` …the domain refusal page  
✅ `10:06:03` …naming lamaste-second.local  
✅ `10:06:03` …never a redirect to a sign-in page (no login loop)  
✅ `10:06:03` …titled with Brand B  
✅ `10:06:03` …Brand B in the header  
✅ `10:06:03` …the logo from B's sign-in host  
✅ `10:06:03` …B's accent  
✅ `10:06:03` …no Help link (B names no support URL)  
✅ `10:06:03` …nothing of brand A  

## The access-request page on A's restricted tunnel carries brand A and its support contact

✅ `10:06:03` e2e52-a on A's restricted tunnel without a grant: 403  
✅ `10:06:03` …the access-request page  
✅ `10:06:03` …not the domain refusal  
✅ `10:06:03` …never a redirect to a sign-in page  
✅ `10:06:03` …titled with Brand A  
✅ `10:06:03` …Brand A in the header  
✅ `10:06:03` …its tagline  
✅ `10:06:03` …the logo from A's sign-in host  
✅ `10:06:03` …A's accent  
✅ `10:06:03` …the brand's support e-mail as the contact  
✅ `10:06:03` …and its support URL as the Help link  

## On C's tunnel the refusal is the stock page

✅ `10:06:04` e2e52-a on C's tunnel: 403  
✅ `10:06:04` …the domain refusal page  
✅ `10:06:04` …naming lamaste-third.local  
✅ `10:06:04` …never a redirect to a sign-in page (no login loop)  
✅ `10:06:04` …titled without a brand  
✅ `10:06:04` …no brand header  
✅ `10:06:04` …the pages' own accent  

## A's theme changed to oled: the page and its vhost follow

✅ `10:06:05` PUT …/branding with theme oled: revision 4, no warning  
✅ `10:06:05` auth.test.lamaste.local/ says data-theme="oled"  
✅ `10:06:05` The installed auth vhost of test.lamaste.local rewrites the theme to oled  
✅ `10:06:05` …and keeps the logo switch on  
✅ `10:06:06` nginx -t passes  

## A's logo removed: the logo switch off, the placeholder back

✅ `10:06:07` DELETE …/branding/logo: removed, revision 5, no warning  
✅ `10:06:07` auth.test.lamaste.local/ says data-logooverride="false"  
✅ `10:06:07` auth.test.lamaste.local/static/media/logo.png is Authelia's placeholder again  
✅ `10:06:07` …the stylesheet stays (the brand does)  

## B's brand removed: the stock page, its rendering gone

✅ `10:06:08` DELETE /api/domains/lamaste-second.local/branding: removed, no warning  
✅ `10:06:08` GET says lamaste-second.local has no brand  
✅ `10:06:08` auth.lamaste-second.local/ is the stock page: data-logooverride="false", the stock stylesheet  
✅ `10:06:08` …data-theme="light"  
✅ `10:06:09` auth.lamaste-second.local/brand.css: the stock stylesheet, no brand colours  
✅ `10:06:09` auth.lamaste-second.local/static/media/logo.png: the placeholder  
✅ `10:06:09` /var/www/lamaste/auth/lamaste-second.local is gone  
✅ `10:06:09` No rendering of lamaste-second.local is left under .renders/  
✅ `10:06:09` Exactly one rendering of test.lamaste.local serves (the previous ones removed)  

## The audit names fields and digests, never the name or the bytes

✅ `10:06:09` Five domain.branding.updated entries for test.lamaste.local: fields, logo, favicon, fields, logo removed  
✅ `10:06:09` …the field entries name the fields (name, theme, accent, …)  
✅ `10:06:09` …the logo entry carries its digest  
✅ `10:06:09` …and the removal is one entry  
✅ `10:06:09` …revisions 1 to 5  
✅ `10:06:09` …no entry carries the brand's name  
✅ `10:06:09` …nor the logo's bytes  
✅ `10:06:09` One domain.branding.removed entry for lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `142` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `142` |

ℹ️ `10:06:09` Cleaning up test resources...  
