// Panel notifications — messages for the relay's administrators: the
// `notify-admins` effect of plugins' lifecycle hooks (rate-limited by the
// effects executor) and Lamaste's own events (an approval waiting, a rule
// pack updated). Stored in state.db; read state is shared because the panel
// has one administrator identity. Plain text only — the panel renders it as
// text, never as HTML.

import { getStateDb } from './state-db.js';

export const NOTIFICATION_LEVELS = ['info', 'warning', 'critical'];
export const NOTIFICATION_MESSAGE_MAX = 500;
export const NOTIFICATIONS_MAX_ROWS = 1000;
export const NOTIFICATIONS_RETENTION_DAYS = 30;

const SOURCE_RE = /^[A-Za-z0-9:._-]{1,120}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

function cleanMessage(message) {
  // Control characters out (a message is one line of text), length capped.
  const text = String(message).replace(CONTROL_CHARS, ' ').trim();
  return text.length > NOTIFICATION_MESSAGE_MAX
    ? `${text.slice(0, NOTIFICATION_MESSAGE_MAX - 1)}…`
    : text;
}

/**
 * @param {{ source: string, level?: 'info'|'warning'|'critical', message: string }} n
 *   `source` — `plugin:<route>` or `lamaste`.
 */
export async function notifyAdmins({ source, level = 'info', message }) {
  if (!SOURCE_RE.test(source)) throw new Error('Invalid notification source');
  if (!NOTIFICATION_LEVELS.includes(level)) throw new Error('Invalid notification level');
  const text = cleanMessage(message);
  if (text.length === 0) throw new Error('Empty notification');
  const db = await getStateDb();
  const at = new Date().toISOString();
  const result = db
    .prepare('INSERT INTO notifications (at, source, level, message) VALUES (?, ?, ?, ?)')
    .run(at, source, level, text);
  const cutoff = new Date(Date.now() - NOTIFICATIONS_RETENTION_DAYS * 86_400_000).toISOString();
  db.prepare('DELETE FROM notifications WHERE at < ?').run(cutoff);
  db.prepare(
    'DELETE FROM notifications WHERE id <= (SELECT id FROM notifications ORDER BY id DESC LIMIT 1 OFFSET ?)',
  ).run(NOTIFICATIONS_MAX_ROWS);
  return { id: Number(result.lastInsertRowid), at };
}

export async function notifyAdminsBestEffort(notification, logger) {
  try {
    return await notifyAdmins(notification);
  } catch (err) {
    logger?.error?.({ err: err.message }, 'Failed to store a notification');
    return null;
  }
}

function rowToNotification(row) {
  return {
    id: row.id,
    at: row.at,
    source: row.source,
    level: row.level,
    message: row.message,
    read: row.read_at !== null,
    readAt: row.read_at,
  };
}

/** Newest first, with the unread count. */
export async function listNotifications({ unreadOnly = false, before, limit = 50 } = {}) {
  const db = await getStateDb();
  const where = [];
  const args = [];
  if (unreadOnly) where.push('read_at IS NULL');
  if (before) {
    where.push('id < ?');
    args.push(before);
  }
  args.push(Math.min(Math.max(1, limit), 200));
  const rows = db
    .prepare(
      `SELECT id, at, source, level, message, read_at FROM notifications${
        where.length ? ` WHERE ${where.join(' AND ')}` : ''
      } ORDER BY id DESC LIMIT ?`,
    )
    .all(...args);
  const { unread } = db
    .prepare('SELECT COUNT(*) AS unread FROM notifications WHERE read_at IS NULL')
    .get();
  return { notifications: rows.map(rowToNotification), unread: Number(unread) };
}

/** Mark the given ids — or every unread notification — read. Returns how many changed. */
export async function markNotificationsRead({ ids, all = false }) {
  const db = await getStateDb();
  const at = new Date().toISOString();
  if (all) {
    return Number(
      db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(at).changes,
    );
  }
  let changed = 0;
  const stmt = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL');
  for (const id of ids ?? []) changed += Number(stmt.run(at, id).changes);
  return changed;
}
