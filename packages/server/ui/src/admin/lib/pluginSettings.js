import { formatMoment } from './hostingState.js';

/**
 * The plugin settings form as pure functions (no React): the form's inputs
 * from a settings view, what the administrator changed, and the partial
 * update (`PUT /api/plugins/:name/settings` `{ revision, values?, secrets? }`)
 * that sends only that.
 *
 * The view (`GET /api/plugins/:name/settings`) carries the field
 * definitions, the effective non-secret values (defaults overlaid by what
 * the agent half stores) and, for each secret, only `{ set, setAt? }` —
 * never a value. A secret is typed into a masked text input — not a
 * password input, which browsers offer to save in their password managers —
 * that is never prefilled; the form reads it from the input when it submits
 * and it goes into the request body alone.
 *
 * The checks mirror the core library's `checkSettingsValue` with the
 * pattern tested — the form and the agent half test a manifest's pattern,
 * the relay never does — and use its messages, which never contain the
 * value. An empty text, number or choice means "no value": `null` in the
 * update, which puts the field back to its default (or unsets it) and is
 * refused for a field that must keep a value.
 */

/** The `maxLength` of a string or secret field that declares none (core `SETTINGS_DEFAULT_MAX_LENGTH`). */
export const SETTINGS_DEFAULT_MAX_LENGTH = 1024;

/** Whether a field must have a value: required, with no default to fall back to. */
export function needsValue(field) {
  return field.required === true && field.default === undefined;
}

/** Whether the update may clear a field (`null`): a secret when optional, another field unless it must have a value. */
export function canClear(field) {
  return field.type === 'secret' ? field.required !== true : !needsValue(field);
}

/**
 * The form input for a non-secret field's value: text for string, integer,
 * number and enum fields (`''` = no value), `true` / `false` / `null` (no
 * value) for a boolean.
 */
export function inputOf(field, value) {
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean' ? value : null;
    case 'integer':
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
    case 'string':
    case 'enum':
      return typeof value === 'string' ? value : '';
    default:
      return '';
  }
}

/** The form inputs of a view's non-secret fields, by key. */
export function initialInputs(view) {
  const inputs = {};
  for (const field of view.fields) {
    if (field.type !== 'secret') inputs[field.key] = inputOf(field, view.values?.[field.key]);
  }
  return inputs;
}

/** Whether a view says a secret is set, and since when. */
export function secretState(view, key) {
  const state = view.values?.[key];
  return state !== null && typeof state === 'object' && state.set === true
    ? { set: true, setAt: typeof state.setAt === 'string' ? state.setAt : null }
    : { set: false, setAt: null };
}

/**
 * What the form does with each secret, by key: `keep` a set secret,
 * `replace` it (an unset secret starts here — its input is shown at once)
 * or `clear` it.
 */
export function initialSecretActions(view) {
  const actions = {};
  for (const field of view.fields) {
    if (field.type === 'secret') {
      actions[field.key] = secretState(view, field.key).set ? 'keep' : 'replace';
    }
  }
  return actions;
}

/** "Set on 16.10.2026 14:05:12", or "Not set". */
export function secretStatusText(state) {
  if (!state.set) return 'Not set';
  if (!state.setAt) return 'Set';
  const at = new Date(state.setAt);
  return Number.isNaN(at.getTime()) ? 'Set' : `Set on ${at.toLocaleString()}`;
}

function numberMessage(field) {
  return field.type === 'integer' ? 'Must be an integer' : 'Must be a number';
}

function rangeMessage(field, value) {
  if (field.min !== undefined && value < field.min) return `Must be at least ${field.min}`;
  if (field.max !== undefined && value > field.max) return `Must be at most ${field.max}`;
  return null;
}

/**
 * Whether a string passes a field's `pattern` — compiled with the `u` flag
 * and tested unanchored, as the agent half does. A pattern this browser
 * cannot compile is left to the agent half, which reports it.
 */
function matchesPattern(field, text) {
  if (field.pattern === undefined) return true;
  let re;
  try {
    re = new RegExp(field.pattern, 'u');
  } catch {
    return true;
  }
  return re.test(text);
}

/**
 * A non-secret field's input as the value to send: `null` for no value
 * (empty), or a message when it is not a valid value of the field. A number
 * input the browser could not parse (`validity.badInput`) is reported as
 * such — its value reads as empty.
 *
 * @returns {{ ok: true, value: string | number | boolean | null } | { ok: false, message: string }}
 */
export function parseInput(field, input, { badInput = false } = {}) {
  switch (field.type) {
    case 'string': {
      const text = typeof input === 'string' ? input : '';
      if (text === '') return { ok: true, value: null };
      const maxLength = field.maxLength ?? SETTINGS_DEFAULT_MAX_LENGTH;
      if (text.length > maxLength) {
        return { ok: false, message: `Must be at most ${maxLength} characters` };
      }
      if (!matchesPattern(field, text)) {
        return { ok: false, message: 'Does not match the required format' };
      }
      return { ok: true, value: text };
    }
    case 'integer':
    case 'number': {
      if (badInput) return { ok: false, message: numberMessage(field) };
      const text = typeof input === 'string' ? input.trim() : '';
      if (text === '') return { ok: true, value: null };
      const value = Number(text);
      const valid = field.type === 'integer' ? Number.isSafeInteger(value) : Number.isFinite(value);
      if (!valid) return { ok: false, message: numberMessage(field) };
      const outOfRange = rangeMessage(field, value);
      return outOfRange ? { ok: false, message: outOfRange } : { ok: true, value };
    }
    case 'boolean':
      return { ok: true, value: typeof input === 'boolean' ? input : null };
    case 'enum': {
      const text = typeof input === 'string' ? input : '';
      if (text === '') return { ok: true, value: null };
      return (field.options ?? []).some((o) => o.value === text)
        ? { ok: true, value: text }
        : { ok: false, message: 'Must be one of the options' };
    }
    default:
      return { ok: false, message: 'Cannot be set in this form' };
  }
}

/**
 * Whether a non-secret field's input differs from its initial input —
 * numerically for numbers (`3` and `3.0` are the same value), and always
 * for a number input the browser could not parse. Tests no pattern, so it
 * is cheap enough to run on every render. A field the form holds no input
 * for (`undefined` — added to the schema while the form was open) is no
 * change: the administrator never saw it, so it is neither sent nor checked.
 */
export function inputChanged(field, initial, input, { badInput = false } = {}) {
  if (input === undefined) return false;
  if (field.type === 'integer' || field.type === 'number') {
    if (badInput) return true;
    const before = typeof initial === 'string' ? initial.trim() : '';
    const after = typeof input === 'string' ? input.trim() : '';
    if (before === '' || after === '') return before !== after;
    const a = Number(before);
    const b = Number(after);
    return Number.isNaN(a) || Number.isNaN(b) ? before !== after : a !== b;
  }
  return initial !== input;
}

/**
 * A key that changes whenever the settings schema does — any field added,
 * removed, retyped or redefined: the fields' JSON (fifty at most). The
 * agent half keeps its revision when it adopts a new schema, so the form is
 * keyed by this as well as by the revision: a form opened on the old schema
 * starts over on the new one.
 *
 * @param {Array<object> | undefined} fields
 * @returns {string}
 */
export function settingsSchemaKey(fields) {
  return JSON.stringify(fields ?? []);
}

/**
 * The keys of the fields the administrator changed: non-secret inputs that
 * differ from the view, secrets to clear, and secrets to replace whose
 * input is filled (`secretFilled` — whether each secret input holds text;
 * the form never keeps a secret's value in its state).
 *
 * @param {object} view
 * @param {{ inputs: object, badInput?: object, secretActions: object, secretFilled?: object }} form
 * @returns {string[]}
 */
export function changedKeys(view, form) {
  const initial = initialInputs(view);
  const keys = [];
  for (const field of view.fields) {
    const key = field.key;
    if (field.type === 'secret') {
      const action = form.secretActions[key];
      if (action === 'clear' || (action === 'replace' && form.secretFilled?.[key] === true)) {
        keys.push(key);
      }
    } else if (
      inputChanged(field, initial[key], form.inputs[key], { badInput: form.badInput?.[key] })
    ) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * The partial update for what the administrator changed: `{ revision,
 * values?, secrets? }` with only the changed fields (`null` clears one), or
 * the fields' errors when a changed field is not valid. `secrets` holds,
 * by key, the secret's action and — read from its input as the form
 * submits — its `value`. The update carries the secrets the administrator
 * typed: it goes into the request body and nowhere else.
 *
 * @param {object} view
 * @param {{ inputs: object, badInput?: object, secrets: Record<string, { action: 'keep' | 'replace' | 'clear', value?: string }> }} form
 * @returns {{ ok: true, body: { revision: number, values?: object, secrets?: object }, changed: string[] } | { ok: false, errors: Record<string, string> }}
 */
export function buildSettingsUpdate(view, form) {
  const initial = initialInputs(view);
  const values = [];
  const secrets = [];
  const errors = [];

  for (const field of view.fields) {
    const key = field.key;
    if (field.type === 'secret') {
      const { action, value = '' } = form.secrets[key] ?? { action: 'keep' };
      if (action === 'clear') {
        if (canClear(field)) secrets.push([key, null]);
        else errors.push([key, 'Is required']);
      } else if (action === 'replace' && value !== '') {
        const maxLength = field.maxLength ?? SETTINGS_DEFAULT_MAX_LENGTH;
        if (value.length > maxLength) {
          errors.push([key, `Must be at most ${maxLength} characters`]);
        } else {
          secrets.push([key, value]);
        }
      }
      continue;
    }

    const badInput = form.badInput?.[key] === true;
    if (!inputChanged(field, initial[key], form.inputs[key], { badInput })) continue;
    const parsed = parseInput(field, form.inputs[key], { badInput });
    if (!parsed.ok) errors.push([key, parsed.message]);
    else if (parsed.value === null && !canClear(field)) errors.push([key, 'Is required']);
    else values.push([key, parsed.value]);
  }

  if (errors.length > 0) return { ok: false, errors: Object.fromEntries(errors) };
  return {
    ok: true,
    body: {
      revision: view.revision,
      ...(values.length > 0 ? { values: Object.fromEntries(values) } : {}),
      ...(secrets.length > 0 ? { secrets: Object.fromEntries(secrets) } : {}),
    },
    changed: [...values, ...secrets].map(([key]) => key),
  };
}

/**
 * The per-field errors of a refused settings update (`errors`: field key —
 * or `_` for the update as a whole — to message; the panel's and the agent
 * half's messages never contain a value), or null when it has none. Both
 * admin clients reject with an Error carrying them when the panel sent them.
 *
 * @param {unknown} err
 * @returns {Record<string, string> | null}
 */
export function settingsErrorsOf(err) {
  if (err === null || typeof err !== 'object') return null;
  const raw = err.errors;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries = Object.entries(raw).filter(([, message]) => typeof message === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/**
 * Where the values shown come from: the agent half itself (`live`), the
 * relay's cache of them (`cache`, with when it was synced), or nowhere yet
 * (`none` — defaults only).
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

/**
 * Words a key or label of a credential has. A plain string field named so
 * is likely to be given one — and a plain value is stored on the relay and
 * shown in clear, which is what a secret field avoids.
 */
const CREDENTIAL_WORDS = /key|token|secret|password|passwd|credential/i;

/**
 * Whether to warn under a non-secret string field that a credential does
 * not belong there: its key or label looks like one. Only a hint — the
 * plugin decides its fields' types.
 *
 * @param {{ key: string, label?: string, type: string }} field
 */
export function looksLikeCredential(field) {
  if (field.type !== 'string') return false;
  return CREDENTIAL_WORDS.test(field.key) || CREDENTIAL_WORDS.test(field.label ?? '');
}

/** What the credential hint says. */
export const CREDENTIAL_HINT =
  'Stored on the relay and shown in clear — use a secret field for credentials.';

/**
 * Whether this browser can mask a text input (`-webkit-text-security`):
 * Chrome, Edge and Safari always could, Firefox since 114. A secret input is
 * a masked text input rather than a password input so that no browser
 * offers to save it in its password manager; where masking is missing the
 * form says the value shows as it is typed instead of falling back to a
 * password input.
 *
 * @param {{ supports?: (property: string, value: string) => boolean } | undefined} css  the page's `CSS`
 */
export function secretMaskSupported(css) {
  try {
    return typeof css?.supports === 'function' && css.supports('-webkit-text-security', 'disc');
  } catch {
    return false;
  }
}

/**
 * A field's type in a few words, for lists of fields: `secret`, `integer
 * 0–10`, `enum: eu | us`, `string`, with `required` when it is.
 *
 * @param {{ type: string, required?: boolean, min?: number, max?: number, options?: Array<{ value: string }> }} field
 */
export function fieldTypeText(field) {
  let text = field.type;
  if (field.type === 'integer' || field.type === 'number') {
    if (field.min !== undefined && field.max !== undefined) text += ` ${field.min}–${field.max}`;
    else if (field.min !== undefined) text += ` ≥ ${field.min}`;
    else if (field.max !== undefined) text += ` ≤ ${field.max}`;
  }
  if (field.type === 'enum') {
    const values = (field.options ?? []).map((o) => o.value);
    text += `: ${values.length > 5 ? `${values.slice(0, 5).join(' | ')} | …` : values.join(' | ')}`;
  }
  return field.required ? `${text}, required` : text;
}

/**
 * The rows of an update's settings schema diff (`pendingUpdate.settings`:
 * `{ added: [{ key, type }], removed: [{ key, type }], retyped: [{ key,
 * from, to }], newRequired: [key], secretToPlain: [key] }`) as the update
 * preview lists them — each with a label, its entries in words and what
 * the change does to stored values — and the warning for secrets that
 * become plain values. Empty rows are left out; null when nothing changes.
 *
 * @param {object | null | undefined} diff
 * @returns {{ rows: Array<{ label: string, entries: string[], note: string | null }>, secretToPlain: string[] } | null}
 */
export function settingsDiffRows(diff) {
  if (!diff || typeof diff !== 'object') return null;
  const list = (value) => (Array.isArray(value) ? value : []);
  const ref = (entry) =>
    entry && typeof entry === 'object' ? `${entry.key} (${entry.type})` : String(entry);
  const rows = [
    { label: 'added', entries: list(diff.added).map(ref), note: null },
    { label: 'removed', entries: list(diff.removed).map(ref), note: 'their values are dropped' },
    {
      label: 'type changed',
      entries: list(diff.retyped).map((entry) =>
        entry && typeof entry === 'object'
          ? `${entry.key} (${entry.from} → ${entry.to})`
          : String(entry),
      ),
      note: 'their values are dropped, not converted',
    },
    {
      label: 'newly required',
      entries: list(diff.newRequired).map(String),
      note: 'to be set after the update',
    },
  ].filter((row) => row.entries.length > 0);
  const secretToPlain = list(diff.secretToPlain).map(String);
  if (rows.length === 0 && secretToPlain.length === 0) return null;
  return { rows, secretToPlain };
}
