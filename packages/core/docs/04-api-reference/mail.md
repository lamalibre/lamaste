# Mail API

> How the relay sends mail — invitations, password resets, "your password changed" notices and Authelia's one-time codes — and how a person resets or changes their own password.

## In Plain English

Until 4.13 a relay sent no mail: an invitation link was shown once to its inviter, nobody could recover a forgotten password, and Authelia wrote its one-time codes to a file. A relay now has a **mail transport**: either the **Gmail API** (one Google Workspace mailbox, over HTTPS — what works where outbound SMTP is blocked, as on DigitalOcean) or an **SMTP server**. The relay's transport carries Authelia's mail and is every domain's default; a domain may set its own sender, or its own transport.

With a transport, invitations are mailed, every sign-in portal links its own **Reset password** page (`auth.<domain>/reset` — a link by mail, then a new password with a current authenticator code), and **Change password** (`auth.<domain>/account/password`) sends a notice. Authelia never talks to the mail provider: it submits to the panel's own listener on `127.0.0.1:9295`, which delivers through the relay's transport. Without a transport nothing changes from 4.12.

Design: `packages/core/docs/mail-design.md`. Setting it up: [Mail](../02-guides/mail.md).

## Authentication

The mail settings require an admin certificate (mTLS). The account routes (`/api/account/*`) are public, on a domain's sign-in host only (`auth.<domain>`); `POST /api/account/password` is behind Authelia's two-factor forward auth. Google's callback is public, on the primary's sign-in host only.

## Transport Object

`GET` answers `{ transport }` — the object below, or `null`.

| Field                     | Type           | Description                                                                                                      |
| ------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `scope`                   | string         | `relay` or `domain`                                                                                              |
| `domain`                  | string \| null | The domain of a domain row                                                                                       |
| `kind`                    | string \| null | `gmail-api`, `smtp`, or `null` — a domain row that sets a sender only (over the relay's transport)               |
| `settings`                | object \| null | `smtp`: `{ host, port, security, username, hasCaPem }`; `gmail-api`: `{ clientId, account }` — never a secret    |
| `sender`                  | object         | `{ address, name }` — `name` `null`: the domain's brand name, else "Lamaste"                                     |
| `hasSecret`               | boolean        | A password, or a Google client secret and refresh token, is stored                                               |
| `verifiedAt`, `updatedAt` | string         | ISO 8601                                                                                                         |
| `health`                  | object \| null | `{ status: up \| down, checkedAt, reason }` — checked at start and every 6 hours; `invalid_grant`: consent again |
| `budget`                  | object         | [The sending budget](#the-sending-budget)                                                                        |

## Endpoints

Every path below exists for the relay (`/api/settings/mail…`) and for a domain (`/api/domains/:name/mail…`).

### `GET /api/settings/mail`

The relay's transport, or `{ "transport": null }`.

### `PUT /api/settings/mail` — an SMTP server

Checked before it is stored (connect, TLS, EHLO, AUTH — nothing is sent); refused `422 mail_check_failed` with a `reason` (`tls`, `auth`, `timeout`, `connect`…) and nothing stored.

```json
{
  "host": "smtp.example.com",
  "port": 465,
  "security": "tls",
  "username": "relay@example.com",
  "password": "…",
  "caPem": "-----BEGIN CERTIFICATE-----…",
  "senderAddress": "no-reply@notify.example.com",
  "senderName": "Example",
  "dailyLimit": 500
}
```

- `security` — `tls` (implicit, usually 465) or `starttls` (usually 587). Certificates are always verified.
- `password` omitted keeps the stored one — for the same host and username only.
- `caPem` — CA certificates (PEM, ≤ 16 KiB, CA certificates only) trusted **beside** the system's for this transport alone: a self-hosted mail server with a private CA. Omitted keeps the stored bundle for the same host only; `null` or `""` removes it.
- `dailyLimit` — 1–100000; omitted keeps the stored one, else 500.
- A sender under one of the relay's domains (`notify.example.com`) is refused `409 mail_sender_host_taken` when a tunnel, site or alias serves that hostname, or when it is one of the relay's own hostnames.
- A timeout says the host may block outbound SMTP (DigitalOcean does on new accounts): use the Gmail API.

### `POST /api/settings/mail/google/start` — the Gmail API

```json
{
  "clientId": "123456789012-abc….apps.googleusercontent.com",
  "clientSecret": "GOCSPX-…",
  "senderAddress": "no-reply@notify.example.com",
  "senderName": "Example",
  "dailyLimit": 500
}
```

Answers `{ authorizeUrl, expiresAt }` (10 minutes). Open the URL, sign in as the sending Workspace user and consent; Google sends the browser to `https://auth.<primary>/mail/google/callback`, where the panel exchanges the code (PKCE), reads the account from Google's token, checks the grant includes `gmail.send`, and stores the transport. The page says whether it worked. Poll `GET` until `updatedAt` changes. The relay asks for `gmail.send`, `openid` and `email` only — it cannot list the account's send-as addresses, so a sender other than the account comes with a warning: send a test mail and check its From.

### `GET https://auth.<primary>/mail/google/callback`

Public; Google's redirect. Answered only on the primary's sign-in host (404 elsewhere); the `state` is single use and lives 10 minutes. A static page, in the primary's brand and language.

### `PATCH /api/settings/mail`

`{ senderAddress?, senderName?, dailyLimit? }` — the transport unchanged.

### `PUT /api/domains/:name/mail/sender`

`{ senderAddress, senderName? }` — a domain's own sender over the relay's transport (its row's `kind` is `null`).

### `DELETE /api/settings/mail`

Removes the transport; a Google grant is revoked (best effort — a `warnings` entry when Google did not confirm). Without a relay transport Authelia writes its mail to a file again and the listener stops.

### `POST /api/settings/mail/test`

`{ to }` — a real mail, in the domain's language and brand. Answers `{ mail: { status, error? } }`.

### `POST /api/settings/mail/resume`

Ends a provider's limit refusal early (below), once the provider's console shows the account sending again.

## Mail Status

Every answer that may mail carries `mail: { status, error? }`:

| Status            | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `sent`            | Delivered to the transport                                              |
| `failed`          | The transport refused or could not be reached (`error` names the class) |
| `not-configured`  | The domain cannot send: no transport of its own and none on the relay   |
| `deferred-budget` | Held back by the [sending budget](#the-sending-budget)                  |

An invitation's link is answered whatever the status, so the inviter can share it another way. There is no outbox: a token is stored only as a hash, so sending again means a [new link](invitations.md#post-apiinvitationsidreissue).

## The Sending Budget

A provider that sees an account pass its limit stops it from sending **anything** for up to 24 hours (Google Workspace: 2,000 messages a day, **500 on a trial**). The relay stays below:

- Every delivery attempt is counted per **sending account** (`gmail:<account>` or `smtp:<host>:<username>`), over a rolling 24 hours, whichever rows send through it.
- **Ceiling**: at most 90 % of the row's `dailyLimit`.
- **Classes**: `essential` (Authelia's mail, "password changed", test mails) and `admin` (an administrator's invitations) may use the whole ceiling; `public` (reset mails, delegated invitations) stops 20 % below it. Reset mails are also capped at 30 an hour per account. A reset start still answers its 202; an invitation answers `deferred-budget`; Authelia gets a 4xx and shows its own error.
- **Notifications**: `mail.budget.warning` at 70 % of the ceiling, `mail.budget.exhausted` when a cap is reached, with when sending resumes.
- **The provider's refusal** (Gmail `dailyLimitExceeded`, `userRateLimitExceeded`, a "sending limit exceeded" reply; SMTP limit replies): every row on that account is **limited** for 24 hours — nothing is tried — `mail.transport.limited` is notified. `POST …/resume` ends it.

```json
"budget": {
  "dailyLimit": 500,
  "ceiling": 450,
  "publicCap": 360,
  "sent24h": 12,
  "byClass": { "essential": 3, "admin": 4, "public": 5 },
  "resetsLastHour": 1,
  "limitedUntil": null,
  "resumesAt": null
}
```

## Account Routes

On every domain's sign-in host, `https://auth.<domain>/…`. A change must come from the page itself: `Sec-Fetch-Site` absent or `same-origin`, and an `Origin` (when sent; required for a password change) exactly `https://auth.<domain>` — otherwise `403 forbidden`. Answers are never cached and carry codes, never the server's words.

| Method | Path                        | Body                               | Answers                                                                                                    |
| ------ | --------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET`  | `/reset`                    | —                                  | The reset page, in the domain's brand and language                                                         |
| `POST` | `/api/account/reset/start`  | `{ identifier }`                   | Always `202 { "sent": true }` after the same delay; `404 reset_unavailable` when the domain cannot send    |
| `POST` | `/api/account/reset/lookup` | `{ token }`                        | `{ username, displayName }`; `410 reset_invalid` for every failure                                         |
| `POST` | `/api/account/reset/finish` | `{ token, password, totp }`        | `{ ok: true }`; `400 totp_invalid`, `409 no_totp`, `410 reset_invalid`, `503 authelia_storage_unavailable` |
| `GET`  | `/account/password`         | —                                  | The change-password page (Authelia two-factor session)                                                     |
| `POST` | `/api/account/password`     | `{ currentPassword, newPassword }` | `{ ok: true }`; `401` (no session), `403`, `429`, `400 current_password_invalid` / `password_unchanged`    |

**Forgot password.** `identifier` is a username or an address. If it names enabled members (or external members) of the domain with a deliverable address, one mail per address lists each username with its own link `https://auth.<domain>/reset#<token>` — the token in the fragment, never in a URL a log keeps. The work runs after the answer, so neither the answer nor its timing says what was found. Limits: 5 starts per 15 minutes per address, 3 mails an hour per user, 20 accounts per start; over a limit the answer is the same. A link lives 30 minutes, is single use, and a new start voids the user's earlier links.

**Finishing needs a current authenticator code.** A stolen mailbox alone cannot take the account. The panel checks the code through `lamaste-priv authelia-user verify-totp` (the secret never leaves that root helper) and refuses a code it already accepted for the user, even after a restart. Five wrong or replayed codes void the link. A user without an authenticator gets `409 no_totp` — the page says to ask an administrator, who sets a password on the Users page. The new password follows the invitation rules; a "password changed" mail follows.

**Change password.** Behind Authelia's forward auth; the current password is always checked (the panel listens on loopback, where any local process could send the user header): 5 failures per 15 minutes per user, then 429.

**Sessions.** Authelia has no way to end a user's sessions; a new password applies at the next sign-in. Gatekeeper's cached decisions for the user are dropped.

## Users Without a Deliverable Address

An address under `.example`, `.invalid`, `.local`, `.localhost` or `.test` (the onboarding administrator's `<username>@lamaste.local`) receives no mail: such a user cannot reset their own password. `GET /api/users` marks each user `emailDeliverable`.

## Audit

`mail.transport.set|cleared|limited|resumed|down|up`, `mail.budget.warning|exhausted`, `mail.sent|failed` (kind of mail, the recipient's domain only), `mail.submission.refused|recovered`, `account.password.reset-requested|reset|changed` — user ids and domains, never an address, a token, a password or a secret.

## CLI

```bash
lamaste-server mail show
lamaste-server mail set-smtp --host <h> [--port 587] [--security starttls|tls] [--username <u>] [--password-stdin] [--ca-file <ca.pem> | --no-ca] --sender <address> [--sender-name <name>] [--daily-limit <n>]
lamaste-server mail google --client-id <id> [--client-secret-stdin] --sender <address> [--sender-name <name>] [--daily-limit <n>] [--no-wait]
lamaste-server mail sender [--address <a>] [--name <n> | --no-name]
lamaste-server mail limit <n>
lamaste-server mail test <to>
lamaste-server mail resume
lamaste-server mail clear
lamaste-server domains mail <domain> <same subcommands>
```

Secrets are never arguments: pipe them in (`--password-stdin`, `--client-secret-stdin`) or type them at the prompt. `--json` for NDJSON.
