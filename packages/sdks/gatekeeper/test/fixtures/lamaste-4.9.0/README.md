# Lamaste 4.9.0 Gatekeeper pages

What 4.9.0's `src/lib/templates.ts` (at `d5bc67f1`) renders for invented
names — the English regression pin of packages/core/docs/page-language-design.md:
a host whose domain has no page language gets these pages, in their words,
but for the copy buttons' markup (the label in a `data-` attribute, the text
in an element of its own).

- `access-request-stock.html` — `buildAccessRequestPage('alice', 'app.alpha.example', { adminContact: 'ops@alpha.example', adminName: 'Ops' })`
- `access-request-default-admin.html` — the same with `{}` (the default administrator names)
- `access-request-branded.html` — `app.beta.example` with the settings and the brand `Beta Works`
- `refusal-domain.html` — `buildDomainRefusalPage('alpha.example', settings, { host: 'app.alpha.example' })`
- `refusal-site-branded.html` — `buildDomainRefusalPage('beta.example', settings + brand, { host: 'site.beta.example', site: true })`
- `refusal-no-domain.html` — `buildDomainRefusalPage(null, {}, { host: 'stray.example' })`

Generated, not edited by hand.
