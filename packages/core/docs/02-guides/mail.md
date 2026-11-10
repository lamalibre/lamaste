# Mail

> Give your relay a way to send mail: invitations by mail, "Reset password" on every sign-in page, and Authelia's one-time codes.

## In Plain English

A relay without mail works as before: an invitation link is shown once to whoever made it, a forgotten password is reset by an administrator, and Authelia writes its codes to a file. With a **mail transport** the relay mails invitations, every sign-in portal links **Reset password**, and people get a notice when their password changes.

Most relays run on a VPS whose provider blocks outbound SMTP — DigitalOcean blocks ports 25, 465 and 587 on accounts made since mid-2022. So the relay can send **over HTTPS through the Gmail API**, as one Google Workspace mailbox. Where SMTP is open, any SMTP server works too.

This guide sets up the Gmail API with Google Workspace, sending from a subdomain (`no-reply@notify.example.com`) so the relay's mail never mixes with your people's. Reference: [Mail API](../04-api-reference/mail.md).

## What It Costs

- **A Workspace seat** for the sending mailbox (`relay@example.com`). A dedicated mailbox keeps the blast radius of a leaked credential to that one mailbox. Using an existing user with an alias works too, without a new seat.
- **The Gmail API itself is free** at a relay's volume.
- **Google's limits**: 2,000 mails a day per user — **500 while the Workspace is on a trial**, raised once the domain has paid $100 (which can take weeks). Passing a limit stops the mailbox from sending _anything_ for up to 24 hours. The relay [stays below it](#the-sending-budget).

## 1. The Sending Subdomain

Use a subdomain no host uses: `notify.example.com`. It gets mail records (MX, SPF, DKIM), which a DNS wildcard no longer answers for — the relay therefore refuses a tunnel, site or alias on it once it is a sender.

1. **Admin console → Account → Domains → Manage domains → Add a domain**: `notify.example.com` as a **secondary domain** (or a user alias domain), and verify it with the TXT record Google shows.
2. DNS records for `notify.example.com` at your DNS host:

   | Type | Name                                   | Value                                            |
   | ---- | -------------------------------------- | ------------------------------------------------ |
   | MX   | `notify.example.com`                   | `1 smtp.google.com.` — bounces and sender checks |
   | TXT  | `notify.example.com`                   | `v=spf1 include:_spf.google.com ~all`            |
   | TXT  | `google._domainkey.notify.example.com` | the DKIM key Google generates (step 3)           |
   | TXT  | `_dmarc.notify.example.com`            | `v=DMARC1; p=none; rua=mailto:dmarc@example.com` |

3. **Admin console → Apps → Google Workspace → Gmail → Authenticate email**: choose `notify.example.com`, **Generate new record** (2048-bit, selector `google`), publish it at `google._domainkey.notify.example.com` — **under the subdomain**, not under `example.com`, whose own key stays as it is — then **Start authentication**.
4. Read the DMARC reports for a while, then tighten to `p=quarantine`. `dmarc@` can be a Google Group that accepts mail from anyone on the web.

## 2. The Sending Mailbox

1. **Admin console → Directory → Users → Add new user**: `relay@example.com`. Turn on 2-step verification for it.
2. Give it the alias `no-reply@notify.example.com` (the user's **Alternate email addresses**).
3. Sign in to Gmail as `relay@example.com` → **Settings → Accounts → Send mail as → Add another email address**: `no-reply@notify.example.com`, **Treat as an alias**. Make it the default.

## 3. The Google Cloud Project

Signed in as a Workspace administrator (not as `relay@`):

1. [console.cloud.google.com](https://console.cloud.google.com) → **New project**, in your Workspace's **organisation** (without it the "Internal" option below is missing). No billing account is needed.
2. **APIs & Services → Library → Gmail API → Enable**.
3. **Google Auth Platform** (the OAuth consent screen): app name, support e-mail, **Audience: Internal** — only your Workspace's users can consent, and Google reviews nothing. **Data access → Add or remove scopes**: `…/auth/gmail.send`, `openid`, `…/auth/userinfo.email` — nothing more. The relay never reads the mailbox or its settings.
4. **Clients → Create client → Web application**, authorised redirect URI `https://auth.<your primary domain>/mail/google/callback`. Leave "Use this client for an AI-powered agent" unchecked.
5. Copy the **client ID** and **client secret** into your password manager. Google shows the secret once.

If **Create** fails with a generic error, save the consent screen's pages first (unsaved scopes are a common cause) and try again a few minutes later.

## 4. Connect the Relay

**Panel → Settings → Mail → Google**: the client ID, the client secret, the sender `no-reply@notify.example.com` and its name → **Connect**. Open the link, sign in as `relay@example.com`, consent. The page on your sign-in host says "Mail Is Set Up"; the panel shows the transport.

From a terminal on the relay:

```bash
lamaste-server mail google --client-id <id> --client-secret-stdin --sender no-reply@notify.example.com --sender-name "Example"
```

It prints the link and waits for Google to come back.

Then **send a test mail** and check its **From**: the relay asks Google for `gmail.send` only, so it cannot see the mailbox's send-as addresses — Gmail sends from `relay@` itself when the alias is missing.

Finally set the **daily limit**: 500 while the Workspace is on a trial, 2,000 once it is paid (**Settings → Mail → Daily limit**, or `lamaste-server mail limit 2000`).

## An SMTP Server Instead

Where the relay can reach an SMTP server (not DigitalOcean's new accounts):

```bash
lamaste-server mail set-smtp --host smtp.example.com --port 587 --security starttls \
  --username relay@example.com --password-stdin --sender no-reply@notify.example.com
```

The relay checks the server before storing it. A server whose certificate comes from a private CA (a self-hosted mail server) needs that CA: `--ca-file ca.pem` (the panel: "Trust a private CA"). It is trusted for that transport alone, beside the system's. A later change keeps the stored CA and password for the same host; `--no-ca` removes the CA.

## A Domain's Own Sender

On a relay with several domains, each domain's mail can come from its own sender: **Domains → a domain → Mail**, or `lamaste-server domains mail <domain> sender --address no-reply@notify.<domain>`. It goes through the relay's transport (a Workspace mailbox must hold that alias too), or the domain can have a transport of its own. A domain sends nothing when it has no transport and the relay has none.

## What People Get

- **Invitations** are mailed (the administrator's and delegated ones), in the domain's language and brand. A **new link** (Users → Invitations, or the inviter's page) mails a fresh link and kills the old one.
- **Reset password** on every sign-in portal: `auth.<domain>/reset`. A link by mail, then a new password **and a current authenticator code** — someone who only has the mailbox cannot take the account. Someone who lost their authenticator asks an administrator.
- **Change password**: linked from every sign-in portal, `auth.<domain>/account/password`.
- A **"your password changed"** mail after either.
- Authelia's **one-time codes** (before managing two-factor devices in its settings) arrive by mail.

Users whose address cannot receive mail (`@lamaste.local`, `.test`, …) cannot reset their own password; the Users page marks them. Give them a real address.

## The Sending Budget

The relay counts what it sends per mailbox over 24 hours and sends at most 90 % of the daily limit. The last 20 % is kept for Authelia's codes, notices and administrators' invitations: reset mails and delegated invitations stop first, and reset mails are capped at 30 an hour, so nobody can use the public reset page to exhaust your mailbox. You are notified at 70 % and when sending stops, with when it resumes. If Google still refuses ("daily limit exceeded"), the mailbox rests 24 hours; once Google's admin console shows it sending again, **Resume** (`lamaste-server mail resume`).

## Troubleshooting

| Symptom                                          | Cause and fix                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| SMTP check times out                             | The provider blocks outbound SMTP: use the Gmail API                                                              |
| SMTP check: `tls`                                | The server's certificate is not trusted: give its CA (`--ca-file`)                                                |
| Settings → Mail: down, `invalid_grant`           | `relay@`'s password changed, or the grant was revoked: connect Google again                                       |
| Mail arrives From `relay@` instead of the sender | The sender is not a send-as address of `relay@` (step 2)                                                          |
| An invitation answers `deferred-budget`          | The daily budget is used: share the link another way, or raise the limit if the Workspace is paid                 |
| Notification: a tunnel uses port 9295            | A tunnel from before 4.13 sits on the mail listener's port: move it; Authelia writes its mail to a file meanwhile |
