# Lamaste E2E: 52 — Per-domain branding: two brands, a stock third (Three-VM)

> Started at `2026-10-27 06:40:19 UTC`


## Pre-flight

✅ `06:40:19` Onboarding is complete  
✅ `06:40:19` Agent test-agent is enrolled on the host  
✅ `06:40:19` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domains B and C active; the image fixtures

✅ `06:40:20` Domain lamaste-second.local added (201)  
✅ `06:40:20` …pending until activated  
✅ `06:40:20` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `06:40:20` …the one required record is auth.lamaste-second.local  
✅ `06:40:21` lamaste-second.local is active  
✅ `06:40:21` Domain lamaste-third.local added (201)  
✅ `06:40:22` …pending until activated  
✅ `06:40:22` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `06:40:22` …the one required record is auth.lamaste-third.local  
✅ `06:40:23` lamaste-third.local is active  
✅ `06:40:24` Four image fixtures written on the host VM, each with a digest  
✅ `06:40:24` …all four distinct  
✅ `06:40:24` Authelia's asset directory holds the placeholder logo (/etc/authelia/assets/logo.png)  
✅ `06:40:24` nginx's mime.types names a type for .ico (image/x-icon)  

## Brand A (dark, logo, ICO favicon) and brand B (light, logo, PNG favicon); C stays stock

✅ `06:40:24` PUT /api/domains/test.lamaste.local/branding: Brand A, dark, #1d4ed8, support contact  
❌ `06:40:24` **…created at revision 1, dark, no warning (expected: 'true 1 dark 0', got: 'true 1 dark 1')**  
✅ `06:40:25` PUT …/branding/logo: logo A (base64 in JSON)  
❌ `06:40:25` **…revision 2, a 48×48 PNG, no warning (expected: 'true 2 png 48x48 0', got: 'true 2 png 48x48 1')**  
✅ `06:40:25` …the answer's digest is the fixture's  
❌ `06:40:25` **PUT …/branding/favicon: favicon A, an ICO — revision 3, its digest, no warning (expected: 'true 3 ico 5f341aaf5c6f5d9a7125334b658a0f152727e5ef143be5e3cea79987baa15bac 0', got: 'true 3 ico 5f341aaf5c6f5d9a7125334b658a0f152727e5ef143be5e3cea79987baa15bac 1')**  
❌ `06:40:25` **PUT /api/domains/lamaste-second.local/branding: Brand B, light, #b91c1c, nothing else (expected: 'true 1 light null null 0', got: 'true 1 light null null 1')**  
❌ `06:40:25` **Logo B set — revision 2, the fixture's digest (expected: '2 f026cc422c12263799e9cba7dc81059ee87db349b72e3984bf730908ff50dace 0', got: '2 f026cc422c12263799e9cba7dc81059ee87db349b72e3984bf730908ff50dace 1')**  
❌ `06:40:26` **Favicon B set, a PNG — revision 3, the fixture's digest (expected: '3 png a3b047474dedb4a7d708618dc180c44e9ffa206154f150686e02331eee2a422e 0', got: '3 png a3b047474dedb4a7d708618dc180c44e9ffa206154f150686e02331eee2a422e 1')**  
✅ `06:40:26` lamaste-third.local has no brand  
❌ `06:41:28` **A brand is not rendered: A null, B null**  

## The sign-in pages: theme, logo switch, stylesheet — C is the stock page

✅ `06:41:28` auth.test.lamaste.local/: 200  
✅ `06:41:28` …data-theme="dark" (A's theme)  
✅ `06:41:28` …data-logooverride="true" (A serves a logo)  
✅ `06:41:28` …links /brand.css  
✅ `06:41:28` …Authelia's Content-Security-Policy is sent, style-src 'self' as Authelia writes it  
✅ `06:41:28` …no light theme left anywhere in the page  
✅ `06:41:28` auth.lamaste-second.local/: data-theme="light" (B's theme)  
✅ `06:41:28` …data-logooverride="true" (B serves a logo)  
✅ `06:41:28` …links /brand.css  
✅ `06:41:28` auth.lamaste-third.local/: 200  
✅ `06:41:28` …data-theme="light" (the stock theme)  
✅ `06:41:28` …data-logooverride="false" (the placeholder is never shown)  
✅ `06:41:28` …no stylesheet: exactly the stock page  
✅ `06:41:28` …the same CSP as a branded domain's  

## /brand.css: the accent, the hidden footer, the asset headers

❌ `06:41:28` **auth.test.lamaste.local/brand.css: 200 (expected: '200', got: '404')**  
❌ `06:41:28` **…text/css (by the extension) (output does not contain: 'content-type: text/css')**  
❌ `06:41:28` **…X-Content-Type-Options: nosniff (output does not contain: 'x-content-type-options: nosniff')**  
❌ `06:41:28` **…Cache-Control: public, max-age=0, must-revalidate (output does not contain: 'cache-control: public, max-age=0, must-revalidate')**  
❌ `06:41:28` **…--primary is A's accent (output does not contain: '--primary: #1d4ed8 !important;')**  
❌ `06:41:28` **…the "Powered by" footer link is hidden (output does not contain: 'a[href^="https://www.authelia.com"] { display: none !important; }')**  
❌ `06:41:29` **auth.lamaste-second.local/brand.css: --primary is B's accent (output does not contain: '--primary: #b91c1c !important;')**  
✅ `06:41:29` auth.lamaste-third.local/brand.css: 404 (no brand, no stylesheet)  

## The logos and favicons: the fixtures' bytes; C gets Authelia's

❌ `06:41:29` **auth.test.lamaste.local/static/media/logo.png: logo A's bytes, image/png (expected: '200 image/png a24371cc722dd446064e91ea3d48abbe5f227a4dda982a6a601de9e30d0d8d32', got: '200 image/png e9e9400b09fa84ec85ce0a9d0b2c73ee3337b53818dda1d3dc3f12f54c0497cc')**  
❌ `06:41:29` **auth.lamaste-second.local/static/media/logo.png: logo B's bytes (expected: '200 image/png f026cc422c12263799e9cba7dc81059ee87db349b72e3984bf730908ff50dace', got: '200 image/png e9e9400b09fa84ec85ce0a9d0b2c73ee3337b53818dda1d3dc3f12f54c0497cc')**  
✅ `06:41:29` auth.lamaste-third.local/static/media/logo.png: Authelia's placeholder (the asset directory's logo.png)  
❌ `06:41:29` **auth.test.lamaste.local/favicon.ico: favicon A's bytes, image/x-icon (expected: '200 image/x-icon 5f341aaf5c6f5d9a7125334b658a0f152727e5ef143be5e3cea79987baa15bac', got: '200 image/vnd.microsoft.icon f435e7c21b7c31da5c34fc7ff11a0c577c174ac393b8ea1de330852e5b33dc7a')**  
❌ `06:41:29` **auth.lamaste-second.local/favicon.ico: favicon B's PNG bytes under the .ico name, image/x-icon by the extension (expected: '200 image/x-icon a3b047474dedb4a7d708618dc180c44e9ffa206154f150686e02331eee2a422e', got: '200 image/vnd.microsoft.icon f435e7c21b7c31da5c34fc7ff11a0c577c174ac393b8ea1de330852e5b33dc7a')**  
✅ `06:41:29` auth.lamaste-third.local/favicon.ico: 200, Authelia's own  
✅ `06:41:29` …not favicon A  
✅ `06:41:29` …not favicon B  

## The locale files: the brand name in place of {{authelia}}, in English and Turkish

❌ `06:41:29` **auth.test.lamaste.local/locales/en/portal.json: "Login - {{authelia}}" → "Login - Brand A" (expected: 'Login - Brand A', got: 'Login - {{authelia}}')**  
❌ `06:41:29` **…"Powered by {{authelia}}" → "Powered by Brand A" (expected: 'Powered by Brand A', got: 'Powered by {{authelia}}')**  
❌ `06:41:29` **…no {{authelia}} left in any value (expected: '0', got: '3')**  
❌ `06:41:29` **auth.test.lamaste.local/locales/tr/portal.json: the Turkish title carries Brand A (Giriş - {{authelia}}) (output does not contain: 'Brand A')**  
❌ `06:41:29` **…and no placeholder (output unexpectedly contains: '{{authelia}}')**  
❌ `06:41:30` **auth.lamaste-second.local/locales/en/portal.json says Brand B (expected: 'Login - Brand B', got: 'Login - {{authelia}}')**  
✅ `06:41:30` auth.lamaste-third.local/locales/en/portal.json is Authelia's own: the title still interpolates {{authelia}}  
✅ `06:41:30` …no brand of another domain  
❌ `06:41:30` **auth.test.lamaste.local/locales/en/settings.json carries Brand A too (expected: 'true', got: 'false')**  

## The invitation page: A's branded, C's the stock page, the same script

✅ `06:41:30` auth.test.lamaste.local/invite/x: 200  
❌ `06:41:30` **…titled Brand A — Accept Invitation (output does not contain: '<title>Brand A — Accept Invitation</title>')**  
❌ `06:41:30` **…the brand's name in the header (output does not contain: '<div class="brand-name">Brand A</div>')**  
❌ `06:41:30` **…and its tagline (output does not contain: '<div class="brand-tagline">Sign in to A</div>')**  
❌ `06:41:30` **…the logo from the same origin (output does not contain: '<img class="brand-logo" src="/static/media/logo.png"')**  
❌ `06:41:30` **…the accent (output does not contain: '--accent: #1d4ed8;')**  
✅ `06:41:30` auth.lamaste-third.local/invite/x: 200  
✅ `06:41:30` …the stock page  
✅ `06:41:30` …no brand header  
✅ `06:41:30` Both pages carry a script of the same length  
✅ `06:41:30` …byte for byte the same script (the API calls are unchanged)  

## A member of A; a tunnel on each domain (B and C authenticated, A restricted)

✅ `06:41:31` User e2e52-a created, member of test.lamaste.local  
✅ `06:41:31` e2e52-a has a directory id  
✅ `06:41:32` Tunnel e2e52b.lamaste-second.local (authenticated), carried by test-agent  
✅ `06:41:32` Tunnel e2e52a.test.lamaste.local (restricted), carried by test-agent  
✅ `06:41:33` Tunnel e2e52c.lamaste-third.local (authenticated), carried by test-agent  
✅ `06:41:35` e2e52-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `06:42:02` e2e52-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `06:42:32` e2e52-a signed in at auth.lamaste-third.local (password, TOTP)  

## The domain refusal on B's tunnel carries brand B

✅ `06:42:33` e2e52-a (a member of A) on B's tunnel: 403  
✅ `06:42:33` …the domain refusal page  
✅ `06:42:33` …naming lamaste-second.local  
✅ `06:42:33` …never a redirect to a sign-in page (no login loop)  
❌ `06:42:33` **…titled with Brand B (output does not contain: '<title>Not allowed — lamaste-second.local — Brand B</title>')**  
❌ `06:42:33` **…Brand B in the header (output does not contain: '<div class="brand-name">Brand B</div>')**  
❌ `06:42:33` **…the logo from B's sign-in host (output does not contain: 'src="https://auth.lamaste-second.local/static/media/logo.png"')**  
❌ `06:42:33` **…B's accent (output does not contain: '--accent: #b91c1c;')**  
✅ `06:42:33` …no Help link (B names no support URL)  
✅ `06:42:33` …nothing of brand A  

## The access-request page on A's restricted tunnel carries brand A and its support contact

✅ `06:42:33` e2e52-a on A's restricted tunnel without a grant: 403  
✅ `06:42:33` …the access-request page  
✅ `06:42:33` …not the domain refusal  
✅ `06:42:33` …never a redirect to a sign-in page  
❌ `06:42:33` **…titled with Brand A (output does not contain: '<title>Access Required — e2e52a.test.lamaste.local — Brand A</title>')**  
❌ `06:42:33` **…Brand A in the header (output does not contain: '<div class="brand-name">Brand A</div>')**  
❌ `06:42:33` **…its tagline (output does not contain: '<div class="brand-tagline">Sign in to A</div>')**  
❌ `06:42:33` **…the logo from A's sign-in host (output does not contain: 'src="https://auth.test.lamaste.local/static/media/logo.png"')**  
❌ `06:42:33` **…A's accent (output does not contain: '--accent: #1d4ed8;')**  
❌ `06:42:33` **…the brand's support e-mail as the contact (output does not contain: 'Admin: <a href="mailto:support-a@example.test">support-a@example.test</a>')**  
❌ `06:42:33` **…and its support URL as the Help link (output does not contain: 'Help: <a href="https://help.example.test/a" rel="noopener">https://help.example.test/a</a>')**  

## On C's tunnel the refusal is the stock page

✅ `06:42:33` e2e52-a on C's tunnel: 403  
✅ `06:42:33` …the domain refusal page  
✅ `06:42:33` …naming lamaste-third.local  
✅ `06:42:33` …never a redirect to a sign-in page (no login loop)  
✅ `06:42:33` …titled without a brand  
✅ `06:42:33` …no brand header  
✅ `06:42:33` …the pages' own accent  

## A's theme changed to oled: the page and its vhost follow

❌ `06:42:33` **PUT …/branding with theme oled: revision 4, no warning (expected: 'true 4 oled 0', got: 'true 4 oled 1')**  
✅ `06:42:34` auth.test.lamaste.local/ says data-theme="oled"  
✅ `06:42:34` The installed auth vhost of test.lamaste.local rewrites the theme to oled  
✅ `06:42:34` …and keeps the logo switch on  
✅ `06:42:34` nginx -t passes  

## A's logo removed: the logo switch off, the placeholder back

❌ `06:42:34` **DELETE …/branding/logo: removed, revision 5, no warning (expected: 'true null 5 0', got: 'true null 5 1')**  
✅ `06:42:38` auth.test.lamaste.local/ says data-logooverride="false"  
✅ `06:42:38` auth.test.lamaste.local/static/media/logo.png is Authelia's placeholder again  
✅ `06:42:38` …the stylesheet stays (the brand does)  

## B's brand removed: the stock page, its rendering gone

✅ `06:42:38` DELETE /api/domains/lamaste-second.local/branding: removed, no warning  
✅ `06:42:38` GET says lamaste-second.local has no brand  
✅ `06:42:38` auth.lamaste-second.local/ is the stock page: data-logooverride="false", no stylesheet  
✅ `06:42:38` …data-theme="light"  
✅ `06:42:38` auth.lamaste-second.local/brand.css: 404  
✅ `06:42:39` auth.lamaste-second.local/static/media/logo.png: the placeholder  
✅ `06:42:39` /var/www/lamaste/auth/lamaste-second.local is gone  
✅ `06:42:39` No rendering of lamaste-second.local is left under .renders/  
❌ `06:42:39` **Exactly one rendering of test.lamaste.local serves (the previous ones removed) (expected: '1', got: '0')**  

## The audit names fields and digests, never the name or the bytes

✅ `06:42:39` Five domain.branding.updated entries for test.lamaste.local: fields, logo, favicon, fields, logo removed  
✅ `06:42:39` …the field entries name the fields (name, theme, accent, …)  
✅ `06:42:39` …the logo entry carries its digest  
✅ `06:42:39` …and the removal is one entry  
❌ `06:42:39` **…revisions 1 to 5 (expected: '[1,2,3,4,5]', got: '[
  1,
  2,
  3,
  4,
  5
]')**  
✅ `06:42:39` …no entry carries the brand's name  
✅ `06:42:39` …nor the logo's bytes  
✅ `06:42:39` One domain.branding.removed entry for lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `95` |
| **Failed** | `45` |
| **Skipped** | `0` |
| **Total** | `140` |

ℹ️ `06:42:39` Cleaning up test resources...  
