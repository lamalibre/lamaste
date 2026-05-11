# Managing Users

> Add, update, and remove Authelia users who can access your tunneled apps through TOTP two-factor authentication.

## In Plain English

Every tunneled app in Lamaste is protected by Authelia, a login system that requires a username, password, and a one-time code from an authenticator app. When you create a user in the Lamaste panel, that person can log in to any of your tunneled apps. This guide covers the full lifecycle: creating users, enrolling them in two-factor authentication, changing passwords, and safely removing users.

## Prerequisites

- A completed [Lamaste onboarding](onboarding.md)
- Access to the Lamaste admin panel
- An authenticator app for TOTP enrollment (Google Authenticator, Authy, 1Password, etc.)

## Step-by-Step

### 1. Open the Users Page

Log in to the Lamaste admin panel at `https://<ip>:9292`.

Click **Users** in the sidebar navigation.

You see a list of existing users. After onboarding, there is one user: `admin` — the account created during provisioning.

### 2. Add a New User

Click the **Add User** button.

A form appears with these fields:

| Field            | Required | Rules                                                           | Example                   |
| ---------------- | -------- | --------------------------------------------------------------- | ------------------------- |
| **Username**     | Yes      | 2-32 chars, lowercase alphanumeric with underscores and hyphens | `alice`                   |
| **Display Name** | Yes      | 1-100 characters                                                | `Alice Johnson`           |
| **Email**        | Yes      | Valid email address                                             | `alice@example.com`       |
| **Password**     | Yes      | 8-128 characters                                                | A strong, unique password |
| **Groups**       | No       | Optional list of group names                                    | `admins`, `developers`    |

Fill in the form and click **Create User**.

**What happens behind the scenes:**

1. The panel validates all fields against the schema.
2. The password is hashed with **bcrypt** (not argon2id — argon2id uses ~93 MB per hash and causes OOM kills on 512 MB droplets).
3. The user record is written to `/etc/authelia/users.yml` using an atomic write (write to temp file, then rename) to prevent corruption.
4. Authelia is reloaded to pick up the new user.

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

### 7. Remove a User

1. Go to the **Users** page.
2. Click the **Delete** button next to the user you want to remove.
3. Confirm the deletion.

**Safety rule:** You cannot delete the last user. Lamaste enforces this to prevent locking everyone out of the tunneled apps. If you try to delete the last user, the panel returns an error: "Cannot delete the last user."

**What happens behind the scenes:**

1. The panel removes the user from `users.yml` (atomic write).
2. Authelia is reloaded.
3. Any active sessions for that user expire naturally (Authelia does not have a "force logout" mechanism, but sessions have a timeout).

After deletion, the user can no longer log in to any tunneled app.

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

| Method   | Path                              | Purpose                                                     |
| -------- | --------------------------------- | ----------------------------------------------------------- |
| `GET`    | `/api/users`                      | List all users (sorted alphabetically, no sensitive fields) |
| `POST`   | `/api/users`                      | Create a new user                                           |
| `PUT`    | `/api/users/:username`            | Update user fields                                          |
| `DELETE` | `/api/users/:username`            | Delete a user (not the last one)                            |
| `POST`   | `/api/users/:username/reset-totp` | Generate a new TOTP secret                                  |

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

| Field         | Rules                             |
| ------------- | --------------------------------- |
| `username`    | 2-32 chars, regex `^[a-z0-9_-]+$` |
| `displayname` | 1-100 chars                       |
| `email`       | Valid email format                |
| `password`    | 8-128 chars                       |
| `groups`      | Optional array of strings         |

### Password Hashing

Passwords are hashed with bcrypt at cost factor 12. The `hashPassword()` function in `lib/authelia.js` handles this. Argon2id is explicitly avoided because a single hash operation consumes ~93 MB of memory, which causes OOM kills on the 512 MB target droplet.

### Authelia Reload

After every write to `users.yml`, the panel restarts Authelia:

```bash
sudo systemctl restart authelia
```

Authelia reads `users.yml` on restart. If the restart fails, a warning is logged but the API request still succeeds — the user data is persisted and the next Authelia restart picks it up.

## Quick Reference

| Action              | Steps                                             |
| ------------------- | ------------------------------------------------- |
| **Add user**        | Users page, "Add User", fill form, "Create User"  |
| **Edit user**       | Users page, "Edit" on user, modify fields, "Save" |
| **Change password** | Edit user, enter new password, "Save"             |
| **Reset TOTP**      | Users page, "Reset TOTP" on user, share QR code   |
| **Delete user**     | Users page, "Delete" on user, confirm             |

| Constraint       | Value                            |
| ---------------- | -------------------------------- |
| Username format  | `^[a-z0-9_-]+$`                  |
| Username length  | 2-32 characters                  |
| Password length  | 8-128 characters                 |
| Password hashing | bcrypt (cost 12)                 |
| Minimum users    | 1 (cannot delete last user)      |
| TOTP algorithm   | SHA1, 6 digits, 30-second period |
| User file        | `/etc/authelia/users.yml`        |
