# Lamaste E2E: 52 — Per-domain branding: two brands, a stock third (Three-VM)

> Started at `2026-11-02 16:56:23 UTC`


## Pre-flight

✅ `16:56:23` Onboarding is complete  
✅ `16:56:23` Agent test-agent is enrolled on the host  
✅ `16:56:23` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domains B and C active; the image fixtures

✅ `16:56:24` Domain lamaste-second.local added (201)  
✅ `16:56:24` …pending until activated  
✅ `16:56:24` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `16:56:24` …the one required record is auth.lamaste-second.local  
✅ `16:56:26` lamaste-second.local is active  
✅ `16:56:26` Domain lamaste-third.local added (201)  
✅ `16:56:26` …pending until activated  
✅ `16:56:26` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `16:56:26` …the one required record is auth.lamaste-third.local  
✅ `16:56:28` lamaste-third.local is active  
✅ `16:56:28` Four image fixtures written on the host VM, each with a digest  
✅ `16:56:28` …all four distinct  
✅ `16:56:29` Authelia's asset directory holds the placeholder logo (/etc/authelia/assets/logo.png)  
✅ `16:56:29` nginx's mime.types names a type for .ico (image/x-icon)  

## Brand A (dark, logo, ICO favicon) and brand B (light, logo, PNG favicon); C stays stock

✅ `16:56:30` PUT /api/domains/test.lamaste.local/branding: Brand A, dark, #1d4ed8, support contact  
✅ `16:56:30` …created at revision 1, dark, no warning  
✅ `16:56:30` PUT …/branding/logo: logo A (base64 in JSON)  
✅ `16:56:30` …revision 2, a 48×48 PNG, no warning  
✅ `16:56:30` …the answer's digest is the fixture's  
✅ `16:56:31` PUT …/branding/favicon: favicon A, an ICO — revision 3, its digest, no warning  
✅ `16:56:32` PUT /api/domains/lamaste-second.local/branding: Brand B, light, #b91c1c, nothing else  
✅ `16:56:32` Logo B set — revision 2, the fixture's digest  
✅ `16:56:33` Favicon B set, a PNG — revision 3, the fixture's digest  
✅ `16:56:33` lamaste-third.local has no brand  
✅ `16:56:33` Both brands are rendered at their revision (renderedCurrent)  

## The sign-in pages: theme, logo switch, stylesheet — C is the stock page

✅ `16:56:33` auth.test.lamaste.local/: 200  
✅ `16:56:33` …data-theme="dark" (A's theme)  
✅ `16:56:33` …data-logooverride="true" (A serves a logo)  
✅ `16:56:33` …links /brand.css  
✅ `16:56:33` …Authelia's Content-Security-Policy is sent, style-src 'self' as Authelia writes it  
✅ `16:56:33` …no light theme left anywhere in the page  
✅ `16:56:33` auth.lamaste-second.local/: data-theme="light" (B's theme)  
✅ `16:56:33` …data-logooverride="true" (B serves a logo)  
✅ `16:56:33` …links /brand.css  
✅ `16:56:34` auth.lamaste-third.local/: 200  
✅ `16:56:34` …data-theme="light" (the stock theme)  
✅ `16:56:34` …data-logooverride="false" (the placeholder is never shown)  
✅ `16:56:34` …no stylesheet: exactly the stock page  
✅ `16:56:34` …the same CSP as a branded domain's  

## /brand.css: the accent, the hidden footer, the asset headers

✅ `16:56:34` auth.test.lamaste.local/brand.css: 200  
✅ `16:56:34` …text/css (by the extension)  
✅ `16:56:34` …X-Content-Type-Options: nosniff  
✅ `16:56:34` …Cache-Control: public, max-age=0, must-revalidate  
✅ `16:56:34` …--primary is A's accent  
✅ `16:56:34` …the "Powered by" footer link is hidden  
✅ `16:56:34` auth.lamaste-second.local/brand.css: --primary is B's accent  
✅ `16:56:34` auth.lamaste-third.local/brand.css: 404 (no brand, no stylesheet)  

## The logos and favicons: the fixtures' bytes; C gets Authelia's

✅ `16:56:34` auth.test.lamaste.local/static/media/logo.png: logo A's bytes, image/png  
✅ `16:56:34` auth.lamaste-second.local/static/media/logo.png: logo B's bytes  
✅ `16:56:34` auth.lamaste-third.local/static/media/logo.png: Authelia's placeholder (the asset directory's logo.png)  
✅ `16:56:34` auth.test.lamaste.local/favicon.ico: favicon A's bytes, image/x-icon  
✅ `16:56:34` auth.lamaste-second.local/favicon.ico: favicon B's PNG bytes under the .ico name, image/x-icon by the extension  
✅ `16:56:34` auth.lamaste-third.local/favicon.ico: 200, Authelia's own  
✅ `16:56:34` …not favicon A  
✅ `16:56:34` …not favicon B  

## The locale files: the brand name in place of {{authelia}}, in English and Turkish

✅ `16:56:35` auth.test.lamaste.local/locales/en/portal.json: "Login - {{authelia}}" → "Login - Brand A"  
✅ `16:56:35` …"Powered by {{authelia}}" → "Powered by Brand A"  
✅ `16:56:35` …no {{authelia}} left in any value  
✅ `16:56:35` auth.test.lamaste.local/locales/tr/portal.json: the Turkish title carries Brand A (Giriş - Brand A)  
✅ `16:56:35` …and no placeholder  
✅ `16:56:35` auth.lamaste-second.local/locales/en/portal.json says Brand B  
✅ `16:56:35` auth.lamaste-third.local/locales/en/portal.json is Authelia's own: the title still interpolates {{authelia}}  
✅ `16:56:35` …no brand of another domain  
✅ `16:56:35` auth.test.lamaste.local/locales/en/settings.json carries Brand A too  

## The invitation page: A's branded, C's the stock page, the same script

✅ `16:56:35` auth.test.lamaste.local/invite/x: 200  
✅ `16:56:35` …titled Brand A — Accept Invitation  
✅ `16:56:35` …the brand's name in the header  
✅ `16:56:35` …and its tagline  
✅ `16:56:35` …the logo from the same origin  
✅ `16:56:35` …its colours from /brand.css (the inline style is one text for every brand: one CSP hash a release)  
✅ `16:56:35` …which carries the accent  
✅ `16:56:35` auth.lamaste-third.local/invite/x: 200  
✅ `16:56:35` …the stock page  
✅ `16:56:35` …no brand header  
✅ `16:56:35` Both pages carry a script of the same length  
✅ `16:56:35` …byte for byte the same script (the API calls, and the CSP hash, are one)  

## A member of A; a tunnel on each domain (B and C authenticated, A restricted)

✅ `16:56:36` User e2e52-a created, member of test.lamaste.local  
✅ `16:56:36` e2e52-a has a directory id  
✅ `16:56:38` Tunnel e2e52b.lamaste-second.local (authenticated), carried by test-agent  
✅ `16:56:40` Tunnel e2e52a.test.lamaste.local (restricted), carried by test-agent  
✅ `16:56:41` Tunnel e2e52c.lamaste-third.local (authenticated), carried by test-agent  
✅ `16:56:43` e2e52-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `16:57:02` e2e52-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `16:57:32` e2e52-a signed in at auth.lamaste-third.local (password, TOTP)  

## The domain refusal on B's tunnel carries brand B

✅ `16:57:32` e2e52-a (a member of A) on B's tunnel: 403  
✅ `16:57:32` …the domain refusal page  
✅ `16:57:32` …naming lamaste-second.local  
✅ `16:57:32` …never a redirect to a sign-in page (no login loop)  
✅ `16:57:32` …titled with Brand B  
✅ `16:57:32` …Brand B in the header  
✅ `16:57:32` …the logo from B's sign-in host  
✅ `16:57:32` …B's accent  
✅ `16:57:32` …no Help link (B names no support URL)  
✅ `16:57:32` …nothing of brand A  

## The access-request page on A's restricted tunnel carries brand A and its support contact

✅ `16:57:33` e2e52-a on A's restricted tunnel without a grant: 403  
✅ `16:57:33` …the access-request page  
✅ `16:57:33` …not the domain refusal  
✅ `16:57:33` …never a redirect to a sign-in page  
✅ `16:57:33` …titled with Brand A  
✅ `16:57:33` …Brand A in the header  
✅ `16:57:33` …its tagline  
✅ `16:57:33` …the logo from A's sign-in host  
✅ `16:57:33` …A's accent  
✅ `16:57:33` …the brand's support e-mail as the contact  
✅ `16:57:33` …and its support URL as the Help link  

## On C's tunnel the refusal is the stock page

✅ `16:57:33` e2e52-a on C's tunnel: 403  
✅ `16:57:33` …the domain refusal page  
✅ `16:57:33` …naming lamaste-third.local  
✅ `16:57:33` …never a redirect to a sign-in page (no login loop)  
✅ `16:57:33` …titled without a brand  
✅ `16:57:33` …no brand header  
✅ `16:57:33` …the pages' own accent  

## A's theme changed to oled: the page and its vhost follow

✅ `16:57:34` PUT …/branding with theme oled: revision 4, no warning  
✅ `16:57:34` auth.test.lamaste.local/ says data-theme="oled"  
✅ `16:57:34` The installed auth vhost of test.lamaste.local rewrites the theme to oled  
✅ `16:57:34` …and keeps the logo switch on  
✅ `16:57:34` nginx -t passes  

## A's logo removed: the logo switch off, the placeholder back

✅ `16:57:35` DELETE …/branding/logo: removed, revision 5, no warning  
✅ `16:57:35` auth.test.lamaste.local/ says data-logooverride="false"  
✅ `16:57:35` auth.test.lamaste.local/static/media/logo.png is Authelia's placeholder again  
✅ `16:57:35` …the stylesheet stays (the brand does)  

## B's brand removed: the stock page, its rendering gone

✅ `16:57:35` DELETE /api/domains/lamaste-second.local/branding: removed, no warning  
✅ `16:57:36` GET says lamaste-second.local has no brand  
✅ `16:57:36` auth.lamaste-second.local/ is the stock page: data-logooverride="false", no stylesheet  
✅ `16:57:36` …data-theme="light"  
✅ `16:57:36` auth.lamaste-second.local/brand.css: 404  
✅ `16:57:36` auth.lamaste-second.local/static/media/logo.png: the placeholder  
✅ `16:57:36` /var/www/lamaste/auth/lamaste-second.local is gone  
✅ `16:57:36` No rendering of lamaste-second.local is left under .renders/  
✅ `16:57:36` Exactly one rendering of test.lamaste.local serves (the previous ones removed)  

## The audit names fields and digests, never the name or the bytes

✅ `16:57:36` Five domain.branding.updated entries for test.lamaste.local: fields, logo, favicon, fields, logo removed  
✅ `16:57:36` …the field entries name the fields (name, theme, accent, …)  
✅ `16:57:36` …the logo entry carries its digest  
✅ `16:57:36` …and the removal is one entry  
✅ `16:57:36` …revisions 1 to 5  
✅ `16:57:36` …no entry carries the brand's name  
✅ `16:57:36` …nor the logo's bytes  
✅ `16:57:37` One domain.branding.removed entry for lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `141` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `141` |

ℹ️ `16:57:37` Cleaning up test resources...  
