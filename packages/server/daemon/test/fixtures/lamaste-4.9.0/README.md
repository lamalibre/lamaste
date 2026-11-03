# Lamaste 4.9.0 vhosts

What 4.9.0's generators (`src/lib/nginx.js` at `d5bc67f1`, with the core
library of the same commit) render for invented domains — the regression
pins of packages/core/docs/page-language-design.md: a domain without a page
language keeps its 4.9.0 auth vhost but for the pages' CSP hashes, and a
served web surface keeps its vhost byte for byte.

- `auth-primary-unbranded.conf` — `renderAuthVhost('alpha.example', …, { primary: true, branding: null })`
- `auth-branded.conf` — `renderAuthVhost('beta.example', …, { primary: false, branding: { theme: 'dark', logo: true } })`
- `web-surface-served.conf`, `web-surface-not-served.conf` — `renderWebSurfaceVhost` of site
  `demo-site` (`app.beta.example`, route `demo`), served and not served (with `Clear-Site-Data`)

Generated, not edited by hand.
