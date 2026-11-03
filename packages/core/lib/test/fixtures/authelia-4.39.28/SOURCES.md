# Authelia v4.39.28 — verbatim fixtures

Every file under this directory is a byte-for-byte copy of the file at the
same path in Authelia's repository at the tag `v4.39.28`, fetched from
`https://raw.githubusercontent.com/authelia/authelia/v4.39.28/<path>`:

| Path                                          | What the tests pin                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `internal/server/locales/en/portal.json`      | every key of the portal namespace (the forced file's keys)               |
| `internal/server/locales/en/settings.json`    | every key of the settings namespace                                      |
| `internal/server/locales/en/consent.json`     | every key of the consent namespace                                       |
| `internal/server/locales/tr-TR/portal.json`   | Authelia's Turkish: what the supplement adds and the corrections replace |
| `internal/server/locales/tr-TR/settings.json` | the same                                                                 |
| `internal/server/locales/tr-TR/consent.json`  | the same                                                                 |
| `web/src/i18n/index.ts`                       | the detection order, the namespaces, the load path                       |
| `web/index.html`                              | the `<html lang="` literal and the `<noscript>` text                     |
| `web/src/components/AppBarItemLanguage.tsx`   | the language menu's `id="language-button"`                               |

Authelia is licensed under the Apache License 2.0
(<https://github.com/authelia/authelia/blob/v4.39.28/LICENSE>); the files
are © Authelia and carry their own SPDX headers where the format allows
one. They are test data only, never shipped (`files` in package.json
publishes `dist` and `assets`).

Refresh every file when `AUTHELIA_RELEASE.version` (`src/constants.ts`) is
bumped, then run the core tests: a moved contract or a key the supplement
does not cover fails them (packages/core/docs/page-language-design.md §3).
