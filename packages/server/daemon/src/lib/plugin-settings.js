/**
 * Plugin settings on the relay — what an administrator configures for an
 * agent-hosted plugin (the manifest's `settings` block; the contract and its
 * validation are core's `plugin-settings.ts`).
 *
 * The agent half is the system of record: it keeps the values in its own
 * data directory and answers `GET` / `PUT /admin/settings` for Lamaste
 * alone. The relay keeps a cache per plugin in state.db (`plugin_settings`)
 * — the non-secret values the agent half stored, which secrets are set and
 * when, whether the plugin still needs configuration — so the panel can show
 * them while the agent is offline. Never a secret's value: the table has no
 * column for one.
 *
 * A change is checked by the panel and stored by the agent half: the panel
 * validates it against the installed schema (type, required, length, range,
 * options — never `pattern`, which only the form and the agent half
 * evaluate, so a manifest's regular expression cannot stall the panel) and
 * sends it through the internal tunnel (`PUT /admin/settings`, caller
 * `lamaste`), answering with the agent half's verdict. A secret exists on
 * the relay only in the memory of that request: what the panel logs,
 * stores, audits and answers is built from key names and the agent half's
 * state, never from the request body, and no reference to it outlives the
 * request.
 *
 * The cache is refreshed after a hosting succeeds, after an update, when the
 * health monitor sees the plugin come up, on every live read and from the
 * answer to every change; it goes when the hosting is removed and when the
 * plugin is uninstalled. Reads and writes of one plugin's settings are
 * serialized, so a slow read cannot put back what a change replaced.
 */

import {
  AGENT_HALF_SETTINGS_MAX_BYTES,
  AGENT_HALF_SETTINGS_PATH,
  SETTINGS_KEY_RE,
  SETTINGS_MAX_FIELDS,
  callAgentHalf,
  effectiveSettingsValues,
  parseAgentHalfSettingsState,
  settingsStatus,
  validateSettingsUpdate,
} from '@lamalibre/lamaste';
import { pluginHostingPhase, signingSecretFor } from '@lamalibre/lamaste/server';
import { httpError } from './app-error.js';
import { agentLastSeenAt } from './agent-presence.js';
import { recordAuditBestEffort } from './audit.js';
import { findPlugin } from './plugins.js';
import { getPluginOperation, isPluginOperationRunning } from './plugin-operations.js';
import { getStateDb } from './state-db.js';

/** How long a read of the agent half's settings may take (the panel waits on it). */
export const SETTINGS_READ_TIMEOUT_MS = 5_000;

/** How long the agent half may take to store a change. */
export const SETTINGS_WRITE_TIMEOUT_MS = 15_000;

/** The longest message of the agent half's that is passed on. */
const AGENT_HALF_MESSAGE_MAX = 300;

const UPDATE_KEYS = new Set(['revision', 'values', 'secrets']);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * The settings block of a registry entry — its installed manifest's,
 * validated when the version was installed or staged — or null when the
 * plugin declares none.
 *
 * @param {{ settings?: unknown } | null | undefined} plugin
 * @returns {import('@lamalibre/lamaste').SettingsBlock | null}
 */
export function settingsBlockOf(plugin) {
  const block = plugin?.settings;
  if (!isRecord(block)) return null;
  if (!Number.isSafeInteger(block.schemaVersion) || !Array.isArray(block.fields)) return null;
  return block;
}

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SettingsCache
 * @property {number} schemaVersion the agent half's settings schema version
 * @property {number} revision the agent half's revision
 * @property {Record<string, string | number | boolean>} values stored non-secret values (no defaults)
 * @property {Record<string, string>} secretsSet secret key → when it was set
 * @property {boolean} configured
 * @property {string[]} missing
 * @property {string} syncedAt
 */

/** @returns {SettingsCache | null} */
function rowToCache(row) {
  if (!row) return null;
  const values = parseJson(row.values_json, {});
  const secretsSet = parseJson(row.secrets_set_json, {});
  const missing = parseJson(row.missing_json, []);
  return {
    schemaVersion: row.schema_version,
    revision: row.revision,
    values: isRecord(values) ? values : {},
    secretsSet: isRecord(secretsSet) ? secretsSet : {},
    configured: row.configured === 1,
    missing: Array.isArray(missing) ? missing.filter((key) => typeof key === 'string') : [],
    syncedAt: row.synced_at,
  };
}

/**
 * The cached settings of plugin `name`, or null when the relay never read
 * them (or the hosting they belonged to was removed).
 *
 * @param {string} name
 * @returns {Promise<SettingsCache | null>}
 */
export async function readSettingsCache(name) {
  const db = await getStateDb();
  return rowToCache(db.prepare('SELECT * FROM plugin_settings WHERE plugin = ?').get(name));
}

/** @returns {Promise<Map<string, SettingsCache>>} */
async function readAllSettingsCaches() {
  const db = await getStateDb();
  return new Map(
    db
      .prepare('SELECT * FROM plugin_settings')
      .all()
      .map((row) => [row.plugin, rowToCache(row)]),
  );
}

/** Drop the cached settings of plugin `name` (its hosting is gone). */
export async function deleteSettingsCache(name) {
  const db = await getStateDb();
  db.prepare('DELETE FROM plugin_settings WHERE plugin = ?').run(name);
}

/**
 * The stored non-secret values the installed schema knows and that still
 * suit their field (type, length, range, option) — the agent half's own
 * schema may differ from the relay's while an update is under way.
 */
function knownStoredValues(block, values) {
  const withoutDefaults = {
    schemaVersion: block.schemaVersion,
    fields: block.fields
      .filter((field) => field.type !== 'secret')
      .map((field) => ({ ...field, default: undefined })),
  };
  return effectiveSettingsValues(withoutDefaults, values);
}

/**
 * Cache the agent half's state of plugin `name`: its stored non-secret
 * values and set secrets for the keys the installed schema knows, and its
 * own `configured` / `missing`. The state never carries a secret's value
 * (`parseAgentHalfSettingsState` keeps `setAt` alone).
 *
 * @param {string} name
 * @param {import('@lamalibre/lamaste').SettingsBlock} block the installed schema
 * @param {import('@lamalibre/lamaste').AgentHalfSettingsState} state
 * @returns {Promise<SettingsCache>}
 */
async function writeSettingsCache(name, block, state) {
  const values = knownStoredValues(block, state.values);
  const secretsSet = Object.fromEntries(
    block.fields
      .filter((field) => field.type === 'secret' && Object.hasOwn(state.secrets, field.key))
      .map((field) => [field.key, state.secrets[field.key].setAt]),
  );
  const syncedAt = new Date().toISOString();
  const db = await getStateDb();
  db.prepare(
    `INSERT INTO plugin_settings
       (plugin, schema_version, revision, values_json, secrets_set_json, configured,
        missing_json, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(plugin) DO UPDATE SET
       schema_version = excluded.schema_version,
       revision = excluded.revision,
       values_json = excluded.values_json,
       secrets_set_json = excluded.secrets_set_json,
       configured = excluded.configured,
       missing_json = excluded.missing_json,
       synced_at = excluded.synced_at`,
  ).run(
    name,
    state.schemaVersion,
    state.revision,
    JSON.stringify(values),
    JSON.stringify(secretsSet),
    state.configured ? 1 : 0,
    JSON.stringify(state.missing),
    syncedAt,
  );
  return {
    schemaVersion: state.schemaVersion,
    revision: state.revision,
    values,
    secretsSet,
    configured: state.configured,
    missing: [...state.missing],
    syncedAt,
  };
}

// ---------------------------------------------------------------------------
// One plugin at a time
// ---------------------------------------------------------------------------

/** plugin name → the tail of its chain of settings reads and writes */
const chains = new Map();

/** Run `fn` after every settings read or write of plugin `name` before it. */
function serialized(name, fn) {
  const previous = chains.get(name) ?? Promise.resolve();
  const next = previous.then(fn);
  const tail = next.catch(() => undefined);
  chains.set(name, tail);
  void tail.finally(() => {
    if (chains.get(name) === tail) chains.delete(name);
  });
  return next;
}

// ---------------------------------------------------------------------------
// The hosting and the agent half
// ---------------------------------------------------------------------------

/** The hosting installed plugin `plugin` owns, or null (see `ownHosting`). */
async function ownHostingOf(plugin) {
  const { ownHosting } = await import('./plugin-hosting.js');
  return ownHosting(plugin);
}

/** Whether Lamaste calls the agent half of hosting `record`: active, and not known to be down. */
function isReachable(record) {
  return pluginHostingPhase(record) === 'active' && record.health?.state !== 'down';
}

/**
 * The hosting as a settings view shows it — where the agent half runs, the
 * health monitor's view of it, and when its agent last synced — or null
 * when the plugin is not hosted.
 */
async function hostingBlock(record) {
  if (!record) return null;
  return {
    agentLabel: record.agentLabel,
    phase: pluginHostingPhase(record),
    state: record.health?.state ?? 'unknown',
    reason: record.health?.reason ?? null,
    since: record.health?.since ?? null,
    agentLastSeenAt: await agentLastSeenAt(record.agentLabel),
  };
}

/** Why plugin `name`'s settings cannot be changed now (its hosting is not up). */
function offlineMessage(name, record) {
  if (!record) {
    return `Plugin "${name}" is not hosted on an agent — its settings are kept by its agent half`;
  }
  const phase = pluginHostingPhase(record);
  if (phase !== 'active') {
    return `Plugin "${name}" is ${phase} on agent "${record.agentLabel}" — its settings can be changed once it is active`;
  }
  if (record.health?.reason === 'app') {
    return `The agent half of plugin "${name}" is not responding since ${record.health.since} — its settings can be changed when it answers again`;
  }
  return `Hosting agent "${record.agentLabel}" of plugin "${name}" is offline since ${record.health?.since} — its settings can be changed when it is back`;
}

/**
 * Read the agent half's settings through the tunnel; null (logged, with
 * metadata only) when it cannot be read.
 */
async function readAgentHalfState(name, record, logger) {
  const result = await callAgentHalf({
    plugin: record.plugin,
    port: record.port,
    secret: signingSecretFor(record),
    method: 'GET',
    path: AGENT_HALF_SETTINGS_PATH,
    timeoutMs: SETTINGS_READ_TIMEOUT_MS,
    maxResponseBytes: AGENT_HALF_SETTINGS_MAX_BYTES,
  });
  if (!result.ok) {
    logger?.warn(
      { plugin: name, code: result.code, err: result.error },
      'Could not read the plugin settings from its agent half',
    );
    return null;
  }
  if (result.status !== 200) {
    logger?.warn(
      { plugin: name, status: result.status },
      'The agent half did not answer its settings',
    );
    return null;
  }
  const state = parseAgentHalfSettingsState(result.body);
  if (!state) {
    logger?.warn({ plugin: name }, 'The agent half answered its settings in an unexpected shape');
  }
  return state;
}

/** {@link refreshPluginSettings} inside the plugin's chain. */
async function refreshUnserialized(name, logger) {
  const plugin = await findPlugin(name);
  const block = plugin ? settingsBlockOf(plugin) : null;
  if (!block) return null;
  const record = await ownHostingOf(plugin);
  if (!record || pluginHostingPhase(record) !== 'active') return null;
  const state = await readAgentHalfState(name, record, logger);
  return state ? writeSettingsCache(name, block, state) : null;
}

/**
 * Read plugin `name`'s settings from its agent half and cache them. Null
 * when the plugin declares none, is not actively hosted, or its agent half
 * could not be read (logged; the cache is kept).
 *
 * @param {string} name
 * @param {{ logger?: import('pino').Logger }} [opts]
 * @returns {Promise<SettingsCache | null>}
 */
export function refreshPluginSettings(name, { logger } = {}) {
  return serialized(name, () => refreshUnserialized(name, logger));
}

/**
 * {@link refreshPluginSettings} for the triggers beside other work — a
 * hosting or an update that succeeded, the health monitor seeing the plugin
 * come up. Never throws.
 */
export async function refreshPluginSettingsBestEffort(name, logger) {
  try {
    return await refreshPluginSettings(name, { logger });
  } catch (err) {
    logger?.warn({ plugin: name, err: err?.message }, 'Failed to refresh the plugin settings');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/**
 * What the panel shows: the fields, each non-secret field's effective value
 * (stored, or its default) and each secret as `{ set: true, setAt }` or
 * `{ set: false }`, whether the plugin still needs configuration, the
 * revision to base a change on, where it came from (`live`: the agent half
 * just answered; `cache`: the relay's last read; `none`: never read — the
 * defaults) and the hosting.
 */
function settingsView(block, cache, source, hosting) {
  const effective = effectiveSettingsValues(block, cache?.values ?? {});
  const values = {};
  for (const field of block.fields) {
    if (field.type === 'secret') {
      const setAt = cache?.secretsSet[field.key];
      values[field.key] = typeof setAt === 'string' ? { set: true, setAt } : { set: false };
    } else if (Object.hasOwn(effective, field.key)) {
      values[field.key] = effective[field.key];
    }
  }
  const status = cache
    ? { configured: cache.configured, missing: cache.missing }
    : settingsStatus(block, { values: {}, secretsSet: [] });
  return {
    schemaVersion: block.schemaVersion,
    fields: block.fields,
    values,
    configured: status.configured,
    missing: status.missing,
    revision: cache?.revision ?? null,
    source,
    syncedAt: cache?.syncedAt ?? null,
    hosting,
  };
}

/**
 * Plugin `name`'s settings: read from its agent half when its hosting is
 * active and not down (and cached), otherwise from the cache. 404 when the
 * plugin is not installed or declares no settings (`no_settings`).
 *
 * @param {string} name
 * @param {{ logger?: import('pino').Logger }} [opts]
 */
export async function getPluginSettingsView(name, { logger } = {}) {
  const plugin = await findPlugin(name);
  if (!plugin) throw httpError(`Plugin "${name}" not found`, 404);
  const block = settingsBlockOf(plugin);
  if (!block) {
    throw httpError(`Plugin "${name}" declares no settings`, 404, { code: 'no_settings' });
  }
  const record = await ownHostingOf(plugin);
  let cache = null;
  let source = 'none';
  if (record && isReachable(record)) {
    cache = await refreshPluginSettingsBestEffort(name, logger);
    if (cache) source = 'live';
  }
  if (!cache) {
    cache = await readSettingsCache(name);
    if (cache) source = 'cache';
  }
  return settingsView(block, cache, source, await hostingBlock(record));
}

/**
 * The plugins of a list, each that declares settings with `settings` as a
 * summary — `{ configured, missing, syncedAt }` from the cache (from the
 * schema's defaults while the relay never read them: `syncedAt` null) — in
 * place of its schema. Never a value.
 *
 * @param {Array<object>} plugins registry entries
 */
export async function attachSettingsSummaries(plugins) {
  const caches = await readAllSettingsCaches();
  return plugins.map((plugin) => {
    const block = settingsBlockOf(plugin);
    if (!block) {
      const rest = { ...plugin };
      delete rest.settings;
      return rest;
    }
    const cache = caches.get(plugin.name) ?? null;
    const status = cache
      ? { configured: cache.configured, missing: cache.missing }
      : settingsStatus(block, { values: {}, secretsSet: [] });
    return {
      ...plugin,
      settings: {
        configured: status.configured,
        missing: status.missing,
        syncedAt: cache?.syncedAt ?? null,
      },
    };
  });
}

/**
 * The `settings` of a relay hook's lifecycle input: the plugin's effective
 * non-secret values, from the cache — `{}` when the plugin declares no
 * settings or the relay never read them. Never a secret. (Agent hooks get
 * `{}`: the agent half holds the settings itself.)
 *
 * @param {object} plugin registry entry (or a staged version in that shape)
 */
export async function relayHookSettings(plugin) {
  const block = settingsBlockOf(plugin);
  if (!block) return {};
  const cache = await readSettingsCache(plugin.name);
  return cache ? effectiveSettingsValues(block, cache.values) : {};
}

// ---------------------------------------------------------------------------
// Changing settings
// ---------------------------------------------------------------------------

/**
 * The request body's envelope `{ revision, values?, secrets? }`, checked
 * without repeating anything it carries.
 */
function parseUpdateEnvelope(body) {
  if (!isRecord(body)) {
    return { ok: false, error: 'The body must be a JSON object: { revision, values?, secrets? }' };
  }
  if (Object.keys(body).some((key) => !UPDATE_KEYS.has(key))) {
    return { ok: false, error: 'The body carries only revision, values and secrets' };
  }
  const { revision } = body;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    return {
      ok: false,
      error: '"revision" must be the revision the settings were read at (an integer of at least 0)',
    };
  }
  return { ok: true, revision, values: body.values, secrets: body.secrets };
}

/** 400 (the panel's check) or 422 (the agent half's), with a message per field. */
function invalidSettings(errors, statusCode = 400) {
  return httpError('Invalid settings', statusCode, { errors });
}

/**
 * The agent half's per-field messages, passed on only for keys a setting
 * can have (or `_`), shortened, and never with a secret of the change in
 * them — the agent half is Lamaste code that never repeats a value, but the
 * relay does not answer with one on its word.
 */
function agentHalfErrors(body, secretValues) {
  const raw = isRecord(body) && isRecord(body.errors) ? body.errors : {};
  const out = [];
  for (const [key, message] of Object.entries(raw).slice(0, SETTINGS_MAX_FIELDS + 1)) {
    if (key !== '_' && !SETTINGS_KEY_RE.test(key)) continue;
    const text =
      typeof message === 'string' &&
      message.length > 0 &&
      !secretValues.some((secret) => message.includes(secret))
        ? message.slice(0, AGENT_HALF_MESSAGE_MAX)
        : 'Invalid value';
    out.push([key, text]);
  }
  if (out.length === 0) out.push(['_', 'The agent half refused the values']);
  return Object.fromEntries(out);
}

/** The agent half's 409, as the panel answers it: a message of its own, the code, the revision. */
function agentHalfConflict(body) {
  const code = isRecord(body) ? body.code : undefined;
  if (code === 'revision_mismatch') {
    const revision =
      Number.isSafeInteger(body.revision) && body.revision >= 0 ? body.revision : null;
    return httpError(
      'The settings changed since they were read — reload them and make the change again',
      409,
      { code, ...(revision !== null ? { revision } : {}) },
    );
  }
  if (code === 'schema_mismatch') {
    return httpError(
      'The agent half runs another version of the settings schema — let the update of the plugin finish, then make the change again',
      409,
      { code },
    );
  }
  return httpError('The agent half refused the change as conflicting', 409, { code: 'conflict' });
}

/** A call through the tunnel that got no answer: 504 when it timed out, 502 otherwise. */
function agentHalfUnreachable(name, result) {
  switch (result.code) {
    case 'refused':
      return httpError(
        `Nothing answers on the internal tunnel of plugin "${name}" — its hosting agent or agent half is down`,
        502,
        { code: 'refused' },
      );
    case 'timeout':
      return httpError(
        `The agent half of plugin "${name}" did not answer within ${SETTINGS_WRITE_TIMEOUT_MS / 1000} s — the change may or may not have been stored; reload the settings`,
        504,
        { code: 'timeout' },
      );
    case 'invalid':
      return httpError(`The agent half of plugin "${name}" answered with too large a body`, 502, {
        code: 'invalid',
      });
    default:
      return httpError(`The agent half of plugin "${name}" could not be reached`, 502, {
        code: 'other',
      });
  }
}

/**
 * Change plugin `name`'s settings: `body` is the request's
 * `{ revision, values?, secrets? }` — partial; `null` puts a non-secret field
 * back to its default and clears a secret (refused for a required field).
 * Checked here without `pattern` (400 `{ errors }`), refused while a plugin
 * operation runs (409 `operation_running`) and while the hosting is not
 * active or its health is down (503 `hosting_offline`, with the hosting),
 * then sent to the agent half, whose answer decides: its new state (cached,
 * audited with key names only, returned as the settings view), its 409
 * (`revision_mismatch` with the current revision, `schema_mismatch`), its
 * 422 (`errors`), or 502 `settings_unsupported` when it does not answer
 * `/admin/settings`. An empty change stores nothing and returns the
 * settings as they are.
 *
 * Nothing derived from `body` is logged, stored or thrown, and nothing keeps
 * it once this returns.
 *
 * @param {string} name
 * @param {unknown} body
 * @param {{ actor: string, certSerial?: string | null, logger?: import('pino').Logger }} opts
 */
export function updatePluginSettings(name, body, { actor, certSerial = null, logger }) {
  return serialized(name, async () => {
    const plugin = await findPlugin(name);
    if (!plugin) throw httpError(`Plugin "${name}" not found`, 404);
    const block = settingsBlockOf(plugin);
    if (!block) {
      throw httpError(`Plugin "${name}" declares no settings`, 404, { code: 'no_settings' });
    }

    const envelope = parseUpdateEnvelope(body);
    if (!envelope.ok) throw invalidSettings({ _: envelope.error });
    const checked = validateSettingsUpdate(
      block,
      { values: envelope.values, secrets: envelope.secrets },
      { checkPattern: false },
    );
    if (!checked.ok) throw invalidSettings(checked.errors);

    if (isPluginOperationRunning(name)) {
      const running = await getPluginOperation(name);
      throw httpError(
        `Plugin "${name}" has an operation in progress — change its settings once it finished`,
        409,
        {
          code: 'operation_running',
          ...(running?.status === 'running' ? { operationId: running.id } : {}),
        },
      );
    }
    const record = await ownHostingOf(plugin);
    if (!record || !isReachable(record)) {
      throw httpError(offlineMessage(name, record), 503, {
        code: 'hosting_offline',
        hosting: await hostingBlock(record),
      });
    }

    const changed = Object.keys(checked.values).filter((key) => checked.values[key] !== null);
    const cleared = Object.keys(checked.values).filter((key) => checked.values[key] === null);
    const secretsSet = Object.keys(checked.secrets).filter((key) => checked.secrets[key] !== null);
    const secretsCleared = Object.keys(checked.secrets).filter(
      (key) => checked.secrets[key] === null,
    );
    if (changed.length + cleared.length + secretsSet.length + secretsCleared.length === 0) {
      // Nothing to store: the settings as they are.
      let cache = await refreshUnserialized(name, logger);
      let source = cache ? 'live' : 'none';
      if (!cache) {
        cache = await readSettingsCache(name);
        if (cache) source = 'cache';
      }
      return settingsView(block, cache, source, await hostingBlock(record));
    }

    const result = await callAgentHalf({
      plugin: record.plugin,
      port: record.port,
      secret: signingSecretFor(record),
      method: 'PUT',
      path: AGENT_HALF_SETTINGS_PATH,
      body: {
        schemaVersion: block.schemaVersion,
        baseRevision: envelope.revision,
        values: checked.values,
        secrets: checked.secrets,
      },
      timeoutMs: SETTINGS_WRITE_TIMEOUT_MS,
      maxResponseBytes: AGENT_HALF_SETTINGS_MAX_BYTES,
    });
    if (!result.ok) {
      logger?.warn(
        { plugin: name, code: result.code, err: result.error },
        'Could not send the settings change to the agent half',
      );
      throw agentHalfUnreachable(name, result);
    }

    switch (result.status) {
      case 200: {
        const state = parseAgentHalfSettingsState(result.body);
        if (!state) {
          logger?.warn({ plugin: name }, 'The agent half answered a settings change unexpectedly');
          throw httpError(
            `The agent half of plugin "${name}" answered the change in an unexpected shape — reload the settings to see what it stored`,
            502,
            { code: 'invalid' },
          );
        }
        const cache = await writeSettingsCache(name, block, state);
        await recordAuditBestEffort(
          {
            actor,
            action: 'plugin.settings.updated',
            plugin: name,
            details: {
              changed,
              cleared,
              secretsSet,
              secretsCleared,
              revision: state.revision,
              ...(certSerial ? { certSerial } : {}),
            },
          },
          logger,
        );
        logger?.info({ plugin: name, revision: state.revision }, 'Plugin settings changed');
        return settingsView(block, cache, 'live', await hostingBlock(record));
      }
      case 409:
        throw agentHalfConflict(result.body);
      case 422: {
        const secretValues = Object.values(checked.secrets).filter(
          (value) => typeof value === 'string' && value.length > 0,
        );
        throw invalidSettings(agentHalfErrors(result.body, secretValues), 422);
      }
      case 404:
        throw httpError(
          `The agent half of plugin "${name}" does not answer ${AGENT_HALF_SETTINGS_PATH} — it predates plugin settings`,
          502,
          { code: 'settings_unsupported' },
        );
      default:
        logger?.warn(
          { plugin: name, status: result.status },
          'The agent half refused a settings change',
        );
        throw httpError(
          `The agent half of plugin "${name}" answered ${result.status} to the settings change`,
          502,
          { code: 'agent_half_error', status: result.status },
        );
    }
  });
}
