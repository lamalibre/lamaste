/**
 * `lamaste-server plugins settings|configure` as pure functions (no I/O, no
 * colour): the arguments of `configure`, the secrets it reads on stdin, the
 * partial update (`PUT /api/plugins/:name/settings` `{ revision, values?,
 * secrets? }`) the flags or the prompts make, and the sentences that
 * describe a settings view (`GET /api/plugins/:name/settings`).
 *
 * The view carries the field definitions, each non-secret field's
 * effective value (what the agent half stores, or the default) and, for a
 * secret, only `{ set, setAt }` — never a value. A secret value appears in
 * nothing these functions return but the update's `secrets`: messages name
 * keys only, and an argument that could be a mistyped secret is never
 * repeated.
 *
 * Values are checked with the core library's validator without the
 * manifest's `pattern`: the CLI runs as root on the relay, which never runs
 * a plugin's regular expression; the agent half tests it and answers per
 * field (422).
 *
 * Labels, descriptions, options, defaults and values come from a plugin's
 * manifest or its agent half, and the panel's messages may quote them: the
 * text these functions build passes them through {@link terminalText}, so
 * none can drive the administrator's terminal or reorder what it shows.
 */

import {
  AGENT_HALF_SETTINGS_MAX_BYTES,
  SETTINGS_KEY_RE,
  validateSettingsUpdate,
} from '@lamalibre/lamaste';

export const CONFIGURE_USAGE =
  'Usage: lamaste-server plugins configure <name> [--set key=value]... [--clear key]... [--secrets-stdin]';

/** The most `--secrets-stdin` reads: the panel takes no larger settings change. */
export const SECRETS_STDIN_MAX_BYTES = AGENT_HALF_SETTINGS_MAX_BYTES;

const INTEGER_RE = /^[+-]?\d+$/;
const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const TRUE_WORDS = new Set(['true', 'yes', 'on']);
const FALSE_WORDS = new Set(['false', 'no', 'off']);

/** Whether a field must have a value: required, with no default to fall back to. */
export function needsValue(field) {
  return field.required === true && field.default === undefined;
}

/** Whether an update may clear a field (`null`): a secret when optional, another field unless it must have a value. */
export function canClear(field) {
  return field.type === 'secret' ? field.required !== true : !needsValue(field);
}

/**
 * The arguments of `configure <name> [--set key=value]... [--clear key]...
 * [--secrets-stdin]` (also `--set=key=value`, `--clear=key`). `--set` and
 * `--clear` take a key a setting can have; neither the value of a `--set` nor
 * an argument that is not a known option is repeated in an error — it could
 * be a secret typed in the wrong place.
 *
 * @param {string[]} args  what follows `configure`
 * @returns {{ ok: true, name: string, sets: Array<{ key: string, raw: string }>, clears: string[], secretsStdin: boolean } | { ok: false, error: string }}
 */
export function parseConfigureArgs(args) {
  let name = null;
  const sets = [];
  const clears = [];
  let secretsStdin = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--set' || arg.startsWith('--set=')) {
      const pair = arg === '--set' ? args[++i] : arg.slice('--set='.length);
      const eq = typeof pair === 'string' ? pair.indexOf('=') : -1;
      if (eq <= 0 || !SETTINGS_KEY_RE.test(pair.slice(0, eq))) {
        return {
          ok: false,
          error: `--set takes key=value, the key a setting name (letters and digits, starting with a lowercase letter) — ${CONFIGURE_USAGE}`,
        };
      }
      sets.push({ key: pair.slice(0, eq), raw: pair.slice(eq + 1) });
    } else if (arg === '--clear' || arg.startsWith('--clear=')) {
      const key = arg === '--clear' ? args[++i] : arg.slice('--clear='.length);
      if (typeof key !== 'string' || !SETTINGS_KEY_RE.test(key)) {
        return { ok: false, error: `--clear takes a setting name — ${CONFIGURE_USAGE}` };
      }
      clears.push(key);
    } else if (arg === '--secrets-stdin') {
      secretsStdin = true;
    } else if (arg.startsWith('-')) {
      return {
        ok: false,
        error: /^--?[a-z][a-z-]*$/.test(arg)
          ? `Unknown option ${arg} — ${CONFIGURE_USAGE}`
          : `Unknown option — ${CONFIGURE_USAGE}`,
      };
    } else if (name === null) {
      name = arg;
    } else {
      return { ok: false, error: `One plugin name only — ${CONFIGURE_USAGE}` };
    }
  }
  if (name === null) return { ok: false, error: CONFIGURE_USAGE };
  return { ok: true, name, sets, clears, secretsStdin };
}

/**
 * What `--secrets-stdin` read: one JSON object, `{ key: "value" | null }`.
 * Its entries are checked by {@link buildSettingsUpdate}, per key. A parse
 * failure is reported in words of its own — `JSON.parse`'s message quotes
 * the text it could not read.
 *
 * @param {string} text
 * @returns {{ ok: true, secrets: Record<string, unknown> } | { ok: false, error: string }}
 */
export function parseSecretsJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: 'stdin is not valid JSON — give one object: { "key": "value" | null }',
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'stdin must hold one JSON object: { "key": "value" | null }' };
  }
  return { ok: true, secrets: parsed };
}

/**
 * The value of `--set key=<raw>` for a non-secret field, parsed by the
 * field's type; the range, the length and (for an enum) the option are
 * checked here or by the core validator. An empty value is refused — clear
 * a field with `--clear`. Messages never contain the value.
 *
 * @returns {{ ok: true, value: string | number | boolean } | { ok: false, message: string }}
 */
function parseSetValue(field, raw) {
  if (raw === '') {
    return {
      ok: false,
      message: canClear(field)
        ? 'Is empty — use --clear to put it back to its default'
        : 'Is empty — this setting needs a value',
    };
  }
  switch (field.type) {
    case 'string':
      return { ok: true, value: raw };
    case 'integer':
      return INTEGER_RE.test(raw.trim())
        ? { ok: true, value: Number(raw.trim()) }
        : { ok: false, message: 'Must be an integer' };
    case 'number':
      return NUMBER_RE.test(raw.trim())
        ? { ok: true, value: Number(raw.trim()) }
        : { ok: false, message: 'Must be a number' };
    case 'boolean': {
      const word = raw.trim().toLowerCase();
      if (TRUE_WORDS.has(word)) return { ok: true, value: true };
      if (FALSE_WORDS.has(word)) return { ok: true, value: false };
      return { ok: false, message: 'Must be true or false' };
    }
    case 'enum': {
      const options = field.options ?? [];
      return options.some((o) => o.value === raw)
        ? { ok: true, value: raw }
        : { ok: false, message: `Must be one of: ${options.map((o) => o.value).join(', ')}` };
    }
    default:
      return { ok: false, message: 'Cannot be set with --set' };
  }
}

/** Why `--set` refuses a secret. */
const SECRET_ON_COMMAND_LINE =
  'Is a secret — never on the command line: pipe it in with --secrets-stdin, or run configure without flags to be asked for it';

/** What follows when the refused `--set` carried a value: where it is now, and what to do. */
export const SECRET_LEAKED =
  "The value is now in your shell history and in sudo's log — rotate that secret.";

/** The settings block of a view, for the core validator. */
function blockOf(view) {
  return { schemaVersion: view.schemaVersion, fields: view.fields };
}

/**
 * The core library's verdict on one change (`values` or `secrets`, by key)
 * without testing a pattern: `{ key: message }` for what it refuses.
 *
 * @returns {Record<string, string>}
 */
function coreErrors(view, input) {
  const checked = validateSettingsUpdate(blockOf(view), input, { checkPattern: false });
  return checked.ok ? {} : checked.errors;
}

/**
 * Why one answer of the interactive mode is not a valid value of its field,
 * or null — for a prompt's `validate`. `value` is what the answer parsed to
 * (`null` clears the field). The message never contains the value.
 *
 * @param {object} view
 * @param {object} field
 * @param {string | number | boolean | null} value
 * @returns {string | null}
 */
export function answerError(view, field, value) {
  const input =
    field.type === 'secret'
      ? { secrets: { [field.key]: value } }
      : { values: { [field.key]: value } };
  const errors = coreErrors(view, input);
  return errors[field.key] ?? errors._ ?? null;
}

/**
 * A text answer of the interactive mode for a string, integer or number
 * field: empty clears the field (back to its default), anything else is
 * parsed by the field's type and checked like a `--set` value.
 *
 * @returns {{ ok: true, value: string | number | null } | { ok: false, message: string }}
 */
export function parseTextAnswer(view, field, text) {
  if (text === '') {
    return canClear(field) ? { ok: true, value: null } : { ok: false, message: 'Needs a value' };
  }
  const parsed = parseSetValue(field, text);
  if (!parsed.ok) return parsed;
  const message = answerError(view, field, parsed.value);
  return message ? { ok: false, message } : parsed;
}

/**
 * The partial update the flags of `configure` make: `--set` values parsed
 * by their field's type (refused for a secret — those come on stdin or from
 * the interactive mode), `--clear` as `null` (in `values` or `secrets` by the
 * field's type), the secrets read with `--secrets-stdin`; then the core
 * library's checks (required fields, length, range, option). Errors are
 * keyed by setting (`_` for a key on stdin that could not be a setting) and
 * never contain a value.
 *
 * @param {{ schemaVersion: number, fields: Array<object>, revision: number | null }} view
 * @param {{ sets?: Array<{ key: string, raw: string }>, clears?: string[], secrets?: Record<string, unknown> }} flags
 * @returns {{ ok: true, body: { revision: number | null, values?: Record<string, unknown>, secrets?: Record<string, string | null> } } | { ok: false, errors: Record<string, string> }}
 */
export function buildSettingsUpdate(view, { sets = [], clears = [], secrets = {} }) {
  const fields = new Map(view.fields.map((field) => [field.key, field]));
  const errors = new Map();
  const fail = (key, message) => {
    if (!errors.has(key)) errors.set(key, message);
  };
  const seen = new Set();
  const firstMention = (key) => {
    if (!seen.has(key)) {
      seen.add(key);
      return true;
    }
    fail(key, 'Given more than once');
    return false;
  };
  // Keys are setting names (SETTINGS_KEY_RE), so `__proto__` never is one.
  const values = {};
  const secretValues = {};

  for (const { key, raw } of sets) {
    if (!firstMention(key)) continue;
    const field = fields.get(key);
    if (!field) fail(key, 'Unknown setting');
    else if (field.type === 'secret') {
      // Refused, but too late for the value itself: it was typed on the command line.
      fail(
        key,
        raw === '' ? SECRET_ON_COMMAND_LINE : `${SECRET_ON_COMMAND_LINE}. ${SECRET_LEAKED}`,
      );
    } else {
      const parsed = parseSetValue(field, raw);
      if (parsed.ok) values[key] = parsed.value;
      else fail(key, parsed.message);
    }
  }

  for (const key of clears) {
    if (!firstMention(key)) continue;
    const field = fields.get(key);
    if (!field) fail(key, 'Unknown setting');
    else if (field.type === 'secret') secretValues[key] = null;
    else values[key] = null;
  }

  for (const [key, value] of Object.entries(secrets)) {
    if (!SETTINGS_KEY_RE.test(key)) {
      fail('_', 'A key on stdin is not a setting name');
      continue;
    }
    if (!firstMention(key)) continue;
    const field = fields.get(key);
    if (!field) fail(key, 'Unknown setting');
    else if (field.type !== 'secret') fail(key, 'Is not a secret — give it with --set');
    else if (value !== null && typeof value !== 'string') {
      fail(key, 'Must be a string, or null to clear it');
    } else secretValues[key] = value;
  }

  for (const [key, message] of Object.entries(
    coreErrors(view, { values, secrets: secretValues }),
  )) {
    fail(key, message);
  }
  if (errors.size > 0) return { ok: false, errors: Object.fromEntries(errors) };
  return { ok: true, body: updateBody(view.revision, values, secretValues) };
}

/**
 * `{ revision, values?, secrets? }` with only the parts that change something.
 *
 * @param {number | null} revision
 * @param {Record<string, unknown>} values
 * @param {Record<string, string | null>} secrets
 */
export function updateBody(revision, values, secrets) {
  return {
    revision,
    ...(Object.keys(values).length > 0 ? { values } : {}),
    ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
  };
}

/**
 * The key names an update changes, as the panel's audit entry lists them:
 * values set, values cleared (back to the default), secrets set, secrets
 * cleared. Never a value.
 *
 * @param {{ values?: Record<string, unknown>, secrets?: Record<string, unknown> }} body
 */
export function updateSummary(body) {
  const values = Object.entries(body.values ?? {});
  const secrets = Object.entries(body.secrets ?? {});
  return {
    changed: values.filter(([, v]) => v !== null).map(([k]) => k),
    cleared: values.filter(([, v]) => v === null).map(([k]) => k),
    secretsSet: secrets.filter(([, v]) => v !== null).map(([k]) => k),
    secretsCleared: secrets.filter(([, v]) => v === null).map(([k]) => k),
  };
}

/** Whether an update changes anything. */
export function updateChangesSomething(body) {
  return Object.keys(body.values ?? {}).length + Object.keys(body.secrets ?? {}).length > 0;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/**
 * Control characters — C0 and C1, DEL among them: ESC and CSI start the
 * sequences that move the cursor, recolour or rewrite the screen, set the
 * window title — and the bidirectional formatting characters (U+061C,
 * U+200E, U+200F, U+202A–U+202E, U+2066–U+2069), which reorder what is
 * shown around them.
 */
const UNPRINTABLE_RE = /[\p{Cc}\p{Bidi_Control}]/gu;

/**
 * `value` as text for the terminal: without control or bidirectional
 * formatting characters. Every string from a manifest, an agent half or the
 * panel goes through this before it is printed or shown in a prompt; the
 * NDJSON of `--json` carries the data as it is.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function terminalText(value) {
  return String(value ?? '').replace(UNPRINTABLE_RE, '');
}

/** "12m ago" — how long before `now` (epoch ms) an ISO moment was. */
export function relativeTime(iso, now) {
  const diffMs = now - Date.parse(iso);
  if (!Number.isFinite(diffMs)) return '';
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** `2026-10-16T14:05:12.000Z (12m ago)`, or "an unknown time". */
export function formatMoment(iso, now) {
  if (typeof iso !== 'string' || !Number.isFinite(Date.parse(iso))) return 'an unknown time';
  return `${terminalText(iso)} (${relativeTime(iso, now)})`;
}

/**
 * The hosting of a settings view (`{ agentLabel, phase, state, reason,
 * since, agentLastSeenAt }` or null) as a sentence, in the panel's words —
 * "Hosting agent edge-1 is offline since … — last sync …" — and whether it
 * is offline (health down).
 *
 * @param {object | null} hosting
 * @param {number} now
 * @returns {{ offline: boolean, text: string }}
 */
export function hostingText(hosting, now) {
  if (!hosting) return { offline: false, text: 'Not hosted on an agent yet' };
  const agent = terminalText(hosting.agentLabel);
  if (hosting.phase === 'installing') {
    return { offline: false, text: `The hosting on ${agent} is being set up` };
  }
  if (hosting.phase === 'removing') {
    return { offline: false, text: `The hosting on ${agent} is being removed` };
  }
  const since = formatMoment(hosting.since, now);
  if (hosting.state === 'down') {
    if (hosting.reason === 'app') {
      return { offline: true, text: `The agent half is not responding since ${since}` };
    }
    if (hosting.reason === 'tunnel') {
      const lastSync = hosting.agentLastSeenAt
        ? `last sync ${formatMoment(hosting.agentLastSeenAt, now)}`
        : 'no sync recorded';
      return {
        offline: true,
        text: `Hosting agent ${agent} is offline since ${since} — ${lastSync}`,
      };
    }
    return { offline: true, text: `The hosting on ${agent} is down since ${since}` };
  }
  if (hosting.state === 'up') {
    return {
      offline: false,
      text: `Hosted on agent ${agent}, up${hosting.since ? ` since ${since}` : ''}`,
    };
  }
  return {
    offline: false,
    text: `Hosted on agent ${agent}, health ${terminalText(hosting.state ?? 'unknown')}`,
  };
}

/**
 * Why the settings of a view cannot be changed now, or null when a change
 * can be sent: the panel writes them to the agent half through the tunnel,
 * so only while the plugin is hosted, its hosting active and not down
 * (`hosting_offline`, as the panel refuses it) — and a change names the
 * revision it was made on, so not before the relay has read them once
 * (`settings_not_read`: `revision` null).
 *
 * @param {{ hosting: object | null, revision: number | null }} view
 * @param {number} now
 * @returns {{ code: 'hosting_offline' | 'settings_not_read', message: string } | null}
 */
export function settingsReadOnlyReason(view, now) {
  const hosting = view.hosting;
  const offline = (message) => ({ code: 'hosting_offline', message });
  if (!hosting) {
    return offline(
      'Not hosted on an agent yet — its agent half keeps the settings, so they can be changed once it is hosted',
    );
  }
  if (hosting.phase === 'installing' || hosting.phase === 'removing') {
    return offline(
      `${hostingText(hosting, now).text} — the settings can be changed once it is active`,
    );
  }
  if (hosting.state === 'down') {
    return offline(
      `${hostingText(hosting, now).text} — the settings can be changed when it is back`,
    );
  }
  if (!Number.isSafeInteger(view.revision)) {
    return {
      code: 'settings_not_read',
      message: 'The settings could not be read from the agent half yet — try again in a moment',
    };
  }
  return null;
}

/**
 * Where a view's values come from, as a sentence: the agent half itself
 * (`live`), the relay's copy (`cache`, with when it was synced), or nowhere
 * yet (`none`).
 *
 * @param {{ source: string, syncedAt: string | null }} view
 * @param {number} now
 */
export function settingsSourceText(view, now) {
  if (view.source === 'live') return 'Read from the agent half';
  if (view.source === 'cache') {
    return view.syncedAt
      ? `From the relay's copy, synced from the agent half ${formatMoment(view.syncedAt, now)}`
      : "From the relay's copy";
  }
  return 'Never synced from the agent half — showing the defaults';
}

/** Whether a view's entry for a secret (`{ set, setAt }`) says it is set. */
export function secretIsSet(value) {
  return value !== null && typeof value === 'object' && value.set === true;
}

/**
 * A value as the CLI shows it: strings quoted (JSON escapes C0 controls
 * visibly; the rest of what {@link terminalText} drops goes), numbers and
 * booleans as they are.
 */
function valueText(field, value) {
  if (value === undefined || value === null) return 'not set';
  if (field.type === 'string') return terminalText(JSON.stringify(value));
  if (field.type === 'enum') {
    const option = (field.options ?? []).find((o) => o.value === value);
    return terminalText(
      option && option.label !== value ? `${value} (${option.label})` : String(value),
    );
  }
  return terminalText(value);
}

/**
 * A field's value in a view as the CLI shows it — a secret as "set <when>"
 * or "not set", never more.
 *
 * @param {object} field
 * @param {unknown} value  the view's `values[field.key]`
 */
export function fieldValueText(field, value) {
  if (field.type === 'secret') {
    if (!secretIsSet(value)) return 'not set';
    return typeof value.setAt === 'string' ? `set ${terminalText(value.setAt)}` : 'set';
  }
  return valueText(field, value);
}

/**
 * What a field is, in a few words: its label, whether it is required, its
 * range, options and default.
 *
 * @param {object} field
 */
export function fieldNote(field) {
  const parts = [field.label];
  if (field.required === true) parts.push('required');
  if (field.min !== undefined && field.max !== undefined) parts.push(`${field.min}..${field.max}`);
  else if (field.min !== undefined) parts.push(`at least ${field.min}`);
  else if (field.max !== undefined) parts.push(`at most ${field.max}`);
  if (field.type === 'enum') {
    const values = (field.options ?? []).map((o) => o.value);
    parts.push(values.length > 6 ? `${values.slice(0, 6).join(' | ')} | …` : values.join(' | '));
  }
  if (field.default !== undefined) parts.push(`default ${valueText(field, field.default)}`);
  return terminalText(parts.join(' · '));
}

/**
 * The lines of a change summary — which settings an update changes, with
 * the old and new value of a non-secret one; a secret only as set,
 * replaced or cleared.
 *
 * @param {object} view
 * @param {{ values?: Record<string, unknown>, secrets?: Record<string, unknown> }} body
 * @returns {string[]}
 */
export function describeChanges(view, body) {
  const lines = [];
  for (const field of view.fields) {
    const key = field.key;
    if (field.type === 'secret') {
      if (!Object.hasOwn(body.secrets ?? {}, key)) continue;
      const wasSet = secretIsSet(view.values?.[key]);
      lines.push(
        body.secrets[key] === null ? `${key}: cleared` : `${key}: ${wasSet ? 'replaced' : 'set'}`,
      );
      continue;
    }
    if (!Object.hasOwn(body.values ?? {}, key)) continue;
    const before = valueText(field, view.values?.[key]);
    const next = body.values[key];
    lines.push(
      next === null
        ? `${key}: ${before} → ${field.default !== undefined ? `the default, ${valueText(field, field.default)}` : 'not set'}`
        : `${key}: ${before} → ${valueText(field, next)}`,
    );
  }
  return lines.map(terminalText);
}

/**
 * A refused settings read or change in words: the headline and the lines
 * that say what to do — the panel's per-field messages, and for a stale
 * revision, an offline hosting, a running operation or no answer in time,
 * what comes next. Never a value of the change (the panel's messages hold
 * none), and every line as {@link terminalText}.
 *
 * @param {Error & { code?: string, errors?: Record<string, string>, hosting?: object | null, operationId?: string }} err
 * @param {string} name
 * @param {number} now
 * @returns {{ message: string, details: string[] }}
 */
export function settingsRefusal(err, name, now) {
  const details = Object.entries(err.errors ?? {}).map(([key, message]) =>
    key === '_' ? String(message) : `${key}: ${message}`,
  );
  switch (err.code) {
    case 'revision_mismatch':
      details.push(
        'The settings changed since they were read; nothing was saved. Run the command again to change them on the current values.',
      );
      break;
    case 'hosting_offline':
      if (err.hosting !== undefined) details.push(`${hostingText(err.hosting, now).text}.`);
      break;
    case 'operation_running':
      details.push(`Follow it with: lamaste-server plugins operations ${name}`);
      break;
    case 'timeout':
      details.push(`See what the agent half stored with: lamaste-server plugins settings ${name}`);
      break;
    case 'settings_unsupported':
      details.push(
        `Update the plugin to a version whose agent half keeps settings: lamaste-server plugins update ${name}`,
      );
      break;
    default:
      break;
  }
  return { message: terminalText(err.message), details: details.map(terminalText) };
}
