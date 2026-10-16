/**
 * Plugin settings in the agent half — the system of record for what an
 * admin configured (`settings` in the manifest, `plugin-settings.ts` in the
 * root for the contract). Lamaste code, so that no plugin reimplements how
 * a secret is stored.
 *
 * Two files in the agent half's data directory, which its unit makes the
 * only writable one and which stays with the retained data of an unhost
 * (a purge deletes it):
 *
 * - `settings.json` — `{ v: 1, schemaVersion, revision, values }`, each
 *   value recorded with the type of the field it was stored for;
 * - `secrets.json` — `{ v: 1, secrets }`, each secret with when it was set;
 *   written only when a secret changes.
 *
 * Both are 0600 and written atomically (exclusive temp file in the same
 * directory, fsync, rename, fsync of the directory); a symbolic link where
 * either belongs is refused on read and on write. A missing file is empty;
 * a malformed one is an error that never repeats its contents.
 *
 * On load the stored values are reconciled with the agent half's own
 * schema — the bundled copy of its manifest's `settings` block: a key the
 * schema no longer knows is dropped, so is a value recorded for another
 * type than the field has now (retyped — dropped, never converted: a secret
 * that became a string never lands in `settings.json`), and a value that no
 * longer passes the field's checks. A file is rewritten when something was
 * dropped from it, and `settings.json` also when it records another
 * `schemaVersion` than the agent half's; the revision stays.
 *
 * {@link createSettingsHandler} answers `/admin/settings` for Lamaste alone
 * (caller `lamaste`, through the tunnel): the relay's panel validates an
 * admin's change and calls `PUT /admin/settings` with each secret sealed to
 * that one request (`settings-secrets.ts`), under an assertion that signs
 * the exact body; the handler opens the secrets with the verified request
 * and hands the store plaintext, so a secret travels from the admin's
 * request to this file and is readable nowhere in between. No answer of the
 * handler ever contains a secret's value, and every answer to a verified
 * request is authenticated (`admin-handlers.ts`).
 */

import { constants as fsConstants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

import { PromiseChainMutex, atomicWriteJSON } from '../file-helpers.js';
import {
  AGENT_HALF_SETTINGS_MAX_BYTES,
  AGENT_HALF_SETTINGS_PATH,
  AGENT_HALF_SETTINGS_RELOAD_PATH,
  SETTINGS_SECRET_UNDECRYPTABLE,
  SettingsBlockSchema,
  checkSettingsValue,
  effectiveSettingsValues,
  parseAgentHalfSettingsUpdate,
  settingsStatus,
  validateSettingsUpdate,
} from '../plugin-settings.js';
import type {
  AgentHalfSettingsState,
  SettingsBlock,
  SettingsField,
  SettingsValue,
  SettingsValues,
} from '../plugin-settings.js';
import { ManifestValidationError } from '../schemas.js';
import { BODY_NOT_AS_RECEIVED, adminAnswer, rawBodyOf } from './admin-handlers.js';
import type { AgentHookRequest, AgentHookResponse } from './admin-handlers.js';
import type { CallerAssertionVerifier } from './app-plugins.js';

const SETTINGS_FILE = 'settings.json';
const SECRETS_FILE = 'secrets.json';
const FILE_VERSION = 1;

/**
 * Larger than any file the store writes (50 fields of at most 4096
 * characters, JSON-escaped), small enough that a file grown by mistake is
 * refused rather than read into memory.
 */
const SETTINGS_FILE_MAX_BYTES = 4 * 1024 * 1024;

/** Refuse a link at open time too, so a link swapped in after the lstat is not followed. */
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;

/**
 * The agent half's settings schema, from its bundled manifest (or any
 * object with a `settings` block). Throws {@link ManifestValidationError}
 * when the block is missing or invalid — including a string default that
 * does not match its field's `pattern`, which only the agent half tests:
 * the relay's schema never runs a manifest's regular expression.
 */
export function settingsFromManifest(manifest: unknown): SettingsBlock {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new ManifestValidationError([{ path: '', message: 'The manifest is not an object' }]);
  }
  const raw = (manifest as Record<string, unknown>)['settings'];
  if (raw === undefined) {
    throw new ManifestValidationError([
      { path: 'settings', message: 'The manifest has no settings block' },
    ]);
  }
  const parsed = SettingsBlockSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ManifestValidationError(
      parsed.error.issues.map((i) => ({
        path: ['settings', ...i.path].join('.'),
        message: i.message,
      })),
    );
  }
  const issues: { path: string; message: string }[] = [];
  parsed.data.fields.forEach((field, idx) => {
    if (field.type !== 'string' || field.pattern === undefined || field.default === undefined) {
      return;
    }
    const checked = checkSettingsValue(field, field.default, { checkPattern: true });
    if (!checked.ok) {
      issues.push({
        path: `settings.fields.${idx}.default`,
        message: `The default is not a valid value: ${checked.message}`,
      });
    }
  });
  if (issues.length > 0) throw new ManifestValidationError(issues);
  return parsed.data;
}

/**
 * An update as the store applies it: the wire form
 * (`AgentHalfSettingsUpdate`) with its secrets opened — the handler opens
 * them with the verified request; nothing else ever holds them in clear.
 */
export interface SettingsStoreUpdate {
  readonly schemaVersion: number;
  readonly baseRevision: number;
  /** `null`: back to the default, or unset. */
  readonly values: Record<string, SettingsValue | null>;
  /** Plaintext; `null`: clear. */
  readonly secrets: Record<string, string | null>;
}

export type SettingsUpdateOutcome =
  | { readonly ok: true; readonly state: AgentHalfSettingsState }
  | { readonly ok: false; readonly status: 409 | 422; readonly body: Record<string, unknown> };

export interface SettingsStore {
  /** Read both files and reconcile them with the schema. Creates nothing. */
  load(): Promise<void>;
  /** What `GET /admin/settings` answers: stored values, when secrets were set — no secret. */
  state(): AgentHalfSettingsState;
  /** The values the plugin runs with: defaults overlaid by the stored values. */
  values(): SettingsValues;
  /** A secret's value, for the agent half's own use; undefined when not set. */
  secret(key: string): string | undefined;
  configured(): boolean;
  /**
   * Apply an update from Lamaste: refused with 409 across schema versions
   * (`schema_mismatch`) or on a stale revision (`revision_mismatch`), with
   * 422 when a value does not suit its field. Serialized.
   */
  update(u: SettingsStoreUpdate): Promise<SettingsUpdateOutcome>;
  /** Re-read the files — after a restore put older ones in place. */
  reload(): Promise<AgentHalfSettingsState>;
  /**
   * Called after every successful update and every reload with the new
   * state. Returns the unsubscribe function. A listener that throws is
   * ignored: it does not fail the update, which is already stored.
   */
  onChange(cb: (state: AgentHalfSettingsState) => void): () => void;
}

export interface SettingsStoreOptions {
  /** The agent half's data directory; it must exist. */
  readonly dataDir: string;
  /** The agent half's own schema ({@link settingsFromManifest}). */
  readonly settings: SettingsBlock;
}

/** A value as `settings.json` keeps it: with the type of the field it was stored for. */
interface StoredValue {
  readonly type: string;
  readonly value: SettingsValue;
}

interface StoredSecret {
  readonly value: string;
  readonly setAt: string;
}

interface SettingsFile {
  /** The schema version the file was written for; null when there is no file. */
  readonly schemaVersion: number | null;
  readonly revision: number;
  readonly values: ReadonlyMap<string, StoredValue>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrno(err: unknown, code: string): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === code;
}

/**
 * Read one of the store's files: undefined when it does not exist; a link,
 * a non-file, an oversized file or one that is not JSON is an error naming
 * the file, never its contents.
 */
async function readStoreFile(filePath: string): Promise<unknown> {
  let info;
  try {
    info = await lstat(filePath);
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) return undefined;
    throw err;
  }
  if (info.isSymbolicLink()) throw new Error(`Refusing to read ${filePath}: it is a symbolic link`);
  if (!info.isFile()) throw new Error(`Refusing to read ${filePath}: it is not a regular file`);
  if (info.size > SETTINGS_FILE_MAX_BYTES) throw new Error(`${filePath} is too large`);

  let text: string;
  try {
    const handle = await open(filePath, fsConstants.O_RDONLY | O_NOFOLLOW);
    try {
      text = await handle.readFile('utf-8');
    } finally {
      await handle.close();
    }
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) return undefined;
    if (isErrno(err, 'ELOOP')) {
      throw new Error(`Refusing to read ${filePath}: it is a symbolic link`);
    }
    throw err;
  }
  if (Buffer.byteLength(text, 'utf-8') > SETTINGS_FILE_MAX_BYTES) {
    throw new Error(`${filePath} is too large`);
  }
  try {
    return JSON.parse(text);
  } catch {
    // JSON.parse's own message quotes the text; this one must not.
    throw new Error(`${filePath} is not valid JSON`);
  }
}

function malformed(filePath: string): Error {
  return new Error(`${filePath} is malformed`);
}

function parseSettingsFile(raw: unknown, filePath: string): SettingsFile {
  if (raw === undefined) return { schemaVersion: null, revision: 0, values: new Map() };
  if (!isRecord(raw) || raw['v'] !== FILE_VERSION) throw malformed(filePath);
  const revision = raw['revision'];
  const schemaVersion = raw['schemaVersion'];
  const values = raw['values'];
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    throw malformed(filePath);
  }
  if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion)) {
    throw malformed(filePath);
  }
  if (!isRecord(values)) throw malformed(filePath);
  const out = new Map<string, StoredValue>();
  for (const [key, entry] of Object.entries(values)) {
    if (!isRecord(entry) || typeof entry['type'] !== 'string') throw malformed(filePath);
    const value = entry['value'];
    if (
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      (typeof value !== 'number' || !Number.isFinite(value))
    ) {
      throw malformed(filePath);
    }
    out.set(key, { type: entry['type'], value });
  }
  return { schemaVersion, revision, values: out };
}

function parseSecretsFile(raw: unknown, filePath: string): Map<string, StoredSecret> {
  const out = new Map<string, StoredSecret>();
  if (raw === undefined) return out;
  if (!isRecord(raw) || raw['v'] !== FILE_VERSION || !isRecord(raw['secrets'])) {
    throw malformed(filePath);
  }
  for (const [key, entry] of Object.entries(raw['secrets'])) {
    if (!isRecord(entry)) throw malformed(filePath);
    const value = entry['value'];
    const setAt = entry['setAt'];
    if (typeof value !== 'string' || typeof setAt !== 'string') throw malformed(filePath);
    out.set(key, { value, setAt });
  }
  return out;
}

/**
 * The agent half's settings store. One per process: updates are
 * serialized in memory, and the files are written by nothing else.
 */
export function createSettingsStore(opts: SettingsStoreOptions): SettingsStore {
  const block = opts.settings;
  const settingsPath = path.join(opts.dataDir, SETTINGS_FILE);
  const secretsPath = path.join(opts.dataDir, SECRETS_FILE);
  const fields = new Map<string, SettingsField>(block.fields.map((f) => [f.key, f]));
  const mutex = new PromiseChainMutex();
  const listeners = new Set<(state: AgentHalfSettingsState) => void>();

  let loaded = false;
  let revision = 0;
  let values = new Map<string, StoredValue>();
  let secrets = new Map<string, StoredSecret>();

  function ensureLoaded(): void {
    if (!loaded) throw new Error('The settings store is used before load()');
  }

  /** The stored non-secret values as a plain object, in schema order. */
  function storedValues(map: ReadonlyMap<string, StoredValue>): SettingsValues {
    const out: [string, SettingsValue][] = [];
    for (const field of block.fields) {
      const stored = map.get(field.key);
      if (stored) out.push([field.key, stored.value]);
    }
    return Object.fromEntries(out);
  }

  function currentState(): AgentHalfSettingsState {
    const stored = storedValues(values);
    const setAt: [string, { readonly setAt: string }][] = [];
    for (const field of block.fields) {
      const secret = secrets.get(field.key);
      if (secret) setAt.push([field.key, { setAt: secret.setAt }]);
    }
    const status = settingsStatus(block, { values: stored, secretsSet: [...secrets.keys()] });
    return {
      schemaVersion: block.schemaVersion,
      revision,
      values: stored,
      secrets: Object.fromEntries(setAt),
      configured: status.configured,
      missing: status.missing,
    };
  }

  function emit(): void {
    const state = currentState();
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        // The change is stored; a listener's failure is the listener's own.
      }
    }
  }

  async function writeSettings(
    nextRevision: number,
    map: ReadonlyMap<string, StoredValue>,
  ): Promise<void> {
    const out: Record<string, StoredValue> = {};
    for (const field of block.fields) {
      const stored = map.get(field.key);
      if (stored) out[field.key] = { type: stored.type, value: stored.value };
    }
    await atomicWriteJSON(
      settingsPath,
      { v: FILE_VERSION, schemaVersion: block.schemaVersion, revision: nextRevision, values: out },
      { mode: 0o600, refuseSymlink: true },
    );
  }

  async function writeSecrets(map: ReadonlyMap<string, StoredSecret>): Promise<void> {
    const out: Record<string, StoredSecret> = {};
    for (const field of block.fields) {
      const stored = map.get(field.key);
      if (stored) out[field.key] = { value: stored.value, setAt: stored.setAt };
    }
    await atomicWriteJSON(
      secretsPath,
      { v: FILE_VERSION, secrets: out },
      { mode: 0o600, refuseSymlink: true },
    );
  }

  /**
   * Read, reconcile with the schema, persist what reconciling dropped — and
   * settings.json when it was written for another schema version, so it
   * names the schema its values were reconciled with — then adopt.
   */
  async function readAndReconcile(): Promise<void> {
    const settingsFile = parseSettingsFile(await readStoreFile(settingsPath), settingsPath);
    const secretsFile = parseSecretsFile(await readStoreFile(secretsPath), secretsPath);

    let droppedValue = false;
    const nextValues = new Map<string, StoredValue>();
    for (const [key, stored] of settingsFile.values) {
      const field = fields.get(key);
      // Unknown, a secret now, or retyped: dropped, never converted.
      if (!field || field.type === 'secret' || stored.type !== field.type) {
        droppedValue = true;
        continue;
      }
      const checked = checkSettingsValue(field, stored.value, { checkPattern: true });
      if (!checked.ok) {
        droppedValue = true;
        continue;
      }
      nextValues.set(key, { type: field.type, value: checked.value });
    }

    let droppedSecret = false;
    const nextSecrets = new Map<string, StoredSecret>();
    for (const [key, stored] of secretsFile) {
      const field = fields.get(key);
      // A secret whose field is no longer a secret is dropped — never moved into settings.json.
      if (!field || field.type !== 'secret') {
        droppedSecret = true;
        continue;
      }
      if (!checkSettingsValue(field, stored.value, { checkPattern: true }).ok) {
        droppedSecret = true;
        continue;
      }
      nextSecrets.set(key, stored);
    }

    // An update to another schema version that dropped no value (only a
    // secret, or nothing) still leaves settings.json recording the old one.
    const otherSchema =
      settingsFile.schemaVersion !== null && settingsFile.schemaVersion !== block.schemaVersion;
    if (droppedSecret) await writeSecrets(nextSecrets);
    if (droppedValue || otherSchema) await writeSettings(settingsFile.revision, nextValues);
    revision = settingsFile.revision;
    values = nextValues;
    secrets = nextSecrets;
    loaded = true;
  }

  return {
    load() {
      return mutex.run(readAndReconcile);
    },

    state() {
      ensureLoaded();
      return currentState();
    },

    values() {
      ensureLoaded();
      return effectiveSettingsValues(block, storedValues(values));
    },

    secret(key) {
      ensureLoaded();
      return fields.get(key)?.type === 'secret' ? secrets.get(key)?.value : undefined;
    },

    configured() {
      ensureLoaded();
      return currentState().configured;
    },

    update(u) {
      return mutex.run(async (): Promise<SettingsUpdateOutcome> => {
        ensureLoaded();
        if (u.schemaVersion !== block.schemaVersion) {
          return {
            ok: false,
            status: 409,
            body: {
              error: 'The settings schema of the agent half is a different version',
              code: 'schema_mismatch',
            },
          };
        }
        if (u.baseRevision !== revision) {
          return {
            ok: false,
            status: 409,
            body: {
              error: 'The settings changed since they were read',
              code: 'revision_mismatch',
              revision,
            },
          };
        }
        const checked = validateSettingsUpdate(
          block,
          { values: u.values, secrets: u.secrets },
          { checkPattern: true },
        );
        if (!checked.ok) {
          return {
            ok: false,
            status: 422,
            body: { error: 'Invalid settings', errors: checked.errors },
          };
        }

        const nextValues = new Map(values);
        for (const [key, value] of Object.entries(checked.values)) {
          const field = fields.get(key);
          if (!field) continue;
          if (value === null) nextValues.delete(key);
          else nextValues.set(key, { type: field.type, value });
        }
        const nextSecrets = new Map(secrets);
        let secretsChanged = false;
        const setAt = new Date().toISOString();
        for (const [key, value] of Object.entries(checked.secrets)) {
          if (value === null) {
            if (nextSecrets.delete(key)) secretsChanged = true;
          } else {
            nextSecrets.set(key, { value, setAt });
            secretsChanged = true;
          }
        }

        // secrets.json first: if settings.json then fails, memory still
        // matches the disk — the new secrets, the old values and revision.
        if (secretsChanged) {
          await writeSecrets(nextSecrets);
          secrets = nextSecrets;
        }
        try {
          await writeSettings(revision + 1, nextValues);
        } catch (err: unknown) {
          if (secretsChanged) emit();
          throw err;
        }
        values = nextValues;
        revision += 1;
        emit();
        return { ok: true, state: currentState() };
      });
    },

    reload() {
      return mutex.run(async () => {
        await readAndReconcile();
        emit();
        return currentState();
      });
    },

    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// The agent half's /admin/settings
// ---------------------------------------------------------------------------

export interface SettingsHandlerOptions {
  /** The agent half's verifier (`createCallerAssertionVerifier`). */
  readonly verifier: CallerAssertionVerifier;
  readonly store: SettingsStore;
}

/** `<METHOD> <path>` of each route the handler answers. */
const ROUTES: ReadonlySet<string> = new Set([
  `GET ${AGENT_HALF_SETTINGS_PATH}`,
  `PUT ${AGENT_HALF_SETTINGS_PATH}`,
  `POST ${AGENT_HALF_SETTINGS_RELOAD_PATH}`,
]);

/**
 * Answer `/admin/settings` in an agent half: `GET` the state, `PUT` an
 * update, `POST /admin/settings/reload` after a restore. Only Lamaste may
 * call it (a valid caller assertion naming `lamaste`; 401 otherwise, 403
 * for an admin or agent caller); 404 for any other path under
 * `/admin/settings`, 405 for a method a path does not take.
 *
 * A `PUT` must be passed its body as received (400 "The body must be passed
 * as received" for an object a framework parsed): its assertion signs the
 * exact bytes (`wrong_body`, 401, for any others), and each secret in it is
 * sealed to that request — opened here with the verified request, a value
 * that does not open answering 422 "Could not be decrypted" for its key.
 * 413 over {@link AGENT_HALF_SETTINGS_MAX_BYTES}, 400 for a body that is not
 * an update, then the store's 200 / 409 / 422.
 *
 * Framework-agnostic, like `createAgentHookHandler`: pass the request,
 * send `status`, `headers` and `bodyText` — every answer to a verified
 * request carries the responder header over exactly those bytes. No
 * response carries a secret's value — nor an error's own message, which
 * the store keeps free of values but which is not the handler's to
 * forward.
 */
export function createSettingsHandler(opts: SettingsHandlerOptions): {
  handle(request: AgentHookRequest): Promise<AgentHookResponse>;
} {
  return {
    async handle(request) {
      const pathOnly = request.url.split('?')[0] ?? '';
      if (pathOnly !== AGENT_HALF_SETTINGS_PATH && pathOnly !== AGENT_HALF_SETTINGS_RELOAD_PATH) {
        return adminAnswer(404, { error: 'Not found' });
      }
      const method = request.method.toUpperCase();
      if (!ROUTES.has(`${method} ${pathOnly}`)) {
        return adminAnswer(405, {
          error:
            pathOnly === AGENT_HALF_SETTINGS_PATH
              ? 'Settings are read with GET and changed with PUT'
              : 'A settings reload is POST',
        });
      }
      const raw = rawBodyOf(request.body);
      const isUpdate = method === 'PUT';
      if (isUpdate && !raw) return adminAnswer(400, { error: BODY_NOT_AS_RECEIVED });
      if (raw && raw.length > AGENT_HALF_SETTINGS_MAX_BYTES) {
        return adminAnswer(413, { error: 'The settings update is too large' });
      }
      const verified = await opts.verifier.verify(request.headers, method, request.url, {
        ...(raw ? { body: raw } : {}),
        requireBodyHash: isUpdate,
      });
      if (!verified.ok) return adminAnswer(401, { error: verified.reason });
      if (verified.payload.caller.type !== 'lamaste') {
        return adminAnswer(403, { error: 'Only Lamaste reads or changes settings' }, verified);
      }

      try {
        if (method === 'GET') return adminAnswer(200, { ...opts.store.state() }, verified);
        if (method === 'POST') {
          return adminAnswer(200, { ...(await opts.store.reload()) }, verified);
        }

        let parsed: unknown;
        try {
          // Safe: a PUT without a raw body was answered 400 above.
          parsed = JSON.parse((raw as Buffer).toString('utf-8'));
        } catch {
          return adminAnswer(400, { error: 'The settings update is not JSON' }, verified);
        }
        const update = parseAgentHalfSettingsUpdate(parsed);
        if (!update) return adminAnswer(400, { error: 'Malformed settings update' }, verified);

        const secrets: [string, string | null][] = [];
        const undecryptable: [string, string][] = [];
        for (const [key, sealed] of Object.entries(update.secrets)) {
          if (sealed === null) {
            secrets.push([key, null]);
            continue;
          }
          try {
            secrets.push([key, verified.decryptSettingsSecret(key, update.baseRevision, sealed)]);
          } catch {
            undecryptable.push([key, SETTINGS_SECRET_UNDECRYPTABLE]);
          }
        }
        if (undecryptable.length > 0) {
          return adminAnswer(
            422,
            { error: 'Invalid settings', errors: Object.fromEntries(undecryptable) },
            verified,
          );
        }
        const outcome = await opts.store.update({
          schemaVersion: update.schemaVersion,
          baseRevision: update.baseRevision,
          values: update.values,
          secrets: Object.fromEntries(secrets),
        });
        if (outcome.ok) return adminAnswer(200, { ...outcome.state }, verified);
        return adminAnswer(outcome.status, outcome.body, verified);
      } catch {
        return adminAnswer(500, { error: 'The settings store failed' }, verified);
      }
    },
  };
}
