# Mail — design (4.13.0)

Status: **decided, ready to implement** (2026-11-10; Q1–Q5 settled — §11). Base: `develop` at 4.12.0.

## 1. Why

A relay sends no mail today. Authelia's notifier is `filesystem`
(`core/lib/src/server/authelia.ts`, `notifier.filesystem`), so:

- an invitation link is shown once to its inviter, who must carry it to the
  invitee by hand — fine for an operator, not for a customer-facing inviter
  (delegated invitations);
- nobody can recover a forgotten password; an administrator sets a new one;
- nobody can change their own password: Authelia's change and reset are
  disabled (external-members S2 — Authelia writes users.yml from an
  in-memory copy that may predate the panel's last write, putting revoked
  groups back), and they could not have worked anyway, since Authelia
  verifies identity by mail;
- Authelia's own one-time codes (session elevation before managing 2FA
  devices or passkeys in its settings) never arrive.

Code Lama now has Google Workspace for `codelama.com.tr` and wants a
subdomain to send the relay's mail.

**Outbound SMTP is blocked where relays run.** DigitalOcean blocks 25, 465
and 587 on accounts created since June 2022; an unblock is asked of
support after 60 days and not always granted. Measured on the live relay
(2026-11-09): `nc -vz smtp-relay.gmail.com 587` times out. Google's SMTP
relay listens on those ports only. A relay must therefore be able to send
**over HTTPS**, and a fresh droplet `create-lamaste` provisions must send
without asking anyone.

## 2. Decisions (taken with the user, 2026-11-09)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Scope: invitation mails (administrator's and delegated), forgot-password, change-password while signed in, and Authelia's notifier.                                                                                                                                                                                                                                        |
| D2  | **One relay-wide mail transport, with a per-domain override.** The relay-wide one carries Authelia's mail and is every domain's default; a domain may set its own sender — and, if it wants, its own transport — for Lamaste's mails to it.                                                                                                                                |
| D3  | Two transport kinds: **`gmail-api`** (HTTPS to `gmail.googleapis.com`, one dedicated Workspace user, scope `gmail.send` only) and **`smtp`** (generic: host, port, implicit TLS or STARTTLS, optional AUTH) for providers and hosts whose ports are open.                                                                                                                  |
| D4  | Password reset and change stay **Lamaste's**, never Authelia's: the panel is the only writer of users.yml (S2 holds). Authelia's sign-in page links to Lamaste's reset page through `password_reset.custom_url`.                                                                                                                                                           |
| D5  | **Authelia never talks to a mail provider.** It submits to Lamaste's loopback submission listener; Lamaste delivers through the relay-wide transport. Provider credentials never enter Authelia's configuration.                                                                                                                                                           |
| D6  | **A sending subdomain is not a web hostname.** A sender's domain under one of the relay's domains (`notify.codelama.com.tr`) carries MX/TXT records, so the wildcard A no longer answers for it: tunnels, sites and aliases refuse that hostname (`hostnameHolder` answers `mail-sender`), and a sender is refused when a tunnel, site or alias already serves its domain. |

Verified in Authelia 4.39.28's source (`internal/server/handlers.go`,
`internal/configuration/validator/authentication.go`):

- `/api/reset-password/*` are registered only when
  `!PasswordReset.Disable && PasswordReset.CustomURL == ""`. With a custom
  URL the validator sets `Disable = false` (the portal shows "Reset
  password?" pointing at the URL) and Authelia's own reset endpoints stay
  unregistered — **the link without Authelia ever writing users.yml.**
- `/api/change-password` is registered iff `!PasswordChange.Disable` — it
  stays disabled.
- The SMTP notifier: `address` (`submissions://host:port` = implicit TLS),
  `username`, `password`, `identifier`, `sender`, `subject`,
  `tls.server_name`, `disable_startup_check`. `disable_require_tls` works
  only without AUTH — never used.

## 3. Transports

### 3.1 Records

state.db migration `0022_mail.sql` (its comments are the reference):

- `mail_transports` — one relay row (`domain` NULL: Authelia's mail and
  every domain's default; a partial unique index keeps it to one) and at
  most one row per domain (`REFERENCES domains ON DELETE CASCADE`): `kind`
  (NULL on a domain row that sets a sender only), `settings` (JSON by
  kind, never answered whole), `secret` (never answered or logged;
  state.db is 0600 lamaste), `account_key` (the sending account the
  budget counts against, §3.7), `sender_address`, `sender_name`,
  `daily_limit`, `health_status|checked_at|reason` (§5.1), `verified_at`,
  `updated_at`.
- `mail_accounts` — per sending account, whichever rows send through it:
  `limited_until` (a provider's refusal, §3.7) and the budget
  notifications of the current crossing (`warned_at`, `exhausted_at`).
- `mail_oauth_pending` — a Google consent under way (§3.3): the state's
  SHA-256, the PKCE verifier, the draft (client id and secret, sender,
  daily limit, who started it), 10 minutes.
- `mail_sends` — every delivery attempt (§3.7); `password_resets` (§6.2);
  `invitations.mail_status|mail_sent_at` (§6.1).

`settings` by kind:

- `gmail-api`: `{ clientId, account }` (`account` = the Workspace user the
  token belongs to, read from the token's `id_token`/`userinfo` at
  consent); `secret` = `{ clientSecret, refreshToken }` as JSON.
- `smtp`: `{ host, port, security: 'starttls' | 'tls', username? }`;
  `secret` = the password or NULL. No plaintext; certificates verified, no
  `skip_verify`. Optional `caPem` (Q4): a PEM bundle trusted **in addition
  to** the system roots for that transport only (≤ 16 KiB, every block a
  CA certificate, parsed before storing) — for a self-hosted mail server
  and the e2e sink alike.

**Which transport a mail uses**: the domain's row if it names a kind; else
the relay's transport with the domain row's sender if there is one; else
the relay row as is. No relay row and no own transport → the domain sends
no mail (§7).

### 3.2 `gmail-api`

- **Credential**: an OAuth client of type _Web application_ in a Google
  Cloud project of the Workspace, consent screen **Internal** (only the
  Workspace's users can consent; no Google verification), scope
  `https://www.googleapis.com/auth/gmail.send` plus `openid email` to learn
  the account. The relay holds that client's id and secret and **one
  user's refresh token**. Blast radius of a leak: mail sent as that one
  mailbox — never the domain-wide delegation of a service account, whose
  key sends as every user of the Workspace.
- **Sending**: access token from `https://oauth2.googleapis.com/token`
  (`grant_type=refresh_token`), cached until 5 min before expiry;
  `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`
  with `{ raw: base64url(RFC 5322 message) }`, the message built by
  nodemailer's `MailComposer` (no transport needed). Port 443 only.
- **From**: Gmail sends as the account or a _send-as_ alias the account
  holds. `no-reply@notify.codelama.com.tr` must be an alias of the relay user
  (the subdomain added to the Workspace, §9). **The relay cannot check
  that**: listing send-as addresses (`users.settings.sendAs.list`) needs
  `gmail.settings.basic`, `gmail.readonly`, `gmail.modify` or
  `mail.google.com` — each lets a leaked token read the mailbox or change
  its settings (filters, forwarding, send-as). The relay keeps
  `gmail.send openid email` (decided 2026-11-10). When the sender is not
  the account itself, the answer that stores it carries a warning: send a
  test mail and check its From — Gmail sends as an alias only when it is a
  send-as address of that account.
- **Revocation**: `invalid_grant` on refresh (password change, admin
  revoke, the user suspended) marks the transport down (§5.1) — the
  operator consents again.
- Limits: 2,000 messages a day per Workspace user — far above a relay's
  need; a 429 is a transient failure.

### 3.3 Consent

The panel is mTLS (a browser without the admin certificate cannot reach
it) and the desktop talks to it through `curl_panel`, so Google cannot
redirect to the panel. It redirects to the **primary auth portal**:

1. `POST /api/settings/mail/google/start { clientId, clientSecret,
senderAddress, senderName? }` (admin) → a PKCE pair and a 32-byte
   `state` (SHA-256 at rest in `mail_oauth_pending`), answered
   `{ authorizeUrl }` with `redirect_uri=https://auth.<primary>/mail/google/callback`,
   `access_type=offline`, `prompt=consent`, `login_hint` empty.
2. The admin opens it (panel/desktop opens the browser), signs in as the
   relay user, consents.
3. `auth.<primary>/mail/google/callback?code&state` — a public auth-vhost
   location proxied to the panel (no identity headers, `Host` literal,
   like `/api/invite/`): the panel takes the pending row by `state` (single
   use, 10 min), exchanges the code with the verifier, reads the account,
   verifies (§3.4) and stores the transport. The page says "Mail is set
   up — you may close this tab" or why not. The redirect URI is registered
   once in the Google client; §9 says which.
4. The panel/desktop polls `GET /api/settings/mail` until it changes.

### 3.4 Admitting a transport

Every store verifies first (the registry-credential pattern), sending
nothing:

- `gmail-api`: refresh → access token; the token response's `scope`
  includes `gmail.send` (Google's granular consent lets the user untick
  it); the account is the `id_token`'s `email` with `email_verified`
  true. The `id_token` comes straight from Google's token endpoint over
  TLS in answer to the client's authenticated request, so — as OpenID
  Connect Core §3.1.3.7 allows — the TLS server check stands in for the
  signature check; `iss` (`https://accounts.google.com` or
  `accounts.google.com`), `aud` = the client id and `exp` are checked.
  No `users.getProfile`, no `sendAs` call (§3.2): a sender other than the
  account comes with the test-mail warning.
- `smtp`: connect, TLS, EHLO with the panel hostname, AUTH when a
  username is given, `QUIT` (nodemailer's `verify`; it has no public
  `MAIL FROM` without a message, so whether the server takes the sender
  shows at the test mail). A timeout says
  "the host may block outbound SMTP (DigitalOcean does on new accounts) —
  use the Gmail API transport".

`POST …/test { to }` sends a real mail in the domain's language and brand.

### 3.5 API, CLI, panel

| Method   | Path                                  | Who    | What                                                                                     |
| -------- | ------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `GET`    | `/api/settings/mail`                  | admin  | the relay row: kind, public settings, sender, `hasSecret`, last check — or `null`        |
| `PUT`    | `/api/settings/mail`                  | admin  | `smtp` only: verify, store; `password` omitted = keep                                    |
| `POST`   | `/api/settings/mail/google/start`     | admin  | §3.3                                                                                     |
| `GET`    | `auth.<primary>/mail/google/callback` | public | §3.3 (state-bound)                                                                       |
| `PATCH`  | `/api/settings/mail`                  | admin  | sender address/name only (a `gmail-api` sender re-checked)                               |
| `DELETE` | `/api/settings/mail`                  | admin  | no relay transport: Authelia back to the file notifier; Google token revoked best effort |
| `POST`   | `/api/settings/mail/test`             | admin  | `{ to }`                                                                                 |
| `POST`   | `/api/settings/mail/resume`           | admin  | end a provider's limit refusal early (§3.7)                                              |
| _same_   | `/api/domains/:name/mail[...]`        | admin  | the domain's override: its own transport, or `PUT …/mail/sender` for a sender only       |

CLI: `lamaste-server mail show|set-smtp|google|sender|clear|test` and
`lamaste-server domains mail <name> …`; secrets only via stdin; `google`
prints the URL and waits for the callback. Panel: Settings → Mail;
Domains → a domain → Mail. `AdminClient` gains the methods (web and
desktop, Tauri commands in `admin_commands.rs`). Audit:
`mail.transport.set|cleared` (scope, kind, account/host, sender — never a
secret), `mail.sent|failed` (kind of mail, recipient's domain only,
scope, error class).

### 3.6 Sending

`lib/mail.js` in serverd: resolve the transport, compose with
nodemailer's `MailComposer` (multipart text + HTML, in the domain's
language — page-language `en`/`tr` — with its brand's name and accent;
every link `https://auth.<domain>/…`), deliver (Gmail API via `fetch`, or
nodemailer's SMTP transport). Awaited with a 30 s budget, one retry on a
transient failure (5xx/429 from Google, 4xx/connection on SMTP).

**No outbox for Lamaste's own mails.** A mail that carries a token cannot
wait in a table: tokens are stored only as SHA-256 (invitations, resets).
A failed send is recorded on what it was for (`invitations.mail_status`)
and answered; sending again means a new link (§6.1).

### 3.7 Sending budget

Google stops an account that passes a limit from sending **anything for up
to 24 hours** ([Gmail sending limits in Google Workspace](https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace)):
2,000 messages a day per user, **500 on a trial** (not raised during it;
raised once the domain has paid $100, which can take weeks), counted over
a rolling 24 hours. SMTP providers have limits of their own. The relay
must never be the one that reaches them — least of all through
`/reset`, which anyone can call.

- **Count**: every delivery attempt is a row in
  `mail_sends (id, account_key, class, kind, sent_at, outcome)` (migration
  0022; no address, no subject; swept after 48 h). Google's limit is per
  mailbox, and the relay's row and a domain's may send through the same
  one — or a transport may be removed and set again: usage is counted per
  **sending account**, `account_key` = `gmail:<account>` or
  `smtp:<host>:<username or ->`. Usage = rows of the last 24 h for that
  account; `kind` (`authelia`, `invitation`, `reset`, `password-changed`,
  `test`) serves the reset cap.
- **Limit**: `mail_transports.daily_limit` (1–100000) — the row's own,
  against its account's usage — set by the
  administrator on the transport (`PUT`/`PATCH`, panel, CLI `--daily-limit`);
  default **500** for `gmail-api` (the trial value — the safe one) and
  **500** for `smtp`. Settings → Mail says to raise it to 2,000 once the
  Workspace is paid.
- **Ceiling**: Lamaste sends at most **90 %** of the limit in 24 h.
- **Classes and reserve**: each mail has a class —
  `essential` (Authelia's mail through the listener, password-changed
  notices, test mails), `admin` (administrator's invitations and
  reissues), `public` (reset mails, delegated invitations and their
  reissues). `public` may use the ceiling minus a **20 % reserve**;
  `essential` and `admin` the whole ceiling. On top, reset mails are
  capped relay-wide at **30 an hour** per sending account. Over a cap: a
  reset start still answers its 202 (nothing reveals the cap); an
  invitation answers `mail.status: 'deferred-budget'` with the link (the
  inviter shares it another way); the listener answers Authelia a 4xx.
- **Warnings**: usage crossing **70 %** of the ceiling → notification
  `mail.budget.warning`; the `public` cap or the ceiling reached →
  `mail.budget.exhausted` with the time sending resumes (the oldest
  counted row + 24 h). Each once per crossing; audited.
- **Google's own refusal** (Gmail API 403/429 with reason
  `dailyLimitExceeded`, `userRateLimitExceeded` or a "sending limit
  exceeded" message; SMTP 4.5.3/5.4.5/550 5.7.x limit replies): the
  transport — and every row on the same sending account — is marked
  **limited until** now + 24 h — no retries, no sends,
  every mail answered as over the ceiling — notification
  `mail.transport.limited`. Administrators may clear it early
  (`POST …/mail/resume`) once Google's admin console shows the account
  sending again. Per-second rate limits (`rateLimitExceeded`) stay a
  transient failure with one retry.
- `GET /api/settings/mail` adds `budget: { dailyLimit, ceiling, sent24h,
byClass, limitedUntil, resumesAt }`.

## 4. Users' addresses

Reset and change need an address the user owns. users.yml carries `email`
for invited users and users made on the Users page; the onboarding
administrator gets `<username>@lamaste.local`. Addresses under `.local`,
`.invalid`, `.test`, `.example` are **not deliverable**: reset is never
offered to them (the answer is the same, §6.2), and the Users page marks
the row ("no address — cannot reset their own password").

## 5. Authelia's mail: the loopback submission listener

Authelia's notifier is SMTP only. It submits to **Lamaste**:

```yaml
certificates_directory: /etc/authelia/certs # the listener's local CA, nothing else
notifier:
  disable_startup_check: true
  smtp:
    address: 'submissions://127.0.0.1:9295'
    tls: { server_name: 'lamaste-mail.localhost' }
    username: 'authelia'
    password: { { secret "/etc/authelia/mail-submission-password" | msquote } }
    sender: 'Code Lama <no-reply@notify.codelama.com.tr>'
    subject: '{title}'
```

The listener (`lib/mail-submission.js`, nodemailer's `smtp-server`, in
serverd) on `127.0.0.1:9295`:

- **Implicit TLS** with a certificate from a local CA serverd creates
  (`<stateDir>/mail-submission/`, key 0600); the CA certificate is the only
  file in `/etc/authelia/certs` (0640 `lamaste:lamaste-authelia`) — Authelia
  appends it to the system pool, so it changes no other trust.
- **AUTH PLAIN** as `authelia` with a 32-byte random password, written to
  `/etc/authelia/mail-submission-password` (0640
  `lamaste:lamaste-authelia`) and referenced through the template filter
  the OIDC issuer key already uses; `renderAutheliaConfigTemplate` keeps
  refusing `{{`/`}}` in values, `sentinelizeAutheliaConfig` learns the
  second template line. Compared in constant time.
- Accepts **only** `MAIL FROM` = the sender Authelia was given, one `RCPT`
  (a second is refused, the message goes to the first), headers that name
  that recipient alone in `To` and the sender in `From` (and `Sender`) — no
  `Cc`, `Bcc` or `Resent-*`, since the Gmail API sends to the headers, not
  the envelope — ≤ 256 KiB, 30 messages / 10 min; everything else 5xx.
  Another process on the relay therefore cannot use it to mail anyone as
  anything.
- Delivers through the **relay-wide** transport (Authelia's mail names no
  domain). The From is the relay-wide sender; the body is Authelia's.
  A delivery failure is answered as a 4xx to Authelia (it shows the user an
  error; they try again) and audited.
- Runs only while a relay transport exists; otherwise Authelia keeps
  `notifier.filesystem` as today.
- **As built** (`lib/mail-submission.js`, `lib/mail-sync.js`): one
  synchronisation after every transport or sender change, after a domain
  is activated or removed, and at start — the listener (its files made or
  renewed: the CA and the leaf in `<stateDir>/mail-submission/`, the CA
  certificate as `/etc/authelia/certs/lamaste-mail-ca.pem`), then
  Authelia's notifier and reset link written under `withDomainRendering`
  (the one writer of Authelia's configuration), then every active
  domain's auth vhost. Authelia restarts when its configuration changed
  (audit `authelia.restarted` reason `mail`) or, unchanged, when the CA
  certificate or the password was replaced — files it reads only at start
  (reason `mail-credentials`). While the listener cannot run (a tunnel on
  9295, the port held by another program, a failure) Authelia keeps its
  file notifier; the streak is audited `mail.submission.refused` /
  `mail.submission.recovered` and notified once. create-lamaste makes
  `/etc/authelia/certs` (2750 `lamaste:lamaste-authelia`) and re-owns the
  password file; root never touches a file inside the directory.

`9295` joins `RESERVED_TUNNEL_PORTS` (a tunnel vhost proxies to
`127.0.0.1:<port>`; a tunnel there would receive the panel's traffic). A
relay that already has a tunnel on 9295 is reported at start (audit +
notification) and the listener refuses to start until that tunnel moves;
Lamaste never moves someone's tunnel (Q5).

**`disable_startup_check: true`**: if serverd is down while Authelia
starts, Authelia must still start — otherwise every sign-in stops.

Authelia's mail templates stay its stock English ones in 4.13
(`template_path` is a follow-up; since its mail now passes through
Lamaste, a later version can also render it per domain).

`authentication_backend` becomes:

```yaml
password_change: { disable: true }
password_reset:
  disable: false # set by Authelia itself from custom_url
  custom_url: 'https://auth.<primary domain>/reset'
```

`usersFileWatched` / `ensureUsersFileWatched` change from "reset disabled"
to "**reset disabled, or `custom_url` is one of this relay's
`https://auth.<domain>/reset`**" — Authelia's own reset endpoints are
unregistered in both cases. `custom_url` is set only while some transport
can send. Authelia's setting is global, but its portal reads it from the
index page (`data-resetpasswordcustomurl="…"`, `web/index.html` of
4.39.28), so **each portal links to its own `/reset`** (Q1):
`autheliaIndexRewrite` adds a `sub_filter` replacing the primary's URL
with `https://auth.<d>/reset` on every other domain's auth vhost (ASCII, no
`$` — within what `lamaste-priv` already admits). A domain that cannot
send (no transport resolves, §3.1) gets the attribute emptied, so its
portal shows no reset link.

### 5.1 Health

serverd checks the relay transport at start and every 6 h (§3.4, no mail);
the listener's certificate is renewed 30 days before expiry. Down →
notification to administrators (`mail.transport.down`, with the reason —
`invalid_grant` says "consent again"), up → `mail.transport.up`; Settings
shows the last check.

## 6. Flows

### 6.1 Invitation mails

- `POST /api/invitations` and the delegated
  `POST /api/delegated-invitations/<route>` mail the link to `email` when
  the invitation's domain can send. The answer gains
  `mail: { status: 'sent' | 'failed' | 'not-configured', error? }`; the
  link is still answered once (the inviter may share it another way).
- `invitations.mail_status`, `mail_sent_at` (migration 0022) — the
  listings show it.
- **Resend** = `POST …/:id/reissue`: a new token (the old hash replaced,
  the old link dead), mailed; same rate and caps as creating; a delegated
  policy's `maxOpen` unchanged (it is the same invitation).
- Content: who invited them (display name), to what (the domain's brand /
  the plugin's display name), the link, the expiry, and "if you did not
  expect this, ignore it".

### 6.2 Forgot password

Pages and API on every auth vhost (no mTLS, like `/invite`):

- `GET auth.<d>/reset` — page (core `renderResetPage`, branded and
  translated like the invite page): "username or e-mail".
- `POST /api/account/reset/start { identifier }` → **always**
  `202 { sent: true }` after the same delay, whatever happened (no account
  enumeration). If the identifier names, by username or address
  (case-insensitive), one or more **enabled** users who are members or
  external members of `<d>` with a deliverable address: one mail per
  address, listing each matching username with its own link
  `https://auth.<d>/reset#<token>`. Rate limits: 5 starts / 15 min per IP,
  3 mails / hour per user; over the limit the answer is the same 202.
- Token: 32 random bytes, SHA-256 at rest, **30 min**, single use; a new
  start for a user voids that user's earlier tokens. Table
  `password_resets (id, token_sha256, username, domain, created_at,
expires_at, used_at, failed_attempts)`; swept after 24 h.
- `POST /api/account/reset/lookup { token }` → `{ username, displayName }`
  or the same 410 for every failure.
- `POST /api/account/reset/finish { token, password, totp }` — a current
  TOTP code required (Q2): a stolen mailbox alone cannot take the account.
  Authelia's storage holds the TOTP secret (encrypted with its storage
  key) and its CLI has no per-user verify, so `lamaste-priv` gains
  `authelia-user verify-totp <username>` (code on stdin, 6–8 digits; core
  `verifyAutheliaTotp`, serverd `verifyAutheliaUserTotp`): as the Authelia
  account it runs `authelia storage user totp export uri` (4.39.28:
  one `otpauth://totp/<issuer>:<username>?…` line per configuration,
  `model.TOTPConfiguration.URI`) into its memory through a pipe, keeps the
  one user's line, checks the code itself with that configuration's
  algorithm, digits and period, ±1 step, and prints only `ok <step>` or
  `no` — the secret never leaves the root helper, nothing is written, a
  failure of the CLI is reported without its output. serverd refuses a
  step it already accepted for that user (replay), and failures count
  toward the token's five. A user with no TOTP device, or one who
  lost it, cannot reset by mail — the page says to ask an administrator. Five failed attempts void the
  token. The password follows the invitation rules, is hashed, and written
  through `changeUsers` (users lock, the panel the only writer — S2). The
  user is told by mail that their password changed.
- Audit: `account.password.reset-requested` (user id, domain — never the
  identifier as typed), `account.password.reset`.

### 6.3 Change password (signed in)

- `GET auth.<d>/account/password` — page; the auth vhost puts it and
  `POST /api/account/password` behind Authelia forward auth (the
  `/api/user-access/authorize` pattern), two-factor session required; the
  panel takes the user from `Remote-User` only on that location (headers
  cleared first, as on every identity location).
- `{ currentPassword, newPassword }`: the current one checked against
  users.yml (bcrypt), 5 failures / 15 min per user then 429; written
  through `changeUsers`; mail "your password changed" when the domain can
  send.
- Linked (Q3) from the header of Lamaste's own pages on the auth host
  (invite, inviter's, reset) and from Authelia's portal: the auth vhost's
  index `sub_filter` inserts a plain link (no script, so Authelia's CSP is
  untouched) before `</body>`, styled by the domain's `brand.css`, on
  every domain — branded or stock.

### Sessions after a password change

Authelia keeps sessions in memory and has no "end this user's sessions"
API; its own reset does not end them either. 4.13 does the same
(documented residual): the new password applies at the next sign-in.
Gatekeeper's session cache is busted for the user.

## 7. Without mail

Nothing breaks: invitations answer `mail.status: 'not-configured'` and the
link as today; `/reset` is not linked (no `custom_url`) and its API
answers 404; change password works (it needs no mail) but sends no
notice; Authelia keeps the file notifier.

## 8. Tests

- Unit: transport resolution; Gmail API client against a fake (refresh,
  send, `invalid_grant`, the granted scope and the `id_token` checks,
  limit refusals); consent state (single use,
  expiry, PKCE); the listener (AUTH, sender lock, one RCPT, size, rate);
  Authelia rendering (template lines, sentinel round trip,
  `usersFileWatched` with `custom_url`, never Authelia's own reset);
  token lifecycle; no-enumeration answers; rate limits.
- E2E (rodeo) — the VMs reach neither Google nor a public SMTP server, and
  must not: the relay-wide transport is `smtp` to a **sink** on the VM
  (`helpers.sh` `write_smtp_sink`, mails as files) with a certificate the
  panel trusts (Q4). Through it: invitation mailed (admin, delegated,
  reissue), reset end to end (sign in with the new password), change
  password, Authelia's elevation code arrives through the listener, sink
  down → Authelia still signs in and invitations answer `failed`. The
  Gmail API path is tested against a **fake Google** on the VM (token +
  send endpoints) with its base URLs overridable only through a
  test-only environment variable in a unit drop-in.

## 9. Google Workspace — operator guide (docs)

For sending as `no-reply@notify.codelama.com.tr` over the Gmail API:

1. Admin console → Account → Domains → add `notify.codelama.com.tr` as a
   **user alias domain** (or secondary domain) and verify it (TXT).
2. DNS for `notify.codelama.com.tr`: SPF `v=spf1 include:_spf.google.com ~all`;
   DKIM — Admin console → Apps → Gmail → Authenticate email, generate for
   the subdomain, publish `google._domainkey.notify.codelama.com.tr`, start
   authentication; DMARC `_dmarc.notify.codelama.com.tr`
   `v=DMARC1; p=quarantine; rua=mailto:…`. No MX needed to send.
3. A Workspace user for the relay (`relay@codelama.com.tr`), with
   `no-reply@notify.codelama.com.tr` as its alias (and as a _send-as_
   address in its Gmail settings).
4. Google Cloud console (a project in the Workspace's organisation):
   enable the **Gmail API**; OAuth consent screen **Internal**, scopes
   `gmail.send`, `openid`, `email`; credentials → OAuth client ID → _Web
   application_, authorised redirect URI
   `https://auth.codelama.com.tr/mail/google/callback`.
5. Panel → Settings → Mail → Google: client id and secret, sender
   `no-reply@notify.codelama.com.tr`, name "Code Lama" → _Connect_, sign in
   as `relay@codelama.com.tr`, consent. Send a test and check its From:
   the relay cannot check the send-as alias itself (§3.2).

Hosts with open SMTP ports may use the `smtp` kind instead
(`smtp-relay.gmail.com:587`, STARTTLS, SMTP AUTH with an app password, the
relay's IP allow-listed under Gmail → Routing → SMTP relay service).

## 10. Packages touched

core (`server/authelia.ts` notifier, `certificates_directory` and reset
settings, page renderers for `/reset`, `/account/password` and the
consent callback, translations, `AdminClient`, `account` reserved API
prefix, 9295 in `RESERVED_TUNNEL_PORTS`, schemas), serverd (`lib/mail.js`,
`lib/mail-gmail.js`, `lib/mail-submission.js`, routes, migration 0022,
invitations, nginx auth vhost locations), create-lamaste (`/etc/authelia/certs`
ownership in `lib/ownership.js`), lamaste-priv allow-list for any new
vhost directive, server-ui (Settings → Mail, Domains → Mail, invitation
mail status/reissue), desktop (`admin_commands.rs`), server CLI, docs (API
reference, managing-users, config-files, authentication, a mail guide),
rodeo specs, CHANGELOG. New dependencies: `nodemailer`, `smtp-server`.

## 11. Questions settled (2026-11-10)

| #   | Question                           | Decision                                                                       |
| --- | ---------------------------------- | ------------------------------------------------------------------------------ |
| Q1  | One reset URL or one per portal    | **One per portal** — `auth.<d>/reset` in that domain's brand and language (§5) |
| Q2  | TOTP to finish a reset             | **Required** (§6.2)                                                            |
| Q3  | Where "change password" is found   | **Lamaste's auth-host pages and Authelia's portal** (§6.3)                     |
| Q4  | Private CA for an `smtp` transport | **`caPem`**, a product option the e2e sink also uses (§3.1)                    |
| Q5  | A tunnel already on 9295           | **Refuse the listener and say so**; never move the tunnel (§5)                 |

## 12. Implementation waves

One agent per wave; each wave builds, lints, formats and passes its tests
before the next starts.

1. **Core** (`@lamalibre/lamaste`): 9295 in `RESERVED_TUNNEL_PORTS`,
   `account` in `RESERVED_API_PREFIXES`; transport schemas (`smtp` with
   `caPem`, `gmail-api`, sender address/name), deliverable-address rule
   (§4), transport resolution (§3.1) as pure functions; Authelia
   rendering — SMTP notifier to the listener, `certificates_directory`,
   the second template line and its sentinel, `password_reset.custom_url`,
   `usersFileWatched`/`ensureUsersFileWatched` admitting this relay's
   `/reset` URLs; auth-index filters (per-domain reset URL, emptied when the
   domain cannot send, the change-password link); `hostnameHolder`
   `mail-sender` (D6); page messages EN/TR and renderers for `/reset`,
   `/account/password`, the consent result page and the mails; the
   `AdminClient` methods. Unit tests.
2. **serverd — transports**: migration `0022_mail.sql` (§3.1, `password_resets`,
   `invitations.mail_status|mail_sent_at`), `lib/mail.js`,
   `lib/mail-gmail.js`, SMTP delivery with `caPem`, admission checks,
   consent start + callback, `/api/settings/mail*` and
   `/api/domains/:name/mail*`, the sending budget (§3.7), health monitor,
   audit and notifications,
   D6 in tunnels/sites/aliases. Unit tests with a fake Google and an SMTP
   sink.
3. **serverd — Authelia's mail and the auth host**: the submission
   listener and its local CA, the password file, rendering Authelia's
   notifier on transport changes; `lamaste-priv authelia-user verify-totp` and
   any new vhost directive in its allow-list; create-lamaste ownership of
   `/etc/authelia/certs`; auth vhost locations (callback, `/reset`,
   `/api/account/*`, `/account/password` behind forward auth) and the
   index filters.
4. **serverd — flows**: invitation mails and reissue (admin and
   delegated), forgot password, change password, password-changed notices,
   the Users listing's deliverability flag.
5. **Clients**: server-ui (Settings → Mail, Domains → Mail, invitation mail
   status and reissue, Users flag), web and desktop `AdminClient`
   (`admin_commands.rs`), `lamaste-server mail …`, `domains mail …`,
   `invitations reissue`.
6. **E2E, docs, release**: `write_smtp_sink` and fake Google helpers,
   single-VM and three-VM specs, API reference and guides, CHANGELOG,
   4.13.0 candidate; then review, rodeo, ship.
