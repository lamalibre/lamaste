# Managing Users

> Add, update, and remove Authelia users who can access your tunneled apps through TOTP two-factor authentication.

## In Plain English

Every tunneled app in Lamaste is protected by Authelia, a login system that requires a username, password, and a one-time code from an authenticator app. When you create a user in the Lamaste panel, that person can log in to any of your tunneled apps. This guide covers the full lifecycle: creating users, enrolling them in two-factor authentication, changing passwords, and offboarding them — disabling, deleting and erasing users. The same users can be given roles in agent-hosted plugins ([Agent-Hosted Plugins](../04-api-reference/agent-hosted-plugins.md#users-and-identity)), which know them by a stable user ID.

## Prerequisites

- A completed [Lamaste onboarding](onboarding.md)
- Access to the Lamaste admin panel
- An authenticator app for TOTP enrollment (Google Authenticator, Authy, 1Password, etc.)

## Step-by-Step

### 1. Open the Users Page

Log in to the Lamaste admin panel at `https://<ip>:9292`.

Click **Users** in the sidebar navigation.

You see a list of existing users — each with its status (**active** or **disabled**) and its **user ID**, the stable id plugins know the user by (click it to copy). After onboarding, there is one user: `admin` — the account created during provisioning.

### 2. Add a New User

Click the **Add User** button.

A form appears with these fields:

| Field            | Required | Rules                                                                                            | Example                   |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------ | ------------------------- |
| **Username**     | Yes      | 2-32 chars, lowercase alphanumeric with underscores and hyphens, starting with a letter or digit | `alice`                   |
| **Display Name** | Yes      | 1-100 characters                                                                                 | `Alice Johnson`           |
| **Email**        | Yes      | Valid email address                                                                              | `alice@example.com`       |
| **Password**     | Yes      | 8-128 characters                                                                                 | A strong, unique password |
| **Groups**       | No       | Optional list of group names                                                                     | `admins`, `developers`    |

Fill in the form and click **Create User**.

**What happens behind the scenes:**

1. The panel validates all fields against the schema.
2. The password is hashed with **bcrypt** (not argon2id — argon2id uses ~93 MB per hash and causes OOM kills on 512 MB droplets).
3. The user record is written to `/etc/authelia/users.yml` using an atomic write (write to temp file, then rename) to prevent corruption.
4. The user directory gives the user a `userId` (a UUID v4), then Authelia is reloaded to pick up the new user.

**Expected result:** The new user appears in the list. Share the username and password with the person — they need these to log in to your tunneled apps.

### 3. TOTP Enrollment

When a new user visits a Lamaste-protected app for the first time:

1. They are redirected to `auth.example.com`.
2. They enter their username and password.
3. Authelia presents a QR code for TOTP enrollment.
4. They scan the QR code with their authenticator app.
5. They enter the 6-digit code to verify.
6. TOTP is now active. Every future login requires the code.

**Walk a new user through this process:**

1. Share the tunnel URL (e.g., `https://app.example.com`) and their credentials.
2. Tell them to open the URL in their browser.
3. They log in with the username and password you provided.
4. They scan the QR code with Google Authenticator, Authy, 1Password, or any TOTP-compatible app.
5. They enter the verification code.
6. They are logged in and can access the app.

### 4. Reset a User's TOTP Secret

If a user loses access to their authenticator app (lost phone, new device), you can reset their TOTP secret so they can re-enroll.

1. Go to the **Users** page.
2. Find the user in the list.
3. Click the **Reset TOTP** button next to the user.
4. The panel generates a new TOTP secret and returns a TOTP URI.
5. A QR code is displayed — the user scans it with their authenticator app.

**What happens behind the scenes:**

1. The panel generates a new base32-encoded TOTP secret.
2. The secret is written to Authelia's SQLite database (`/etc/authelia/db.sqlite3`) via the `authelia storage user totp generate` CLI command. TOTP secrets are stored in the database, not in `users.yml` (the `totp_secret` field in `users.yml` is deprecated and ignored in Authelia v4.38+).
3. The TOTP URI is returned in the format `otpauth://totp/Lamaste:<username>?secret=<secret>&issuer=Lamaste&algorithm=SHA1&digits=6&period=30`.

On their next login, the user enters a code from the new TOTP entry in their authenticator app. The old entry no longer works.

### 5. Change a User's Password

1. Go to the **Users** page.
2. Find the user and click **Edit** (or the edit icon).
3. Enter a new password in the password field.
4. Click **Save**.

The new password is hashed with bcrypt and written to `users.yml`. Authelia is reloaded. The user must use the new password on their next login.

You can also update the display name, email, and groups in the same edit form.

### 6. Update User Details

To change a user's display name, email, or group membership:

1. Go to the **Users** page.
2. Click **Edit** on the user.
3. Modify the fields you want to change.
4. Click **Save**.

Only the fields you change are updated — the password and TOTP secret remain the same unless explicitly changed.

### 7. Disable a User (Offboarding)

When someone leaves, **disable** them first — it is immediate and reversible:

1. Go to the **Users** page.
2. Click **Disable** on the user and confirm.

The user's status turns **disabled**. From that moment:

- they can no longer sign in to Authelia (Authelia's `disabled: true`);
- every agent-hosted plugin's user surface refuses them (`403`) — the panel's directory is updated in the same step;
- every plugin they use sees them as `disabled` in its audience (its agent half is told within seconds while it is online);
- their desktop app sessions end and their registry (Feria) tokens are revoked.

Their `userId`, grants and group memberships stay, so **Enable** brings everything back as it was (their desktop app signs in again). The last enabled member of the `admins` group cannot be disabled — the panel refuses with "Cannot disable the last enabled administrator". A user disabled by editing `users.yml` directly is offboarded the same way within a minute, when the panel notices.

If Authelia rewrites `users.yml` at the very moment you disable someone (a password reset it handles writes the whole file), the panel notices when it reads the file back and disables the user again; should that not stick either, the panel says the change did not persist instead of reporting success — check the user and disable them again.

```bash
lamaste-server users disable alice
lamaste-server users enable alice
```

### 8. Delete a User

1. Go to the **Users** page.
2. Click the **Delete** button next to the user you want to remove.
3. Leave **Also erase personal data** unchecked to keep a tombstone (see below), or check it to erase at once.
4. Confirm the deletion.

**Safety rule:** You cannot delete the last user. Lamaste enforces this to prevent locking everyone out of the tunneled apps. If you try to delete the last user, the panel returns an error: "Cannot delete the last user."

**What happens behind the scenes:**

1. The panel removes the user from `users.yml` (atomic write, under the panel's one lock for user changes); Authelia reloads it and ends the user's session at their next request.
2. The user directory keeps a **tombstone**: the user's `userId` and their last username, display name and email, marked `removed`. Plugins that had the user as a member are told the user was deleted and keep what they last received, so a plugin's history — "approved by Alice Smith" — stays readable.
3. Gatekeeper drops every grant naming the username and its membership of every Lamaste group. If Gatekeeper is unreachable, the panel says so and retries every minute; until it succeeds, the username holds no role in any plugin and cannot be given to a new user.
4. Authelia deletes the user's second factors — their TOTP configuration and WebAuthn security keys.
5. The user's registry tokens, desktop sessions and legacy plugin-access grants end.

A user removed from `users.yml` by hand is offboarded the same way within a minute, when the panel notices.

After deletion, the user can no longer log in to any tunneled app.

```bash
lamaste-server users delete alice           # keeps the tombstone
lamaste-server users delete alice --erase   # and erases it in the same step
```

### 9. Erase a Deleted User

A tombstone keeps a name and an address. When a person asks for their personal data to be removed, **erase** it:

1. Go to the **Users** page and scroll to **Deleted users** — every tombstone the directory keeps, with its `userId`, when it was removed and whether Gatekeeper's cleanup is still pending.
2. Click **Erase** on the user and confirm.

Erasing deletes the user's invitations, Gatekeeper's access-request log entries for them and any second factors Authelia still holds, then scrubs the tombstone to the bare `userId`. Every plugin that ever had the user as a member is sent an erasure: its agent half scrubs its own row and anonymises what the plugin keeps about the user — and never takes the user back afterwards, whatever it is sent later. Until each plugin has acknowledged it, **Deleted users** lists that plugin under the user as a pending erasure — seconds while the hosting agent is online, or when it reconnects. A plugin that was uninstalled while an agent keeps its data, or that no longer declares users, is listed too, marked as not taking the feed: the erasure reaches its data when it comes back, or goes with the data when you purge it (Plugins page, Retained data).

Erasure cannot be undone. It cannot reach what Authelia keeps on its own — the user's OpenID Connect identity (the reason a username that ever signed in to an OpenID Connect application cannot be given to anyone else) and its authentication log — nor nginx's access logs, the system journal's older entries or backups taken before it ([what the logs keep](../05-operations/monitoring.md#logs-and-personal-data)).

```bash
lamaste-server users directory              # every user the directory knows, tombstones and pending erasures
lamaste-server users erase 7d9e1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b
```

### Disable, delete or erase?

| Action      | Can sign in | Plugins see                            | Reversible | Use when                                      |
| ----------- | ----------- | -------------------------------------- | ---------- | --------------------------------------------- |
| **Disable** | No          | The user, `disabled`                   | Yes        | Someone leaves or must be locked out now      |
| **Delete**  | No          | A removed user, last name kept         | No         | The account is gone for good; history matters |
| **Erase**   | —           | A bare `userId`; their data anonymised | No         | The person asked for their data to be removed |

### Re-created usernames

A username that comes back after a deletion — re-created by hand, through an invitation, or edited into `users.yml` — is a **new user with a new `userId`**. Plugins key their data on the `userId`, so the new person sees nothing of the old one's. Before the panel creates the user, Gatekeeper drops everything it holds under the username and Authelia deletes any second factors under it — every time, even when nothing should be left: no grant, group membership, plugin role, TOTP or security key passes from one person to the next, nor a desktop session. If that cannot be done now (Gatekeeper or Authelia's storage unavailable), creating the user is refused with a message saying so — try again later. While a deleted user's username is not held by anyone, nothing can be granted to it (refused with "username_deleted").

**A username that has signed in to an OpenID Connect application cannot be reused.** When a user signs in to an application through Lamaste's OpenID Connect provider (a plugin's login, a registry), Authelia gives them an identifier tied to their username, which it cannot delete. A new person under that username would be the old person to every such application — so the panel refuses to create a user, or accept an invitation, under it (`username_has_oidc_identity`): choose another username, such as `alice2`.

## For Developers

### User Storage

Users are stored in Authelia's `users.yml` file at `/etc/authelia/users.yml`. The file format is:

```yaml
users:
  admin:
    displayname: Admin
    email: admin@example.com
    password: $2b$12$... # bcrypt hash
    groups:
      - admins
  alice:
    displayname: Alice Johnson
    email: alice@example.com
    password: $2b$12$...
    groups: []
```

Note: TOTP secrets are stored in Authelia's SQLite database (`/etc/authelia/db.sqlite3`), not in `users.yml`. The `totp_secret` field in `users.yml` is deprecated and ignored in Authelia v4.38+.

All writes to this file are atomic: write to a temp file, then rename. This prevents Authelia from reading a partially-written file.

### API Endpoints

| Method   | Path                                    | Purpose                                                                                 |
| -------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET`    | `/api/users`                            | List all users (sorted alphabetically, no sensitive fields), with `userId` and `status` |
| `POST`   | `/api/users`                            | Create a new user                                                                       |
| `PUT`    | `/api/users/:username`                  | Update user fields; `{ "disabled": true \| false }` disables or enables                 |
| `DELETE` | `/api/users/:username[?erase=true]`     | Delete a user (not the last one); a tombstone stays unless erased                       |
| `POST`   | `/api/users/:username/reset-totp`       | Generate a new TOTP secret                                                              |
| `GET`    | `/api/identity/directory`               | Every user the directory knows, tombstones and pending erasures included                |
| `POST`   | `/api/identity/directory/:userId/erase` | Erase a removed user                                                                    |

Details: [Users API](../04-api-reference/users.md).

### The User Directory

Authelia's `users.yml` stays Authelia's credential file; the panel's `state.db` holds the **directory** beside it: a `userId` per user, the status, and the tombstones of deleted users. Every write of `users.yml` the panel makes goes through one lock that brings the directory in line in the same step. The panel also reads `users.yml` at start and every minute — never writing it — and adopts what changed outside Lamaste (Authelia's own password reset rewrites the file): a new username gets a new `userId`, a changed name, address or `disabled` flag is taken over, and a user gone from the file (seen in two reads) becomes a tombstone marked `deleted-outside`. Audit entries name users by `userId` only.

### The CLI

Every command goes through the running panel with the admin certificate (`--json` prints NDJSON):

```bash
lamaste-server users list                 # username, status, userId, groups
lamaste-server users disable <username>
lamaste-server users enable <username>
lamaste-server users delete <username> [--erase]
lamaste-server users erase <userId>
lamaste-server users directory            # tombstones, erasures, pending cleanups and erasures
```

### Create User Request

```json
POST /api/users
{
  "username": "alice",
  "displayname": "Alice Johnson",
  "email": "alice@example.com",
  "password": "securepassword123",
  "groups": ["developers"]
}
```

Response:

```json
{
  "ok": true,
  "user": {
    "username": "alice",
    "displayname": "Alice Johnson",
    "email": "alice@example.com",
    "groups": ["developers"]
  }
}
```

### Update User Request

```json
PUT /api/users/alice
{
  "displayname": "Alice J.",
  "password": "newpassword456"
}
```

Only provided fields are updated. At least one field must be present.

### Reset TOTP Response

```json
POST /api/users/alice/reset-totp

{
  "ok": true,
  "totpUri": "otpauth://totp/Lamaste:alice?secret=JBSWY3DPEHPK3PXP&issuer=Lamaste"
}
```

The `totpUri` is used to generate a QR code that the user scans with their authenticator app.

### Validation Rules (Zod Schema)

| Field         | Rules                                     |
| ------------- | ----------------------------------------- |
| `username`    | 2-32 chars, regex `^[a-z0-9][a-z0-9_-]*$` |
| `displayname` | 1-100 chars                               |
| `email`       | Valid email format                        |
| `password`    | 8-128 chars                               |
| `groups`      | Optional array of strings                 |

### Password Hashing

Passwords are hashed with bcrypt at cost factor 12. The `hashPassword()` function in `lib/authelia.js` handles this. Argon2id is explicitly avoided because a single hash operation consumes ~93 MB of memory, which causes OOM kills on the 512 MB target droplet.

### Authelia Reload

Authelia watches `users.yml` (`authentication_backend.file.watch: true`) and reloads it in place; with the watch it re-reads a user's details at each of their requests, so a change applies at the user's next request without a restart and without ending anyone else's session. It skips a reload within 0.5 s of the previous one, so the panel writes the file once more 0.6 s after its last write. Who may reach which domain is part of the file too: the groups Lamaste owns (`lamaste:member@<domain>`, `lamaste:external@<domain>`, hostnames, `lamaste:oidc@<client>` — never shown as groups). Authelia restarts only when its configuration changes: a domain or a protected static site added or removed, the OIDC clients changed.

## Quick Reference

| Action              | Steps                                             |
| ------------------- | ------------------------------------------------- |
| **Add user**        | Users page, "Add User", fill form, "Create User"  |
| **Edit user**       | Users page, "Edit" on user, modify fields, "Save" |
| **Change password** | Edit user, enter new password, "Save"             |
| **Reset TOTP**      | Users page, "Reset TOTP" on user, share QR code   |
| **Disable user**    | Users page, "Disable" on user, confirm            |
| **Delete user**     | Users page, "Delete" on user, confirm             |
| **Erase user**      | Users page, Deleted users, "Erase", confirm       |

| Constraint       | Value                                                       |
| ---------------- | ----------------------------------------------------------- |
| Username format  | `^[a-z0-9][a-z0-9_-]*$` (users and invitations)             |
| Username length  | 2-32 characters                                             |
| Password length  | 8-128 characters                                            |
| Password hashing | bcrypt (cost 12)                                            |
| Minimum users    | 1 (cannot delete last user)                                 |
| Administrators   | The last enabled `admins` member cannot be disabled         |
| User ID          | UUID v4, never reused; a re-created username gets a new one |
| TOTP algorithm   | SHA1, 6 digits, 30-second period                            |
| User file        | `/etc/authelia/users.yml`                                   |
