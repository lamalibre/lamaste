# Audit Log & Notifications

The panel keeps an **audit log** of administrative decisions — approving a plugin's relay hooks, switching auto-approve, hosting and removing a hosting, installing, updating and uninstalling a plugin — and of what plugins' [lifecycle hooks](lifecycle-hooks.md) report through the `audit` effect. **Notifications** are messages for the relay's administrators: a hook's `notify-admins` effect, an update waiting for approval, a rule pack updated with Lamaste. Both live in `state.db` and hold metadata only — never a request or response body or a secret.

All endpoints are admin only.

## `GET /api/audit`

Newest first. Query: `plugin`, `action` (exact, or a prefix ending in `.` such as `hooks.`), `before` (an entry id, to page back), `limit` (1–200, default 50).

```json
{
  "entries": [
    {
      "id": 42,
      "at": "2026-10-15T12:00:00.000Z",
      "actor": "admin",
      "action": "hooks.approved",
      "plugin": "fx",
      "details": { "digest": "…", "version": "1.0.0", "for": "installed", "certSerial": "0A1B" }
    }
  ]
}
```

| Actor            | Who                                                          |
| ---------------- | ------------------------------------------------------------ |
| `admin`          | an administrator certificate (`certSerial` tells two apart)  |
| `agent:<label>`  | an agent certificate                                         |
| `plugin:<route>` | a plugin's hook, through the `audit` effect (`hook.<event>`) |
| `auto-approve`   | a plugin's auto-approve                                      |
| `lamaste`        | the panel itself                                             |

Actions written by Lamaste: `plugin.installed`, `plugin.uninstalled`, `plugin.hosted`, `plugin.unhosted`, `plugin.updated`, `plugin.update.reverted`, `plugin.update.awaiting-approval`, `plugin.update.discarded`, `hooks.approved`, `hooks.auto-approve.enabled|disabled`, `hooks.rules-updated`, `hooks.effects-dropped`. Details are capped at 4 KiB (strings at 300 characters, three levels deep). Entries are kept 180 days, at most 50 000.

## `GET /api/notifications`

Query: `unread=true`, `before`, `limit`. Answers `{ notifications: [{ id, at, source, level, message, read, readAt }], unread }`. `level` is `info`, `warning` or `critical`; `source` is `lamaste` or `plugin:<route>`. Messages are one line of plain text (500 characters) — the panel renders them as text. Kept 30 days, at most 1 000.

## `POST /api/notifications/read`

`{ "ids": [1, 2] }` or `{ "all": true }` → `{ ok, changed }`. Read state is shared by all administrators.

## Panel and CLI

The panel's **Audit** page shows the notifications and the log with plugin and action filters. `lamaste-server audit [--plugin <name>] [--action <action|prefix.>] [--limit <n>]` prints the log.
