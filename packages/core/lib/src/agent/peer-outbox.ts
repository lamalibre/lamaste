/**
 * The provider's event outbox (design: slice 8, *Events*): events written in
 * the same transaction as the change they describe, read by the relay with
 * `POST /admin/peers/events/pull` (`peer-events.ts` for the wire).
 *
 * - **Writes join the application's transaction.** {@link PeerOutbox.publish}
 *   is synchronous on the application's own connection: inside its
 *   `BEGIN … COMMIT` the event exists exactly when the change does — a
 *   rollback takes both.
 * - **Reads see only what committed.** Pulls read on a connection of the
 *   outbox's own (read-only, WAL): an application that holds a transaction
 *   across an `await` cannot leak an uncommitted event, whose `seq` a
 *   rollback would later hand to another event. The database is switched
 *   to WAL for that (`PRAGMA journal_mode=WAL`, a persistent setting).
 * - **`to` never passes an event a pull did not see.** A pull reads the head
 *   first, then the events of its scope and types in `(after, head]`: what
 *   committed after the head was read is left for the next pull. SQLite has
 *   one writer at a time, so no event can commit later with a smaller `seq`
 *   than one already committed.
 * - **Waiting.** A pull may wait (≤ `PEER_EVENTS_WAIT_MAX_MS`) for an event
 *   of its scope: it re-reads every 250 ms, and at once after a `publish`
 *   (`node:sqlite` has no commit hook).
 * - **Retention** by age (`retentionDays`, default 7); the newest event is
 *   never pruned, and `horizon` records the highest `seq` ever pruned, so
 *   the relay can tell a cursor that may have missed events.
 *
 * Only the scopes and types the plugin's manifest provides may be published
 * (its `peers` block), `data` is JSON of at most `PEER_EVENT_DATA_MAX_BYTES`
 * — events are thin: ids and what changed; a consumer fetches more with a
 * call.
 */

import crypto from 'node:crypto';

import { CALLER_ASSERTION_HEADER } from '../caller-assertion.js';
import type { PeerEvent, PeerEventsPullAnswer, PeerEventsPullRequest } from '../peer-events.js';
import { parsePeerEventsPullRequest } from '../peer-events.js';
import {
  AGENT_HALF_PEERS_EVENTS_PULL_PATH,
  PEER_EVENTS_PULL_MAX_BYTES,
  PEER_EVENTS_WAIT_MAX_MS,
  PEER_EVENT_DATA_MAX_BYTES,
  PEER_OUTBOX_RETENTION_DEFAULT_DAYS,
  PeersBlockSchema,
} from '../peers.js';
import type { PeersBlockInput } from '../peers.js';
import { BODY_NOT_AS_RECEIVED, adminAnswer, rawBodyOf } from './admin-handlers.js';
import type { AgentHookRequest, AgentHookResponse } from './admin-handlers.js';
import type { CallerAssertionVerifier } from './app-plugins.js';

/** A value a statement binds. */
export type PeerSqlValue = string | number | bigint | null;

/** A prepared statement, as `node:sqlite`'s `StatementSync` offers it. */
export interface PeerSqlStatement {
  run(...params: PeerSqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: PeerSqlValue[]): unknown;
  all(...params: PeerSqlValue[]): unknown[];
}

/** A database connection: `node:sqlite`'s `DatabaseSync`, or anything alike. */
export interface PeerSqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): PeerSqlStatement;
  close?(): void;
}

export interface PeerOutboxOptions {
  /** The application's connection: `publish` runs on it, inside its transactions. */
  readonly db: PeerSqlDatabase;
  /**
   * A read-only connection to the same database file, for pulls. Without
   * it, `dbPath` is opened read-only with `node:sqlite`.
   */
  readonly reader?: PeerSqlDatabase | undefined;
  /** The database file, for the reader the outbox opens itself. */
  readonly dbPath?: string | undefined;
  /** The plugin's manifest `peers` block: the scopes and events it provides. */
  readonly peers: PeersBlockInput;
  /** Days an event is kept (default `PEER_OUTBOX_RETENTION_DEFAULT_DAYS`). */
  readonly retentionDays?: number | undefined;
  /** The clock (tests). */
  readonly now?: (() => number) | undefined;
}

/** What {@link PeerOutbox.publish} takes. */
export interface PeerEventInput {
  readonly scope: string;
  readonly type: string;
  /** What the event is about — an id, at most 200 characters. */
  readonly key?: string | null | undefined;
  /** JSON-serializable, at most `PEER_EVENT_DATA_MAX_BYTES` serialized. */
  readonly data?: unknown;
}

/** The stream's position: its id, the newest committed `seq`, the highest pruned one. */
export interface PeerOutboxState {
  readonly streamId: string;
  readonly head: number;
  readonly horizon: number;
}

export interface PeerOutbox {
  /**
   * Write an event on the application's connection — call it inside the
   * transaction of the change it describes. Returns its `seq`. Throws for a
   * scope or type the manifest does not provide, a key over 200 characters
   * or data over the size limit.
   */
  publish(event: PeerEventInput): number;
  /** The stream's position, as committed. */
  state(): PeerOutboxState;
  /** Answer a pull (waiting up to `request.waitMs` for an event of its scope). */
  pull(request: PeerEventsPullRequest): Promise<PeerEventsPullAnswer>;
  /** Delete events past retention (never the newest); returns how many. */
  prune(): number;
  /** Stop the pruning timer and close a reader the outbox opened. */
  close(): void;
}

const TABLES = `
CREATE TABLE IF NOT EXISTS lamaste_peer_outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  type TEXT NOT NULL,
  key TEXT,
  data TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lamaste_peer_outbox_scope ON lamaste_peer_outbox (scope, seq);
CREATE TABLE IF NOT EXISTS lamaste_peer_stream (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  stream_id TEXT NOT NULL,
  horizon INTEGER NOT NULL DEFAULT 0
);
`;

const KEY_MAX_LENGTH = 200;
const WAIT_TICK_MS = 250;
const PRUNE_INTERVAL_MS = 60 * 60_000;

function toNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  return typeof value === 'number' ? value : 0;
}

interface OutboxRow {
  seq: unknown;
  scope: unknown;
  type: unknown;
  key: unknown;
  data: unknown;
  at: unknown;
}

/** Open a read-only `node:sqlite` connection to `path`. */
async function openReader(path: string): Promise<PeerSqlDatabase> {
  const sqlite = (await import('node:sqlite')) as unknown as {
    DatabaseSync: new (path: string, opts: { readOnly: boolean }) => PeerSqlDatabase;
  };
  return new sqlite.DatabaseSync(path, { readOnly: true });
}

/**
 * Create the outbox: its tables on the application's connection, the stream
 * id when there is none, WAL, the reader, and an hourly prune.
 */
export async function createPeerOutbox(opts: PeerOutboxOptions): Promise<PeerOutbox> {
  const block = PeersBlockSchema.parse(opts.peers);
  const declared = new Map<string, Set<string>>();
  for (const [scope, entry] of Object.entries(block.provides)) {
    declared.set(scope, new Set(entry.events));
  }
  const retentionMs =
    Math.max(1, opts.retentionDays ?? PEER_OUTBOX_RETENTION_DEFAULT_DAYS) * 24 * 60 * 60_000;
  const now = opts.now ?? Date.now;
  const db = opts.db;

  db.exec('PRAGMA journal_mode=WAL');
  db.exec(TABLES);
  db.prepare(
    'INSERT OR IGNORE INTO lamaste_peer_stream (id, stream_id, horizon) VALUES (1, ?, 0)',
  ).run(crypto.randomUUID());

  let ownReader = false;
  let reader = opts.reader;
  if (!reader) {
    if (!opts.dbPath) throw new Error('createPeerOutbox needs a reader or a dbPath');
    reader = await openReader(opts.dbPath);
    ownReader = true;
  }
  const r: PeerSqlDatabase = reader;

  const insert = db.prepare(
    'INSERT INTO lamaste_peer_outbox (scope, type, key, data, at) VALUES (?, ?, ?, ?, ?)',
  );
  const readStream = r.prepare('SELECT stream_id, horizon FROM lamaste_peer_stream WHERE id = 1');
  const readHead = r.prepare('SELECT COALESCE(MAX(seq), 0) AS head FROM lamaste_peer_outbox');

  let wake: (() => void)[] = [];

  function state(): PeerOutboxState {
    const head = toNumber((readHead.get() as { head: unknown } | undefined)?.head);
    const row = readStream.get() as { stream_id: unknown; horizon: unknown } | undefined;
    if (!row || typeof row.stream_id !== 'string') {
      throw new Error('The peer outbox has no stream');
    }
    return { streamId: row.stream_id, head, horizon: toNumber(row.horizon) };
  }

  function readOnce(request: PeerEventsPullRequest): PeerEventsPullAnswer {
    // The head first: nothing committed after it is read or skipped.
    const position = state();
    if (request.max === 0 || request.after >= position.head) {
      return { ...position, to: Math.max(request.after, 0), events: [] };
    }
    const placeholders = request.types.map(() => '?').join(', ');
    const rows = r
      .prepare(
        `SELECT seq, scope, type, key, data, at FROM lamaste_peer_outbox
         WHERE scope = ? AND seq > ? AND seq <= ? AND type IN (${placeholders})
         ORDER BY seq LIMIT ?`,
      )
      .all(
        request.scope,
        request.after,
        position.head,
        ...request.types,
        request.max,
      ) as OutboxRow[];
    const events: PeerEvent[] = [];
    let bytes = 0;
    for (const row of rows) {
      const data = typeof row.data === 'string' ? row.data : 'null';
      bytes += data.length + 256;
      if (events.length > 0 && bytes > PEER_EVENTS_PULL_MAX_BYTES) break;
      events.push({
        seq: toNumber(row.seq),
        scope: String(row.scope),
        type: String(row.type),
        key: typeof row.key === 'string' ? row.key : null,
        data: JSON.parse(data) as unknown,
        at: String(row.at),
      });
    }
    const full = events.length < rows.length || rows.length === request.max;
    const last = events[events.length - 1];
    const to = full && last ? last.seq : position.head;
    return { ...position, to, events };
  }

  const pruneTimer = setInterval(() => {
    try {
      outbox.prune();
    } catch {
      // The application holds a transaction on its connection: next time.
    }
  }, PRUNE_INTERVAL_MS);
  pruneTimer.unref();

  const outbox: PeerOutbox = {
    publish(event) {
      const types = declared.get(event.scope);
      if (!types) throw new Error(`The plugin provides no scope "${event.scope}"`);
      if (!types.has(event.type)) {
        throw new Error(`The scope "${event.scope}" declares no event "${event.type}"`);
      }
      const key = event.key ?? null;
      if (key !== null && (typeof key !== 'string' || key.length > KEY_MAX_LENGTH)) {
        throw new Error(`An event key is a string of at most ${KEY_MAX_LENGTH} characters`);
      }
      const data = JSON.stringify(event.data ?? null);
      if (Buffer.byteLength(data, 'utf-8') > PEER_EVENT_DATA_MAX_BYTES) {
        throw new Error(`Event data is at most ${PEER_EVENT_DATA_MAX_BYTES} bytes of JSON`);
      }
      const result = insert.run(event.scope, event.type, key, data, new Date(now()).toISOString());
      // Waiting pulls look again soon: the event is visible to them once the
      // application commits.
      const waiting = wake;
      wake = [];
      for (const fn of waiting) setImmediate(fn);
      return toNumber(result.lastInsertRowid);
    },

    state,

    async pull(request) {
      const deadline = now() + Math.min(request.waitMs, PEER_EVENTS_WAIT_MAX_MS);
      for (;;) {
        const answer = readOnce(request);
        if (answer.events.length > 0 || request.max === 0 || now() >= deadline) return answer;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, Math.min(WAIT_TICK_MS, Math.max(0, deadline - now())));
          function done(): void {
            clearTimeout(timer);
            wake = wake.filter((fn) => fn !== done);
            resolve();
          }
          wake.push(done);
        });
      }
    },

    prune() {
      const cutoff = new Date(now() - retentionMs).toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        const newest = toNumber(
          (
            db.prepare('SELECT COALESCE(MAX(seq), 0) AS head FROM lamaste_peer_outbox').get() as {
              head: unknown;
            }
          ).head,
        );
        const pruned = toNumber(
          (
            db
              .prepare(
                'SELECT COALESCE(MAX(seq), 0) AS seq FROM lamaste_peer_outbox WHERE at < ? AND seq < ?',
              )
              .get(cutoff, newest) as { seq: unknown }
          ).seq,
        );
        let deleted = 0;
        if (pruned > 0) {
          deleted = toNumber(
            db.prepare('DELETE FROM lamaste_peer_outbox WHERE seq <= ?').run(pruned).changes,
          );
          db.prepare('UPDATE lamaste_peer_stream SET horizon = MAX(horizon, ?) WHERE id = 1').run(
            pruned,
          );
        }
        db.exec('COMMIT');
        return deleted;
      } catch (err: unknown) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Already rolled back.
        }
        throw err;
      }
    },

    close() {
      clearInterval(pruneTimer);
      if (ownReader) r.close?.();
    },
  };

  try {
    outbox.prune();
  } catch {
    // The application is mid-transaction; the timer prunes later.
  }
  return outbox;
}

/**
 * Answer `POST /admin/peers/events/pull` in a provider's agent half: the
 * relay's pull, Lamaste's own call (caller `lamaste`, the body hash
 * required), the answer signed over its body. Framework-agnostic — pass the
 * request, send `status`, `headers` and `bodyText`. 404 for another path,
 * 405 for another method, 400 for a body passed parsed — unsigned; 401 for
 * an assertion that does not verify; then signed: 403 for any caller but
 * Lamaste, 400 for a malformed pull, 200 with the answer.
 */
export function createPeerOutboxHandler(opts: {
  readonly verifier: CallerAssertionVerifier;
  readonly outbox: PeerOutbox;
}): { handle(request: AgentHookRequest): Promise<AgentHookResponse> } {
  return {
    async handle(request) {
      const pathOnly = request.url.split('?')[0] ?? '';
      if (pathOnly !== AGENT_HALF_PEERS_EVENTS_PULL_PATH) {
        return adminAnswer(404, { error: 'Not found' });
      }
      const method = request.method.toUpperCase();
      if (method !== 'POST') return adminAnswer(405, { error: 'Events are pulled with POST' });
      const raw = rawBodyOf(request.body);
      if (!raw) return adminAnswer(400, { error: BODY_NOT_AS_RECEIVED });
      if (raw.length > 16 * 1024) return adminAnswer(413, { error: 'The pull is too large' });
      if (request.headers[CALLER_ASSERTION_HEADER] === undefined) {
        return adminAnswer(401, { error: 'malformed' });
      }
      const verified = await opts.verifier.verify(request.headers, method, request.url, {
        body: raw,
        requireBodyHash: true,
      });
      if (!verified.ok) return adminAnswer(401, { error: verified.reason });
      if (verified.payload.caller.type !== 'lamaste') {
        return adminAnswer(403, { error: 'Only Lamaste pulls events' }, verified);
      }
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw.toString('utf-8'));
      } catch {
        parsed = null;
      }
      const pull = parsePeerEventsPullRequest(parsed);
      if (!pull) return adminAnswer(400, { error: 'Malformed events pull' }, verified);
      const answer = await opts.outbox.pull(pull);
      return adminAnswer(200, { ...answer, events: [...answer.events] }, verified);
    },
  };
}
