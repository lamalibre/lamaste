# Trusted Publisher Scopes — Design Document

> **Status:** 2026-11-10, implemented and proven on rodeo (_As implemented_ at the end). Reviewed by
> an independent reviewer before implementation (_Review findings_ — they supersede the sections
> above where they differ).
> **Target:** Lamaste on top of 4.12.0 (`develop` at `b21c0d60`) and Feria on top of 0.4.0
> (`chore/feria-codelama` at `1ecca09`). No version is bumped, tagged or published here; that is
> the founders'.
> **Why a Lamaste design document** (not a section of
> `plugin-development/design/agent-hosted-app-plugins.md`): the scope check guards every kind of
> plugin — server plugins, agent plugins, local plugins and agent-hosted app plugins — and Feria,
> so it is a platform concern rather than a slice of the app-plugin plan. The design is also cut by
> the same process (as planned → implement → as implemented → rodeo on fresh VMs), and keeping it
> here leaves the app-plugin design document to the session editing its Slice 8.
> **Examples** use invented scopes only: `@lamalibre` (the platform's own) and `@example`
> (a second first-party publisher). Nothing here names a client or a product built on Lamaste.

## Goal

A relay operator can declare a second npm scope whose publisher they trust exactly as they trust
`@lamalibre` — a **trusted publisher scope** — so that plugins published under it install, update
and run like `@lamalibre` ones, and Feria can host and publish that scope. Everything from any
other scope stays refused, exactly as today.

## The boundary this protects (and what it does not change)

Today the `@lamalibre/` scope is the trust boundary for plugin code:

- **Server plugins** run unsandboxed in the panel process (`security-model.md`, Plugin system).
- **Plugin admin bundles** (`panel.js`) run in the panel's own document with the administrator's
  power. `security-model.md`: "acceptable while every plugin comes from the `@lamalibre/` scope;
  isolating plugin UIs in sandboxed frames is its own slice, before any third-party plugin is
  installable."
- **Agent plugins** run in `lamaste-agentd`; **local plugins** in the local plugin host.
- **Agent halves** of app plugins run as a service account the app host helper (root) creates.

What the boundary really means is **who wrote the code**, not the string `@lamalibre`. A trusted
scope extends the boundary to a second publisher the operator vouches for, with the same power.
It is not a sandbox and not a step towards third-party plugins:

1. A trusted scope is **first-party by declaration**: the relay's operator states that the
   scope's publisher is as trusted as Lamalibre itself. Code from it runs with the same privileges
   as `@lamalibre` code, and its admin bundle shares the panel's document.
2. **Untrusted scopes stay refused** at every place that refuses them today — install, update,
   push install, mount, bundle serving, agent half pinning and installation.
3. **Third-party (untrusted) plugins** still wait for the sandboxed-frames slice. Nothing here
   loosens a check for them; there is no "allow any scope" switch, no wildcard, no per-plugin
   exception.
4. **A plugin never changes the list.** Only an administrator does, through one audited operation.

### Who may change the list, and why that is enough

On the relay the list is changed only through the panel's administrator API (admin certificate,
panel 2FA when enabled), with an audit event and an administrator notification. That is the same
authority that can already install any `@lamalibre/` plugin and set the registry the panel installs
from — so the change does not create a new power, it names one: today an administrator who points
the registry credential at a registry of their choosing already decides which bytes run as
`@lamalibre/…`. Making the second publisher explicit, audited and visible is strictly better than
the alternative operators would otherwise reach for (republishing under `@lamalibre/`).

`@lamalibre` itself is **always trusted** and is not in the editable list: Lamaste is published
under it, so distrusting it while running its code would be incoherent, and it removes a whole
class of mistakes (a relay that can no longer reinstall its own Feria plugin). The editable list
holds the **additional** scopes; the effective list is `["@lamalibre", ...additional]`.

## Terms

- **npm scope** — `@` + a name, as npm writes it in `@scope:registry=`. Lamaste's form is the npm
  form without a trailing slash: `@example`. Syntax: `^@[a-z0-9][a-z0-9-]{0,49}$` (the rule the
  registry credential's `scope` already uses, bounded). Lowercase ASCII only, so case and Unicode
  look-alikes are not even well-formed.
- **Scoped package name** — `<scope>/<name>`, `name` as each place already restricts it
  (`[a-z0-9][a-z0-9._-]{0,213}` for plugin packages, `[a-z0-9][a-z0-9-]*` for agent halves).
- **Package scope** — the part before the first `/` of a well-formed scoped package name; a name
  that is not well-formed has none.
- **Trusted** — the package's scope is **equal** (string equality) to a member of the effective
  list. Never a prefix test: `@lamalibre-evil/x` has scope `@lamalibre-evil`, which is not
  `@lamalibre`.

## Inventory — every scope check today, and what becomes of it

Found by grepping both repositories for `@lamalibre/`, `^@lamalibre`, `startsWith('@lamalibre`,
`"@lamalibre"` and `scope`. "Trust" = checks against the effective list; "syntax" = checks only
that it is a well-formed scoped name (the place is not a trust decision, see the reason).

### Lamaste — core library (`packages/core/lib/src`)

| Place                                                                   | Today                                   | Becomes                                                                                                          |
| ----------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `schemas.ts` `ManifestSchema.packages.server/agent`                     | regex `^@lamalibre\/`                   | syntax (`ScopedPackageNameSchema`); trust checked where a manifest is accepted (`assertManifestPackagesTrusted`) |
| `schemas.ts` `LamaPackageNameSchema`                                    | `startsWith('@lamalibre/')`             | kept as is (exported API; `@lamalibre` only), marked deprecated; new `ScopedPackageNameSchema` beside it         |
| `agent-half.ts` `AgentHalfPackageNameSchema`                            | `^@lamalibre\/[a-z0-9][a-z0-9-]*$`      | syntax `^@<scope>\/[a-z0-9][a-z0-9-]*$`; trust at the relay (pin, approval)                                      |
| `constants.ts` `derivePluginRoute`                                      | strips `^@lamalibre\/`                  | strips any well-formed scope                                                                                     |
| `plugin-host.ts:188` mount, `:274` bundle                               | `startsWith('@lamalibre/')`             | trust, against the host's list (`trustedScopes` option, default `["@lamalibre"]`)                                |
| `server/plugins.ts` `installPlugin`                                     | `startsWith` → `INVALID_SCOPE`          | trust (`trustedScopes` option) → `PluginError(…, 'UNTRUSTED_SCOPE')`                                             |
| `agent/plugins.ts` `validatePackageName` (install)                      | `startsWith`                            | trust (`PluginLifecycleConfig.trustedScopes`)                                                                    |
| `agent/plugins.ts` uninstall `:438`, update `:513`, update check `:563` | "registry corruption" `startsWith`      | uninstall: syntax (removal must work after a scope is no longer trusted); update and update check: trust         |
| `agent/plugins.ts` `readPluginBundle` `:603`                            | `startsWith`                            | trust                                                                                                            |
| `npm-userconfig.ts` `renderInstallNpmrc`                                | one `scope` line (default `@lamalibre`) | one `<scope>:registry=` line per routed scope (`scopes`)                                                         |
| `server/registry-credential.ts` `scope`                                 | the one scope the registry serves       | kept for compatibility, no longer used for routing: the registry serves every trusted scope (see npm routing)    |
| `app-job-signature.ts` payload package fields                           | `AgentHalfPackageNameSchema`            | follows it (syntax); the relay signs only packages it trusts                                                     |
| `agent/app-plugin-hooks.ts`, `agent/apphost.ts` package fields          | `AgentHalfPackageNameSchema`            | follows it (syntax): these read jobs the relay signed and records the helper wrote                               |

### Lamaste — relay (`packages/server/daemon/src`, `packages/server/cli/src`)

| Place                                                                                                   | Today                                                            | Becomes                                                                                           |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `lib/plugins.js` `assertSafeLamalibrePackage` (install spec, alias refusal)                             | `^@lamalibre\/…(@ver)?$`                                         | trust + the same alias/syntax refusal (`assertTrustedPackageSpec`)                                |
| `lib/plugin-packages.js` `PACKAGE_RE` (installed dir, pin, pack)                                        | `^@lamalibre\/…$`                                                | syntax: these name a package already accepted; the accepting step checks trust                    |
| `routes/management/plugins.js` install body, push-install policy `allowedPlugins`, push-install command | zod regex `^@lamalibre\/`                                        | zod syntax + trust in the handler (the list is runtime state, not a static schema)                |
| `routes/management/tunnels.js:145` plugin tunnel `pluginName`                                           | `^@lamalibre\/…`                                                 | syntax; must name an installed plugin (already the case where it matters) — a tunnel runs no code |
| `routes/user-access.js:33` grant `pluginName`, `:392` short name                                        | regex; `replace(/^@lamalibre\//…)`                               | syntax; `derivePluginRoute` — a grant runs no code                                                |
| `routes/management/registry-credential.js:146` default scope                                            | `'@lamalibre'`                                                   | unchanged (legacy field)                                                                          |
| `server/cli/src/commands/uninstall.js:308`                                                              | removes global `@lamalibre/*` packages when uninstalling Lamaste | unchanged — Lamaste's own packages, not a plugin trust check                                      |
| Plugin install/update staging (`lib/plugin-lifecycle.js`, `lib/hook-pipelines.js`)                      | manifest scope via `ManifestSchema`                              | `assertManifestPackagesTrusted(manifest, packageName, trustedScopes)` after the manifest is read  |

### Lamaste — agent (`packages/agent`)

| Place                                                                                     | Today                              | Becomes                                                                                           |
| ----------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `daemon/src/routes.js:560` agent plugin install                                           | regex `^@lamalibre\/…`             | trust against the agent's list (from its relay), same alias refusal                               |
| `daemon/src/panel-api.js:434`, `cli/src/lib/panel-api.js:486` brokered credential `scope` | one scope                          | `scopes` from the broker response (fallback `[scope]`)                                            |
| `cli/scripts/lamaste-apphost:116` `PACKAGE_RE`                                            | `^@lamalibre\/[a-z0-9][a-z0-9-]*$` | syntax, the same pattern as core's `AgentHalfPackageNameSchema`; helper protocol 2 → 3 (see R-B2) |
| `cli/src/lib/app-host-jobs.js` npm pack                                                   | brokered npmrc, one scope          | every trusted scope routed to the brokered registry                                               |

### Lamaste — UIs and desktop

| Place                                                                                    | Today                        | Becomes                                                                      |
| ---------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| `clients/desktop/src-tauri/src/local_plugins.rs:250`                                     | `starts_with("@lamalibre/")` | trust, Rust helper `trusted_scopes.rs` against the local list                |
| `local_plugins.rs:118` doc comment                                                       | "always `@lamalibre/`"       | "from a trusted scope"                                                       |
| `server/ui` Plugins page, Gatekeeper grants placeholders; `agent/ui` Plugins placeholder | `@lamalibre/...`             | placeholders unchanged; the server UI gains a **Trusted publishers** section |

### Feria (`../feria`)

| Place                                                                                                       | Today                                | Becomes                                                                             |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| `daemon/src/app.ts:255` publish/metadata/tarball routes under `{ prefix: '/@lamalibre' }`                   | one hosted scope                     | registered once per hosted scope                                                    |
| `routes/metadata.ts` closed scope (404, never upstream)                                                     | `@lamalibre`                         | every hosted scope is closed                                                        |
| `routes/publish.ts`                                                                                         | `publish` token scope                | `publish` **and** a publisher allowed for that npm scope                            |
| `routes/packages.ts` list/visibility/delete under `/packages/@lamalibre/:name`                              | one scope                            | per hosted scope                                                                    |
| `core/lib/src/server/store.ts` `packages/@lamalibre/`                                                       | one directory                        | one directory per hosted scope                                                      |
| `core/lib/src/server/npmrc.ts` (dev `setup`/`teardown`)                                                     | `@lamalibre:registry=` line          | one line per hosted scope; teardown removes every scope line pointing at this Feria |
| `core/lib/src/server/auth/registry-client.ts`, `ui/src/web/web-client.ts`, `desktop/src-tauri/src/feria.rs` | build `/packages/@lamalibre/<short>` | build from the full name                                                            |
| `routes/proxy.ts`                                                                                           | proxies everything else              | unchanged — unhosted scopes still proxy upstream                                    |

## Design

### 1. One helper per language

**TypeScript** — `packages/core/lib/src/trusted-scopes.ts`, exported from the root (browser-safe,
zod only), the one implementation every TypeScript and JavaScript place calls:

```ts
export const BUILTIN_TRUSTED_SCOPE = '@lamalibre';
export const MAX_ADDITIONAL_TRUSTED_SCOPES = 16;
export const NpmScopeSchema: z.ZodString; // ^@[a-z0-9][a-z0-9-]{0,49}$
export const ScopedPackageNameSchema: z.ZodString; // <scope>/[a-z0-9][a-z0-9._-]{0,213}
export const AdditionalTrustedScopesSchema; // unique, ≤ 16, never @lamalibre
export function effectiveTrustedScopes(additional?: readonly string[]): readonly string[];
export function packageScope(name: string): string | null; // null unless well-formed
export function isTrustedPackage(name: string, trusted: readonly string[]): boolean;
export function assertTrustedPackage(name: string, trusted: readonly string[]): void; // UntrustedScopeError
export function assertManifestPackagesTrusted(manifest, packageName, trusted): void;
export class UntrustedScopeError extends Error {
  code = 'untrusted_scope';
  scope;
  packageName;
}
```

- `isTrustedPackage` parses the name with the strict syntax first, then compares the scope with
  `===` against each member — no `startsWith`, no normalisation, no case folding (a name with an
  upper-case letter or a non-ASCII character is not well-formed and therefore not trusted).
- `assertManifestPackagesTrusted` checks the installed package and every package the manifest
  names (`packages.server`, `packages.agent`, `agent.package`), and requires all of them to be in
  **the installed package's own scope**: a publisher may name only its own packages, so trusting
  `@example` never lets an `@example` manifest pull an `@lamalibre` package (or the reverse).

**Rust** — `packages/clients/desktop/src-tauri/src/trusted_scopes.rs`: `is_trusted_package(name,
&[String]) -> bool`, `package_scope(name) -> Option<&str>`, the same syntax rules, and
`local_trusted_scopes() -> Vec<String>` reading the local list (§5). Unit tests in the module.
Tests on both sides share one table of cases (trusted, untrusted, look-alike `@lamalibre-evil/x`,
`@lamalibrex/x`, `@LamaLibre/x`, `@lamalıbre/x` (dotless ı), full-width `＠lamalibre/x`, `@lamalibre`
without a name, `@lamalibre//x`, `@lamalibre/../x`, `@lamalibre/x@npm:y`) — a JSON fixture the TS
test reads and the Rust test includes with `include_str!`.

### 2. The relay's list

- **Stored** in `panel.json` as `trustedScopes: string[]` (the additional scopes; default `[]`),
  validated by `AdditionalTrustedScopesSchema` in `ConfigSchema`, written by `updateConfig` (atomic,
  under its mutex). `panel.json` is the panel's own configuration, already read at start and held
  in memory; the list is small and has no relations, so it needs no table and no migration (which
  also keeps this branch free of a migration-number race with parallel branches).
- **API** (admin only; `settings` is already a reserved prefix):
  - `GET /api/settings/trusted-scopes` → `{ builtIn: "@lamalibre", additional: ["@example"],
effective: ["@lamalibre", "@example"] }`.
  - `POST /api/settings/trusted-scopes` `{ scope }` → 201 with the same body. 400
    `invalid_scope` (syntax), 400 `builtin_scope` (`@lamalibre`), 409 `scope_already_trusted`,
    409 `too_many_scopes`.
  - `DELETE /api/settings/trusted-scopes/:scope` → 200. 404 `scope_not_trusted`, 400
    `builtin_scope`, 409 `scope_in_use` with `plugins: [packageName…]` when an installed plugin
    (any status, any hosting) or a pending update is from that scope — uninstall first. The
    agent-local plugins of agents are not known to the relay; they stop mounting once their agent
    learns the new list (§3), which the response's message says.
  - Each change: audit `settings.trusted_scope.added|removed {scope}` and an `notify-admins`
    notification, so a second administrator sees a trust change they did not make.
- **CLI**: `lamaste-server trusted-scopes [list] | add <scope> | remove <scope>` (`--json`), through
  `panel-api.js` (Rule 4: the CLI never writes `panel.json`).
- **AdminClient**: `getTrustedScopes()`, `addTrustedScope(scope)`, `removeTrustedScope(scope)` —
  implemented by the web client and the desktop client (Tauri `admin_get_trusted_scopes`,
  `admin_add_trusted_scope`, `admin_remove_trusted_scope`, bodies on curl's stdin).
- **Panel UI**: a **Trusted publishers** card on the Plugins page: the built-in scope (not
  removable), the additional ones with Remove, an Add field; the card states what trust means
  ("plugins from these scopes run with the same privileges as Lamalibre's own, including in this
  panel") and a refused removal lists the plugins in the way.
- **Where it is read** (one accessor, `getTrustedScopes()` in serverd `lib/trusted-scopes.js`,
  returning `effectiveTrustedScopes(getConfig().trustedScopes)`):
  install (`lib/plugins.js`), update staging (`lib/plugin-lifecycle.js`), the manifest check after
  the package is read (install, update, hosting pipelines), push-install policy and command routes,
  agent-half pinning (`pinAgentHalf` checks `agent.package` before `npm view`), the panel's
  plugin host (passed as `trustedScopes` — read at start; a removal is refused while a plugin uses
  the scope, so a running mount never loses its trust), and the npm userconfig (§4).

### 3. Agents follow their relay

An agent's trust decision is its relay's: the relay administrator already pushes installs to it
and signs its app jobs. So:

- `GET /api/tunnels/agent-config` (what `sync` reads every 30 s) gains `trustedScopes` (the
  effective list). `convergeChiselService` persists it to `agents/<label>/config.json` as
  `trustedScopes` when it differs (under the agent lock, through `updateAgentConfig`, the existing
  path), and keeps the old value when the response has none (an older relay) — absent everywhere,
  it is `["@lamalibre"]`.
- `agentPluginConfig(label)` reads it (`trustedScopes` on `PluginLifecycleConfig`); the agent
  daemon's install route and its plugin host check against it. A scope the relay stops trusting is
  gone from the agent within one sync, and its agent plugins stop mounting at the next daemon
  restart and refuse updates at once; uninstall still works.
- A relay that does not send the field (older than this change) leaves agents on `@lamalibre` only:
  fail closed.

### 4. npm routing: every trusted scope goes to the configured registry

Lamaste holds one registry credential, for the Lamalibre registry (Feria). With trusted scopes the
model is: **the configured registry serves every trusted scope**. So:

- `InstallNpmrc` gains `scopes: readonly string[]` (replacing `scope`; `scope` is still accepted
  for one release and treated as `[scope]`); `renderInstallNpmrc` writes one
  `<scope>:registry=<url>` line per scope, then the one `_authToken` line. Each scope is checked with
  `NpmScopeSchema` (a scope with a newline or `=` can never reach the file).
- The panel's own installs, update staging and pinning route the effective list.
- `GET /api/agents/me/registry-credential` adds `scopes` (the effective list) beside `scope`; the
  agent daemon and CLI pass `scopes ?? [scope]`.
- Without a registry credential nothing changes: npm resolves through the host's own npm
  configuration, as today.

### 5. Local plugins (desktop, no relay)

The local plugin host has no relay and no administrator other than the machine's user. Its list is
`~/.lamalibre/local/trusted-scopes.json` (`{ "additional": [...] }`, 0600, atomic, in the 0700
local directory), absent = `["@lamalibre"]`. Changed only by the user through
`lamaste-agent trusted-scopes --local list|add|remove` (core `agent/local-trusted-scopes.ts`), never
by a plugin. Read by `localPluginConfig()` (TS, the authoritative check in the local host) and by
the Rust pre-check in `local_install_plugin` (`trusted_scopes::local_trusted_scopes()`), which
fails closed to `["@lamalibre"]` on a missing or unreadable file. Local plugins also come from the
curated list in practice; the list exists so the Rust and TS checks read one configured source
rather than a hard-coded scope.

### 6. Agent halves and the app host helper

- The relay decides: the manifest check (§2) runs when the plugin is installed or updated, and
  `pinAgentHalf` refuses an untrusted `agent.package` before contacting the registry. The relay
  signs app jobs only for pinned halves, so it signs only trusted packages.
- `AgentHalfPackageNameSchema` and the helper's `PACKAGE_RE` become the scope-generic syntax, still
  byte-identical (the existing contract test). The helper does **not** get a list of its own: its
  trust anchor is the relay's signature, and the relay also chooses the registry and the integrity
  pin, so a scope check in the helper never bounded a compromised relay — it only looked like it.
  `security-model.md` says this plainly ("a compromised relay can install any package of a scope it
  trusts from its registry" replaces "any `@lamalibre/` package").
- An older helper refuses any other scope ("invalid package"). So the helper's protocol goes from 1
  to 2, and **host eligibility** refuses hosting a half from a scope other than `@lamalibre` on an
  agent whose `hostFacts.apphost.version` is below 2 (`agent_not_eligible`, reason
  `apphost_too_old`), before anything is reserved. `@lamalibre` halves are eligible on protocol 1
  as before.
- `apphost enable|pin` already reinstall the helper from the agent package; updating the agent
  (`npm i -g @lamalibre/lamaste-agent` + `sudo lamaste-agent apphost enable`) upgrades it.

### 7. Feria: hosted scopes and their publishers

Feria is the registry that holds the trusted scopes' packages. Its counterpart of the trusted list
is the **hosted scopes**: scopes Feria stores itself, serves as closed scopes (never upstream) and
accepts publishes for.

- **Stored** in `<dataDir>/scopes.json` (0600, atomic, `version: 1`):
  `{ "version": 1, "scopes": [{ "scope": "@example", "publishers": ["user:alice", "machine:ci-example"] }] }`.
  `@lamalibre` is always hosted (Feria is Lamalibre's registry) with `publishers: "any"` unless the
  file lists it with a list. Absent file = `@lamalibre` only, any publisher — today's behaviour.
- **Changed** only by Feria's operator on the Feria host, with `feria-server scopes list | add
<scope> --publisher <owner>... | publishers <scope> --set <owner>... | remove <scope>`, which
  writes the file and appends `scopes.added|publishers.changed|removed` to `audit.log`. The daemon
  reads the file at start (routes are registered per hosted scope); the command says a restart is
  needed and the daemon logs the hosted scopes it serves. `remove` refuses while the scope holds
  packages (`packages/<scope>/` non-empty). Remote changes over the API are not offered: hosting a
  scope changes the registry's routes, which is a host-level configuration like `auth.json`.
- **Publishing** (`PUT /<scope>/:name`) needs the `publish` token scope **and** a principal allowed
  for that npm scope: `publishers: "any"` → any `publish` holder; a list → the principal's `owner`
  equals one entry (exact string; owners are `user:…`, `machine:…`, `ci:<issuer-host>/<subject>`).
  The development registry (loopback, `feria-dev`) is allowed every hosted scope, as it is allowed
  every token scope today. A refusal is 403 with the scope named and audited as
  `publish.refused`.
- **Reading, deleting, visibility** follow the existing scopes (`read`, `admin`) and per-object
  visibility, for every hosted scope.
- **Proxying** of any scope that is not hosted is unchanged.
- **npmrc** (development `setup`): one `<scope>:registry=` line per hosted scope; `teardown` removes
  every `@…:registry=` line whose URL is this Feria's, and its auth line, nothing else (Security Rule
  2 reworded accordingly).

### 8. What does not change

- `RESERVED_API_PREFIXES`, the route uniqueness rule (`plugins.route` UNIQUE): `@example/foo-server`
  and `@lamalibre/foo-server` both derive the route `foo`; the second install is refused with
  `route_taken`, as two `@lamalibre` packages with one route are today.
- Capability namespacing (`plugin:<route>:…`) — keyed by route, not by scope.
- Push-install windows, policies' IP rules, approval of hook sets and agent halves, the digests.
- Third-party plugins: still refused, still waiting for sandboxed plugin UIs.

## Compatibility and upgrade

- **Relay newer than agents**: agents ignore `trustedScopes` in agent-config; `@lamalibre` plugins
  work as before; an `@example` agent half is refused by eligibility (`apphost_too_old`) until the
  agent and its helper are updated.
- **Agents newer than the relay**: no `trustedScopes` from the relay → `@lamalibre` only.
- **Stored state**: `panel.json` without `trustedScopes` parses to `[]`; registry credential files
  keep their `scope`; app-host owner records of `@lamalibre` packages stay valid under the generic
  syntax.
- **Feria** without `scopes.json` behaves exactly as 0.4.0.

## Security notes

- The list is the only input to trust; it is changed only by an administrator (relay) or the
  machine's operator (Feria, local), audited, never by a plugin, a manifest or an agent.
- Matching is exact on a strictly ASCII syntax — prefix, case and Unicode look-alikes cannot match.
- A manifest can name only packages of its own scope.
- Removing trust is refused while the relay has plugins from the scope, so nothing installed is
  left half-trusted; agents drop the scope within one sync.
- The npm userconfig never routes a scope the relay does not trust to the registry with its token.
- Feria refuses a publish to a hosted scope by a principal not listed for it, even with `publish`.

## Proof (rodeo, fresh VMs)

- **Lamaste three-VM spec 62 `trusted-publisher-scope` (numbered 59 until slice 8 took 58–61)** (shares `app-plugin-harness.sh`):
  an invented `@example/e2e-scoped-server` agent-hosted plugin with an agent half
  `@example/e2e-scoped-agent`, **published to the development Feria** (this branch, `@example`
  hosted) before the run and fetched by the host VM through the read-only bridge, then served by
  the stand-in Feria the harness already runs (the panel's registry credential). Steps: install
  refused with `untrusted_scope` while the relay does not trust `@example` (nothing staged, no
  row); `lamaste-server trusted-scopes add @example` (audit event present); install, host on the
  agent VM (helper protocol 3), health up, forwarded admin call answered; agent `config.json`
  carries the scope after a sync; `trusted-scopes remove @example` refused 409 `scope_in_use`;
  uninstall; remove succeeds; install refused again. The harness's `@lamalibre` fixture plugin is
  installed and hosted in the same run (unaffected).
- **Existing specs** 34–36 (app plugins) and single-VM 15 (plugin lifecycle) and 23 (agent plugin
  CRUD, the 400 for a foreign scope) run unchanged.
- **Feria**: integration tests (`app.inject`) for hosted scopes, the publisher rule, closed-scope
  404s, proxying of unhosted scopes, `setup`/`teardown` lines; and a live run on the development
  Feria: `npm publish` of `@example/…` with `feria-dev` succeeds, a publish to an unhosted scope is
  proxied/refused as before.

## Waves

0. This design, reviewed by an independent reviewer; findings folded in.
1. Core: `trusted-scopes.ts`, schemas, `derivePluginRoute`, plugin host, lifecycle (server, agent,
   local), npm userconfig, agent-half syntax, eligibility; unit tests with the shared fixture.
2. Relay: config, API, audit, CLI, install/update/pin/push-install checks, agent-config and broker
   fields, panel UI, AdminClient (web + desktop JS + Rust).
3. Agent: converge persists the list, agentd install route, CLI, helper protocol 2.
4. Desktop: `trusted_scopes.rs`, `local_plugins.rs`; `lamaste-agent trusted-scopes --local`.
5. Feria: hosted scopes, publishers, routes, store, npmrc, CLI, UI/desktop paths, tests.
6. Docs: security model, manifest reference, plugin system, registry/OIDC reference, Feria docs.
7. Rodeo on fresh VMs; "As implemented" written here.

## Open questions for the reviewer

- Is panel.json the right home, or should the list live in SQLite with the plugins it governs?
- Is refusing to remove a scope in use right, or should removal disable those plugins?
- Should the app host helper keep any scope check of its own?

## Review findings (2026-11-10) and what changed

An independent reviewer checked this design against both repositories before implementation.
Every finding was accepted; the design changes are:

- **R-B1 Dependency confusion — trust is bound to a registry, not only to a name.** Without a
  registry credential npm resolves an additional scope from npmjs, where anyone may own it; with one,
  Feria proxies every scope it does not host. So:
  - An additional scope can be trusted only while a registry credential is configured, and only when
    that registry **declares the scope hosted** — Feria's new public `GET /-/feria/scopes` lists its
    hosted (closed) scopes. `POST /api/settings/trusted-scopes` checks it (409
    `registry_lacks_scope` / `registry_credential_required`).
  - Every install, update staging and agent-half pin of a package from an additional scope checks it
    again (the panel asks the registry, cached for 60 s), and refuses without a credential.
  - Clearing the registry credential is refused while additional scopes are trusted (409
    `trusted_scopes_need_registry`).
  - Feria: a hosted scope that is removed stays **closed** (`retired: true` in `scopes.json`: reads
    404, publishes refused, never proxied), so a relay that still trusts it can never be served
    npmjs's package of that name.
- **R-B2 Protocol numbers.** The helper is already at protocol 2, the relay's global minimum. It goes
  to **3** (any well-formed scope); `APPHOST_MIN_PROTOCOL_VERSION = 2` stays the minimum for
  `@lamalibre` halves and `APPHOST_SCOPED_PROTOCOL_VERSION = 3` is required only for a half from
  another scope (`apphostProtocolFor`), in host eligibility and in the agent's job runner — existing
  agents keep installing `@lamalibre` halves.
- **R-B3 Agent and local installs check the manifest.** Core `installPlugin` and `updatePlugin`
  (agent and local mode) call `assertManifestPackagesTrusted`; an update whose manifest fails takes
  none of its metadata. The plugin host and `readPluginBundle` also require the server package to be
  in the scope of the plugin's own package.
- **R-B4 The local plugin host daemon** (`packages/agent/plugin-hostd`, unauthenticated loopback
  `POST /local-plugins/install`) installs through `localPluginConfig()` (local list) and mounts with
  `trustedScopes: await localTrustedScopes()`.
- **R-S1 Removal races.** `DELETE /api/settings/trusted-scopes/:scope` runs under the panel's plugin
  lock (the one install and update take) and counts as "in use": installed plugins, pending updates,
  in-flight plugin operations and push-install policy entries. Trust changes are audited with the
  strict `recordAudit`: a change that cannot be audited is not made. `panel.json` stays the store
  (the lock, not a transaction, is what serialises with installs, whose npm step is outside any
  database transaction; and plugin code runs as `lamaste` and could write SQLite as easily — see
  R-S10).
- **R-S2 Audit names** are `settings.trusted-scope.added|removed` (`ACTION_RE` allows no `_`).
- **R-S3** Converge records the list with `saveAgentConfig` inside `convergeLocked` (the agent lock is
  not re-entrant), on the stopped/idle path as on the running one.
- **R-S4** A relay that sends no list resets the agent to `@lamalibre` alone (fail closed, also after a
  relay rollback).
- **R-S5** When the list loses a scope and an enabled agent plugin is from it, sync restarts the agent
  daemon (`restartPanelService`) so the plugin stops mounting now; agentd reads the list at start.
- **R-S6** Push-install commands re-check trust when they run; policy entries count as "in use".
- **R-S7 Feria publish** requires the URL's package, the body's `name` and every `versions[v].name` to
  be the same name before the publisher rule is applied to its scope.
- **R-S8/S9 Inventory additions.** Feria: `FERIA_LAMALIBRE_SCOPE` (`constants.ts:12`),
  `routes/tarball.ts`, `store.ts` (list and the bare-name prefixing — bare names are no longer
  accepted), `standalone.ts` (the `%2f` rewrite and the not-found handler), `cli/commands/setup.ts`.
  Lamaste: `replacePluginPackage` (`lib/plugins.js`, update apply and revert — the revert restores a
  package that was trusted when installed and checks syntax only), `bareLamalibrePackageName`
  (`plugin-packages.js`, renamed `barePackageName`).
- **R-S10 Honest limits** (written into `security-model.md`): trusted code can change trust — a server
  plugin runs as `lamaste` and can write `panel.json`; an agent or local plugin runs as the user who
  owns its list. And a trusted plugin's npm **dependencies** install into the shared `node_modules`
  and can shadow other plugins' transitive packages; "a manifest names only its own scope" is about
  the packages Lamaste imports or installs as halves, not about npm dependencies. Both are why a
  trusted scope must be a publisher trusted as much as Lamalibre.
- **R-S11** The helper's contract test gains `@example/x`, `@lamalibre-evil/x`, upper-case and Unicode
  cases.
- **Nits.** N1: `@lamalibre` stays built in (the brief's "default `["@lamalibre/"]`" is the effective
  default) — a decision for the founders to confirm. N2: the helpers never case-fold; documented.
  N3: routes stay global; a plugin from another scope can take a free route such as `feria` — its
  capabilities `plugin:feria:*` were revoked from agents when the previous holder was uninstalled
  (`revokePluginCapabilitiesFromAgents`), so it inherits nothing; documented. N4: audit retention
  applies to trust events like any other; the notification is the second record. N5: the legacy
  credential `scope` is not routed when it is not trusted — a scope that is not trusted has no plugin
  to install.

## As implemented (2026-11-10)

The design above, with the review findings, is what was built; the differences are listed here.

**Branches** (not pushed, nothing published beyond the development Feria): Lamaste
`claude/trusted-publisher-scopes-af4790` on `develop` 4.12.0; Feria `feat/trusted-publisher-scopes`
on `chore/feria-codelama` 0.4.0; plugin-development `docs/trusted-publisher-scopes` (the manifest
reference only).

**Differences from the plan**

- The single-VM specs the plan named as 11 and 19 are 15 (plugin lifecycle) and 23 (agent plugin
  CRUD). Spec 23 skips itself in the single-VM suite as it always has (the suite installs no
  `lamaste-agent` on the host); agentd's install checks are covered by its unit tests and, end to
  end, by spec 62's agent half.
- Spec 62 does not host a `@lamalibre` plugin in the same run: specs 34–36 do that on the same
  candidate, VMs and relay, right after it.
- Spec 34 pinned the helper's protocol at 2 and now expects 3 — the one existing assertion this
  change alters.
- Spec 62 owns its development-Feria state: it removes its fixture packages before publishing and on
  exit (every run publishes fresh bytes, so npm's cache cannot answer the agent's fetch), and counts
  only the notifications of its own run.
- The agent CLI's `plugin install|update` takes the brokered registry credential like agentd (the
  review did not list it; an additional scope would otherwise have resolved through the machine's own
  npm configuration).

**Proof, rodeo, 2026-11-10** — candidate built from this branch (versions set to 4.13.0 for the
run only), published to the development Feria, which ran this Feria branch with `@example` hosted
(`feria-server scopes add @example --any-publisher`); three-VM set created fresh and provisioned.

| Spec                                          | Result                                                          |
| --------------------------------------------- | --------------------------------------------------------------- |
| three-VM 01 onboarding                        | 55 of 55                                                        |
| three-VM 59 (now 62) trusted publisher scope  | 60 of 60 (third run; the first two found the spec issues above) |
| three-VM 34 app plugin install (`@lamalibre`) | 217 of 217                                                      |
| three-VM 35 app plugin operate (`@lamalibre`) | 100 of 100                                                      |
| three-VM 36 app plugin removal (`@lamalibre`) | 83 of 83                                                        |
| single-VM 01, 03, 15 (fresh host)             | 12, 4, 41 — none failed                                         |
| single-VM 23                                  | skipped (no agent on the host, as before)                       |

Spec 62 (then 59) covers: the built-in scope reported; `untrusted_scope` for `@example` (nothing staged) and
for look-alikes of `@lamalibre`; `registry_lacks_scope` while the registry does not host `@example`;
`lamaste-server trusted-scopes add` (audit entry, one notification); the agent's `config.json`
following the relay's list at its next sync; the packages published to the development Feria with
`feria-dev`, a package of an unhosted scope not stored there, and the stand-in serving Feria's bytes
(integrity equal); install, approval and hosting on the agent VM through helper protocol 3, the half
running as its own account, the helper's owner record, a forwarded call answered; the agent fetching
the half from the relay's registry with its brokered token; `scope_in_use` while installed;
`trusted_scopes_need_registry`; uninstall with purge; removal (audited); install refused again; the
agent back to `@lamalibre` alone.

Unit and integration tests: Lamaste serverd 598, agent CLI 125, agentd 113, server CLI 111, core
111, desktop Rust 52 (clippy clean); Feria core 34, daemon 23. Lint and builds green in both
repositories.

### Review of the implementation (2026-11-10) and what changed

A second independent review read the code after the merge with slice 8. Every finding was taken:

- **Blocking — the relay never mounted a server plugin of an additional scope.** serverd passed no
  `trustedScopes` to its plugin host, so the core default (`@lamalibre`) applied: the install
  succeeded, the plugin was never mounted and its bundle answered 403. Spec 62 used an agent-hosted
  plugin, which is never mounted, so it could not see this. The plugin router now passes
  `getTrustedScopes`; serverd's test mounts an `@example` server plugin through the real router,
  serves its route and bundle, and shows the bundle refused once the scope is no longer trusted.
- **Credential changes and trust changes race.** `PUT`/`DELETE /api/registry-credential` now check and
  store under the plugin lock, like trust changes. The broker sends agents only the trusted scopes
  the registry hosts at that moment (`brokeredTrustedScopes`), so an agent never routes a scope to
  a registry that would proxy it.
- **The local host had no registry requirement.** An additional local scope must now be routed by
  the user's npm configuration to a non-public registry that declares it hosted
  (`assertLocalScopeRouted`), when added and at every install and update — over https, or plain
  http to this machine only. A registry that does not answer `GET /-/feria/scopes` (Verdaccio,
  GitHub Packages) is refused: nothing says it will not proxy the scope, so local additional
  scopes need a Feria. This supersedes §5's "the user's own choice".
- **A dropped scope kept being served when the daemon restart failed.** Every plugin host now reads
  the list at each mount, at each bundle request and — through a guard on the plugin's mounted
  scope — at each request to the plugin's routes (synchronous readers on the agent and the local
  host), so a scope no longer trusted stops being served at once, restart or not.
- Nits taken: push-install policy writes under the plugin lock; trust changes audited before they
  are written (a crash leaves at most an entry for a change that did not happen, and a failed write
  adds `settings.trusted-scope.change-failed`); the agent's update check asks the registry its
  installs use; `npm uninstall --ignore-scripts` everywhere, and the relay's uninstalls run through
  the registry userconfig like its installs (an agent's uninstall keeps working without a brokered
  credential); the TypeScript list cap matches the desktop twin.
- Documented, not changed: "in use" counts installed rows and policies — enough, because an install
  writes its row inside the plugin lock (R-S1's "in-flight operations" wording overstated it); a
  malformed `trustedScopes` in `panel.json` stops the panel from starting, like any invalid
  configuration; a plugin of another scope that takes a free route inherits the shelf edges (slice 8) that already name that route — the approval preview lists them (`appliedEdges`).
