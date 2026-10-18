/**
 * The plugin settings form as pure functions: the inputs a settings view
 * fills in (a secret never prefilled, only when it was set), the checks that
 * mirror the core's — a pattern tested unanchored with the `u` flag, messages
 * that never repeat a value — and the partial update that sends only what
 * changed, `null` putting a field back to its default and refused where a
 * value must stay, a typed secret in `secrets` and nowhere else; and around
 * it the credential hint, the field type words and the rows of an update's
 * settings schema diff, which never show more of an entry than its key and
 * types.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CREDENTIAL_HINT,
  SETTINGS_DEFAULT_MAX_LENGTH,
  buildSettingsUpdate,
  canClear,
  changedKeys,
  fieldTypeText,
  initialInputs,
  initialSecretActions,
  inputChanged,
  inputOf,
  looksLikeCredential,
  needsValue,
  parseInput,
  secretMaskSupported,
  secretState,
  secretStatusText,
  settingsDiffRows,
  settingsErrorsOf,
  settingsSchemaKey,
  settingsSourceText,
} from '../src/admin/lib/pluginSettings.js';

const SECRET = 'sk-live-Zm9vYmFyYmF6cXV4'.repeat(3);
const SET_AT = '2026-10-16T10:00:00.000Z';

const FIELDS = [
  { key: 'apiKey', label: 'API key', type: 'secret', required: true },
  { key: 'webhookToken', label: 'Webhook token', type: 'secret', maxLength: 16 },
  {
    key: 'schedule',
    label: 'Daily sync time',
    type: 'string',
    pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$',
    default: '06:00',
  },
  { key: 'endpoint', label: 'Endpoint', type: 'string', required: true },
  { key: 'note', label: 'Note', type: 'string', maxLength: 8 },
  { key: 'retries', label: 'Retries', type: 'integer', min: 0, max: 10, default: 3 },
  { key: 'ratio', label: 'Ratio', type: 'number' },
  {
    key: 'region',
    label: 'Region',
    type: 'enum',
    options: [
      { value: 'eu', label: 'Europe' },
      { value: 'us', label: 'United States' },
    ],
  },
  { key: 'verbose', label: 'Verbose logging', type: 'boolean', default: false },
];

const field = (key) => {
  const found = FIELDS.find((f) => f.key === key);
  assert.ok(found, `no field ${key}`);
  return found;
};

/** A settings view as `GET /api/plugins/:name/settings` answers it. */
const VIEW = {
  schemaVersion: 1,
  fields: FIELDS,
  values: {
    apiKey: { set: true, setAt: SET_AT },
    webhookToken: { set: false },
    schedule: '06:00',
    endpoint: 'https://example.test',
    retries: 5,
    ratio: 1.5,
    verbose: false,
  },
  configured: true,
  missing: [],
  revision: 3,
  source: 'live',
  syncedAt: SET_AT,
};

/**
 * The form as it submits: the view's inputs with `inputs` edited, and each
 * secret's action (its initial one unless `secrets` says otherwise) with
 * what its input holds.
 */
function submit(view, { inputs = {}, badInput = {}, secrets = {} } = {}) {
  const actions = initialSecretActions(view);
  return buildSettingsUpdate(view, {
    inputs: { ...initialInputs(view), ...inputs },
    badInput,
    secrets: Object.fromEntries(
      Object.entries(actions).map(([key, action]) => [key, { action, value: '', ...secrets[key] }]),
    ),
  });
}

test('a field must have a value only when it is required without a default', () => {
  assert.equal(needsValue({ type: 'string', required: true }), true);
  assert.equal(needsValue({ type: 'string', required: true, default: '06:00' }), false);
  assert.equal(needsValue({ type: 'boolean', required: true, default: false }), false, 'false');
  assert.equal(needsValue({ type: 'integer', required: true, default: 0 }), false, 'zero');
  assert.equal(needsValue({ type: 'string', required: false }), false);
  assert.equal(needsValue({ type: 'string' }), false);
  assert.equal(needsValue({ type: 'string', required: 'true' }), false, 'only true is required');
});

test('a secret can be cleared unless required; another field unless it must have a value', () => {
  assert.equal(canClear(field('apiKey')), false);
  assert.equal(canClear(field('webhookToken')), true);
  assert.equal(canClear(field('endpoint')), false);
  assert.equal(canClear(field('schedule')), true, 'back to its default');
  assert.equal(canClear(field('ratio')), true, 'unset');
  assert.equal(canClear({ type: 'integer', required: true, default: 3 }), true);
});

test('a value becomes its input; one of another type is no value, and a secret is never one', () => {
  assert.equal(inputOf(field('verbose'), true), true);
  assert.equal(inputOf(field('verbose'), false), false);
  assert.equal(inputOf(field('verbose'), undefined), null);
  assert.equal(inputOf(field('verbose'), 'true'), null);

  assert.equal(inputOf(field('retries'), 5), '5');
  assert.equal(inputOf(field('retries'), 0), '0');
  assert.equal(inputOf(field('ratio'), 0.25), '0.25');
  assert.equal(inputOf(field('ratio'), Number.NaN), '');
  assert.equal(inputOf(field('ratio'), Number.POSITIVE_INFINITY), '');
  assert.equal(inputOf(field('retries'), '5'), '');
  assert.equal(inputOf(field('retries'), undefined), '');

  assert.equal(inputOf(field('endpoint'), 'https://example.test'), 'https://example.test');
  assert.equal(inputOf(field('endpoint'), 5), '');
  assert.equal(inputOf(field('endpoint'), undefined), '');
  assert.equal(inputOf(field('region'), 'eu'), 'eu');

  assert.equal(inputOf(field('apiKey'), SECRET), '');
  assert.equal(inputOf(field('apiKey'), { set: true, setAt: SET_AT }), '');
  assert.equal(inputOf({ type: 'date' }, '2026-10-16'), '');
});

test('the initial inputs hold every non-secret field — and no secret, whatever the view says', () => {
  assert.deepEqual(initialInputs(VIEW), {
    schedule: '06:00',
    endpoint: 'https://example.test',
    note: '',
    retries: '5',
    ratio: '1.5',
    region: '',
    verbose: false,
  });
  assert.deepEqual(initialInputs({ fields: FIELDS }), {
    schedule: '',
    endpoint: '',
    note: '',
    retries: '',
    ratio: '',
    region: '',
    verbose: null,
  });
  const leaking = { ...VIEW, values: { ...VIEW.values, apiKey: SECRET, webhookToken: SECRET } };
  const inputs = initialInputs(leaking);
  assert.equal('apiKey' in inputs || 'webhookToken' in inputs, false);
  assert.equal(JSON.stringify(inputs).includes(SECRET), false, 'a value sent for a secret');
});

test('a secret is set only when the view says set: true, and only when it was set is kept', () => {
  assert.deepEqual(secretState(VIEW, 'apiKey'), { set: true, setAt: SET_AT });
  assert.deepEqual(secretState(VIEW, 'webhookToken'), { set: false, setAt: null });
  assert.deepEqual(secretState(VIEW, 'missing'), { set: false, setAt: null });
  assert.deepEqual(secretState({ fields: FIELDS }, 'apiKey'), { set: false, setAt: null });

  const of = (state) => secretState({ fields: FIELDS, values: { apiKey: state } }, 'apiKey');
  assert.deepEqual(of({ set: true }), { set: true, setAt: null });
  assert.deepEqual(of({ set: true, setAt: 1760608800000 }), { set: true, setAt: null });
  assert.deepEqual(of({ set: 'yes', setAt: SET_AT }), { set: false, setAt: null });
  assert.deepEqual(of(null), { set: false, setAt: null });
  assert.deepEqual(of(SECRET), { set: false, setAt: null }, 'a value is not a state');
  assert.deepEqual(of({ set: true, setAt: SET_AT, value: SECRET }), { set: true, setAt: SET_AT });
});

test('a set secret starts kept, an unset one with its input shown; other fields have no action', () => {
  assert.deepEqual(initialSecretActions(VIEW), { apiKey: 'keep', webhookToken: 'replace' });
  assert.deepEqual(initialSecretActions({ fields: FIELDS }), {
    apiKey: 'replace',
    webhookToken: 'replace',
  });
  assert.deepEqual(initialSecretActions({ fields: [field('endpoint')], values: {} }), {});
});

test('a secret’s status says whether and when it was set, and nothing else', () => {
  assert.equal(secretStatusText({ set: false, setAt: null }), 'Not set');
  assert.equal(secretStatusText({ set: false, setAt: SET_AT }), 'Not set');
  assert.equal(secretStatusText({ set: true, setAt: null }), 'Set');
  assert.equal(secretStatusText({ set: true, setAt: 'not a date' }), 'Set');
  assert.equal(
    secretStatusText({ set: true, setAt: SET_AT }),
    `Set on ${new Date(SET_AT).toLocaleString()}`,
  );
});

test('a string is sent as typed, empty is no value, and its length is checked without repeating it', () => {
  const plain = { key: 'label', type: 'string' };
  assert.deepEqual(parseInput(plain, ''), { ok: true, value: null });
  assert.deepEqual(parseInput(plain, undefined), { ok: true, value: null });
  assert.deepEqual(parseInput(plain, '  padded  '), { ok: true, value: '  padded  ' });

  assert.equal(SETTINGS_DEFAULT_MAX_LENGTH, 1024, 'core SETTINGS_DEFAULT_MAX_LENGTH');
  assert.deepEqual(parseInput(plain, 'x'.repeat(1024)), { ok: true, value: 'x'.repeat(1024) });
  assert.deepEqual(parseInput(plain, 'x'.repeat(1025)), {
    ok: false,
    message: 'Must be at most 1024 characters',
  });
  assert.deepEqual(parseInput(field('note'), 'eight ch'), { ok: true, value: 'eight ch' });
  const tooLong = parseInput(field('note'), SECRET);
  assert.deepEqual(tooLong, { ok: false, message: 'Must be at most 8 characters' });
  assert.equal(JSON.stringify(tooLong).includes(SECRET), false);
});

test('a pattern is tested unanchored with the u flag, and its refusal does not repeat the text', () => {
  const schedule = field('schedule');
  assert.deepEqual(parseInput(schedule, '06:30'), { ok: true, value: '06:30' });
  for (const text of ['24:00', 'x06:30', '06:30 ', '6:30']) {
    assert.deepEqual(
      parseInput(schedule, text),
      { ok: false, message: 'Does not match the required format' },
      text,
    );
  }
  const refused = parseInput(schedule, SECRET);
  assert.equal(JSON.stringify(refused).includes(SECRET), false);

  const unanchored = { key: 'zone', type: 'string', pattern: 'eu-[0-9]+' };
  assert.deepEqual(parseInput(unanchored, 'region eu-1 west'), {
    ok: true,
    value: 'region eu-1 west',
  });
  assert.equal(parseInput(unanchored, 'eu-x').ok, false);

  const unicode = { key: 'code', type: 'string', pattern: '^\\p{Lu}+$' };
  assert.deepEqual(parseInput(unicode, 'ÄÖÜ'), { ok: true, value: 'ÄÖÜ' });
  assert.equal(parseInput(unicode, 'äöü').ok, false, '\\p{…} needs the u flag');
});

test('a pattern this browser cannot compile is left to the agent half', () => {
  // `{` compiles without the u flag and not with it.
  const odd = { key: 'odd', type: 'string', pattern: '{' };
  assert.deepEqual(parseInput(odd, 'anything'), { ok: true, value: 'anything' });
  assert.equal(parseInput(odd, 'x'.repeat(1025)).ok, false, 'its length is still checked');
});

test('a number is read from its trimmed text, as an integer or a finite number, within range', () => {
  const retries = field('retries');
  assert.deepEqual(parseInput(retries, ''), { ok: true, value: null });
  assert.deepEqual(parseInput(retries, '   '), { ok: true, value: null });
  assert.deepEqual(parseInput(retries, undefined), { ok: true, value: null });
  assert.deepEqual(parseInput(retries, ' 7 '), { ok: true, value: 7 });
  assert.deepEqual(parseInput(retries, '7.0'), { ok: true, value: 7 });
  assert.deepEqual(parseInput(retries, '1e1'), { ok: true, value: 10 });
  assert.deepEqual(parseInput(retries, '0'), { ok: true, value: 0 });
  assert.deepEqual(parseInput(retries, '10'), { ok: true, value: 10 });
  for (const text of ['7.5', 'seven', '9007199254740993']) {
    assert.deepEqual(parseInput(retries, text), { ok: false, message: 'Must be an integer' }, text);
  }
  assert.deepEqual(parseInput(retries, '-1'), { ok: false, message: 'Must be at least 0' });
  const above = parseInput(retries, '12345');
  assert.deepEqual(above, { ok: false, message: 'Must be at most 10' });
  assert.equal(JSON.stringify(above).includes('12345'), false, 'the value is not repeated');

  const ratio = field('ratio');
  assert.deepEqual(parseInput(ratio, '0.25'), { ok: true, value: 0.25 });
  assert.deepEqual(parseInput(ratio, '-3'), { ok: true, value: -3 }, 'no range declared');
  for (const text of ['Infinity', 'NaN', '1,5']) {
    assert.deepEqual(parseInput(ratio, text), { ok: false, message: 'Must be a number' }, text);
  }
  const bounded = { key: 'gain', type: 'number', min: -1.5, max: 1.5 };
  assert.deepEqual(parseInput(bounded, '1.6'), { ok: false, message: 'Must be at most 1.5' });
  assert.deepEqual(parseInput(bounded, '-1.6'), { ok: false, message: 'Must be at least -1.5' });
  assert.deepEqual(parseInput(bounded, '-1.5'), { ok: true, value: -1.5 });
});

test('a number the browser could not parse is refused, whatever its input reads', () => {
  assert.deepEqual(parseInput(field('retries'), '', { badInput: true }), {
    ok: false,
    message: 'Must be an integer',
  });
  assert.deepEqual(parseInput(field('retries'), '5', { badInput: true }), {
    ok: false,
    message: 'Must be an integer',
  });
  assert.deepEqual(parseInput(field('ratio'), '', { badInput: true }), {
    ok: false,
    message: 'Must be a number',
  });
});

test('a boolean is true, false or no value; an enum must be one of its options’ values', () => {
  const verbose = field('verbose');
  assert.deepEqual(parseInput(verbose, true), { ok: true, value: true });
  assert.deepEqual(parseInput(verbose, false), { ok: true, value: false });
  assert.deepEqual(parseInput(verbose, null), { ok: true, value: null });
  assert.deepEqual(parseInput(verbose, 'true'), { ok: true, value: null });

  const region = field('region');
  assert.deepEqual(parseInput(region, 'eu'), { ok: true, value: 'eu' });
  assert.deepEqual(parseInput(region, ''), { ok: true, value: null });
  for (const text of ['mars', 'EU', 'Europe']) {
    assert.deepEqual(
      parseInput(region, text),
      { ok: false, message: 'Must be one of the options' },
      text,
    );
  }
  assert.equal(parseInput({ key: 'bare', type: 'enum' }, 'eu').ok, false, 'no options');
});

test('a secret — or a field of a type the form does not know — is never parsed as a value', () => {
  const refused = parseInput(field('apiKey'), SECRET);
  assert.deepEqual(refused, { ok: false, message: 'Cannot be set in this form' });
  assert.equal(JSON.stringify(refused).includes(SECRET), false);
  assert.deepEqual(parseInput({ key: 'day', type: 'date' }, '2026-10-16'), {
    ok: false,
    message: 'Cannot be set in this form',
  });
});

test('a number changed only when its value did, a text when its text did; a bad number always', () => {
  const retries = field('retries');
  assert.equal(inputChanged(retries, '3', '3.0'), false);
  assert.equal(inputChanged(retries, '3', ' 3 '), false);
  assert.equal(inputChanged(retries, '10', '1e1'), false);
  assert.equal(inputChanged(retries, '3', '4'), true);
  assert.equal(inputChanged(retries, '', ''), false);
  assert.equal(inputChanged(retries, undefined, '  '), false);
  assert.equal(inputChanged(retries, '', '0'), true, 'a value where there was none');
  assert.equal(inputChanged(retries, '0', ''), true, 'emptied');
  assert.equal(inputChanged(retries, 'abc', 'abc'), false, 'unparsable: compared as text');
  assert.equal(inputChanged(retries, 'abc', 'abd'), true);
  assert.equal(inputChanged(retries, '3', '3', { badInput: true }), true);
  assert.equal(inputChanged(field('ratio'), '0.5', '.5'), false);

  assert.equal(inputChanged(field('endpoint'), 'a', 'a'), false);
  assert.equal(inputChanged(field('endpoint'), 'a', ' a'), true, 'a text is not trimmed');
  assert.equal(inputChanged(field('verbose'), null, false), true);
  assert.equal(inputChanged(field('verbose'), false, false), false);
  assert.equal(inputChanged(field('region'), 'eu', 'us'), true);
});

test('the changed keys are edited inputs, secrets to clear, and replacements whose input holds text', () => {
  const inputs = { ...initialInputs(VIEW), note: 'hi', retries: '5.0' };
  const base = { inputs, secretActions: initialSecretActions(VIEW) };
  assert.deepEqual(changedKeys(VIEW, { ...base, inputs: initialInputs(VIEW) }), []);
  assert.deepEqual(changedKeys(VIEW, base), ['note'], 'retries 5.0 is still 5');
  assert.deepEqual(changedKeys(VIEW, { ...base, badInput: { ratio: true } }), ['note', 'ratio']);
  assert.deepEqual(changedKeys(VIEW, { ...base, secretFilled: { webhookToken: true } }), [
    'webhookToken',
    'note',
  ]);
  assert.deepEqual(
    changedKeys(VIEW, { ...base, secretActions: { apiKey: 'clear', webhookToken: 'replace' } }),
    ['apiKey', 'note'],
  );
  assert.deepEqual(
    changedKeys(VIEW, {
      ...base,
      secretActions: { apiKey: 'replace', webhookToken: 'replace' },
      secretFilled: { apiKey: false },
    }),
    ['note'],
    'a replacement with an empty input',
  );
  assert.deepEqual(
    changedKeys(VIEW, { ...base, secretFilled: { apiKey: true } }),
    ['note'],
    'text in the input of a secret that is kept',
  );
});

test('nothing changed: the update names the revision and nothing else', () => {
  assert.deepEqual(submit(VIEW), { ok: true, body: { revision: 3 }, changed: [] });
  assert.deepEqual(submit(VIEW, { inputs: { retries: '5.0', ratio: ' 1.5 ' } }), {
    ok: true,
    body: { revision: 3 },
    changed: [],
  });
  assert.deepEqual(submit({ ...VIEW, revision: 0 }).body, { revision: 0 });
});

test('only the changed fields are sent, each as its type, in values', () => {
  const update = submit(VIEW, {
    inputs: { verbose: true, region: 'us', retries: ' 7 ', ratio: '0.5', note: 'hello' },
  });
  assert.deepEqual(update, {
    ok: true,
    body: {
      revision: 3,
      values: { note: 'hello', retries: 7, ratio: 0.5, region: 'us', verbose: true },
    },
    changed: ['note', 'retries', 'ratio', 'region', 'verbose'],
  });
});

test('null puts a field back to its default or unsets it; one that must keep a value refuses it', () => {
  assert.deepEqual(submit(VIEW, { inputs: { schedule: '', retries: '', ratio: '' } }), {
    ok: true,
    body: { revision: 3, values: { schedule: null, retries: null, ratio: null } },
    changed: ['schedule', 'retries', 'ratio'],
  });
  assert.deepEqual(submit(VIEW, { inputs: { endpoint: '' } }), {
    ok: false,
    errors: { endpoint: 'Is required' },
  });
  const unset = { ...VIEW, values: { ...VIEW.values, region: 'eu' } };
  assert.deepEqual(submit(unset, { inputs: { region: '' } }).body, {
    revision: 3,
    values: { region: null },
  });
  const tri = { ...VIEW, fields: [{ key: 'flag', label: 'Flag', type: 'boolean' }], values: {} };
  assert.deepEqual(submit(tri, { inputs: { flag: false } }).body, {
    revision: 3,
    values: { flag: false },
  });
  const flagged = { ...tri, values: { flag: true } };
  assert.deepEqual(submit(flagged, { inputs: { flag: null } }).body, {
    revision: 3,
    values: { flag: null },
  });
  const required = {
    ...tri,
    fields: [{ key: 'flag', label: 'Flag', type: 'boolean', required: true }],
    values: { flag: true },
  };
  assert.deepEqual(submit(required, { inputs: { flag: null } }), {
    ok: false,
    errors: { flag: 'Is required' },
  });
});

test('an unchanged field is neither sent nor checked — a stored value the form would refuse stays', () => {
  const stale = { ...VIEW, values: { ...VIEW.values, schedule: '6am', retries: 50 } };
  assert.deepEqual(submit(stale), { ok: true, body: { revision: 3 }, changed: [] });
  assert.deepEqual(submit(stale, { inputs: { note: 'x' } }).body, {
    revision: 3,
    values: { note: 'x' },
  });
  assert.deepEqual(submit(stale, { inputs: { schedule: '6:00' } }), {
    ok: false,
    errors: { schedule: 'Does not match the required format' },
  });
});

test('fields added while the form was open are neither sent nor checked — the admin never saw them', () => {
  // The agent half keeps its revision when it adopts a new schema, so a form
  // opened on v1 can be handed v2's view: its inputs lack v2's new fields.
  const v1 = {
    ...VIEW,
    fields: [field('retries')],
    values: { retries: 3 },
    missing: [],
  };
  const v2 = {
    ...v1,
    fields: [field('retries'), field('endpoint'), field('region'), field('verbose')],
  };
  const form = {
    inputs: { ...initialInputs(v1), retries: '5' },
    badInput: {},
    secretActions: {},
    secrets: {},
  };
  assert.deepEqual(changedKeys(v2, form), ['retries']);
  assert.deepEqual(buildSettingsUpdate(v2, form), {
    ok: true,
    body: { revision: 3, values: { retries: 5 } },
    changed: ['retries'],
  });
  assert.equal(inputChanged(field('endpoint'), '', undefined), false);
});

test('the schema key changes with any field added, removed, retyped or redefined — not with values', () => {
  const key = settingsSchemaKey(FIELDS);
  assert.equal(settingsSchemaKey(FIELDS.map((f) => ({ ...f }))), key);
  assert.equal(settingsSchemaKey({ ...VIEW, values: {} }.fields), key);
  const variants = [
    FIELDS.slice(1),
    [...FIELDS, { key: 'extra', label: 'Extra', type: 'string' }],
    FIELDS.map((f) => (f.key === 'note' ? { ...f, type: 'secret' } : f)),
    FIELDS.map((f) => (f.key === 'retries' ? { ...f, default: 4 } : f)),
    FIELDS.map((f) => (f.key === 'endpoint' ? { ...f, required: false } : f)),
  ];
  for (const fields of variants) assert.notEqual(settingsSchemaKey(fields), key);
  assert.equal(settingsSchemaKey(undefined), settingsSchemaKey([]));
});

test('a typed secret goes in secrets alone — never in values, and changed names only its key', () => {
  const update = submit(VIEW, {
    inputs: { retries: '4' },
    secrets: { apiKey: { action: 'replace', value: SECRET } },
  });
  assert.deepEqual(update, {
    ok: true,
    body: { revision: 3, values: { retries: 4 }, secrets: { apiKey: SECRET } },
    changed: ['retries', 'apiKey'],
  });
  assert.equal(JSON.stringify(update.body.values).includes(SECRET), false);
  assert.equal(JSON.stringify(update.changed).includes(SECRET), false);

  const alone = submit(VIEW, { secrets: { webhookToken: { value: 'whsec-1' } } });
  assert.deepEqual(alone.body, { revision: 3, secrets: { webhookToken: 'whsec-1' } });
  assert.equal('values' in alone.body, false);
});

test('a secret is sent only to replace or clear it — and a clear never carries what was typed', () => {
  assert.deepEqual(submit(VIEW, { secrets: { apiKey: { action: 'keep', value: SECRET } } }), {
    ok: true,
    body: { revision: 3 },
    changed: [],
  });
  assert.deepEqual(submit(VIEW, { secrets: { apiKey: { action: 'replace', value: '' } } }).body, {
    revision: 3,
  });
  assert.deepEqual(submit(VIEW).body, { revision: 3 }, 'an unset secret left empty');

  const cleared = submit(VIEW, { secrets: { webhookToken: { action: 'clear', value: 'whsec' } } });
  assert.deepEqual(cleared.body, { revision: 3, secrets: { webhookToken: null } });

  const missing = buildSettingsUpdate(VIEW, { inputs: initialInputs(VIEW), secrets: {} });
  assert.deepEqual(missing, { ok: true, body: { revision: 3 }, changed: [] }, 'kept');
});

test('clearing a required secret is refused, and a too-long one is refused without being repeated', () => {
  assert.deepEqual(submit(VIEW, { secrets: { apiKey: { action: 'clear' } } }), {
    ok: false,
    errors: { apiKey: 'Is required' },
  });

  const tooLong = submit(VIEW, { secrets: { webhookToken: { value: SECRET } } });
  assert.deepEqual(tooLong, {
    ok: false,
    errors: { webhookToken: 'Must be at most 16 characters' },
  });
  assert.equal(JSON.stringify(tooLong).includes(SECRET), false);

  const atDefault = (length) =>
    submit(VIEW, { secrets: { apiKey: { action: 'replace', value: 'k'.repeat(length) } } });
  assert.equal(atDefault(1024).ok, true);
  assert.deepEqual(atDefault(1025), {
    ok: false,
    errors: { apiKey: 'Must be at most 1024 characters' },
  });
});

test('a refused update carries the errors only — not the secrets typed beside them', () => {
  const update = submit(VIEW, {
    inputs: { endpoint: '' },
    secrets: { apiKey: { action: 'replace', value: SECRET } },
  });
  assert.deepEqual(update, { ok: false, errors: { endpoint: 'Is required' } });
  assert.equal(JSON.stringify(update).includes(SECRET), false);
});

test('every refused field is reported at once, each with its own message', () => {
  const update = submit(VIEW, {
    inputs: { schedule: '25:00', note: 'too long a note', retries: '11', region: 'mars' },
    badInput: { ratio: true },
    secrets: { apiKey: { action: 'clear' } },
  });
  assert.deepEqual(update, {
    ok: false,
    errors: {
      apiKey: 'Is required',
      schedule: 'Does not match the required format',
      note: 'Must be at most 8 characters',
      retries: 'Must be at most 10',
      ratio: 'Must be a number',
      region: 'Must be one of the options',
    },
  });
});

test('a refusal’s per-field errors are taken only when they are messages', () => {
  const err = Object.assign(new Error('Invalid settings'), {
    status: 400,
    errors: { retries: 'Must be at most 10', _: '2 unknown settings' },
  });
  assert.deepEqual(settingsErrorsOf(err), {
    retries: 'Must be at most 10',
    _: '2 unknown settings',
  });
  assert.deepEqual(settingsErrorsOf({ errors: { a: 'Is required', b: 5, c: null, d: {} } }), {
    a: 'Is required',
  });
  for (const value of [
    null,
    undefined,
    'Is required',
    42,
    {},
    new Error('plain'),
    { errors: null },
    { errors: 'Is required' },
    { errors: ['Is required'] },
    { errors: {} },
    { errors: { b: 5 } },
  ]) {
    assert.equal(settingsErrorsOf(value), null, JSON.stringify(value));
  }

  const parsed = settingsErrorsOf(JSON.parse('{"errors":{"__proto__":"Invalid value"}}'));
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype, 'no prototype is replaced');
  assert.equal(Object.hasOwn(parsed, '__proto__'), true);
});

test('where the values shown come from — the relay’s copy with when it was synced, as of now', () => {
  const synced = new Date(2026, 9, 16, 14, 12, 0);
  const now = new Date(2026, 9, 16, 14, 17, 0).getTime();
  assert.equal(
    settingsSourceText({ source: 'live', syncedAt: null }, now),
    'Read from the agent half',
  );
  assert.equal(
    settingsSourceText({ source: 'cache', syncedAt: synced.toISOString() }, now),
    `From the relay's copy, synced from the agent half ${synced.toLocaleTimeString()} (5m ago)`,
  );
  assert.equal(
    settingsSourceText({ source: 'cache', syncedAt: null }, now),
    "From the relay's copy",
  );
  assert.equal(
    settingsSourceText({ source: 'none', syncedAt: null }, now),
    'Never synced from the agent half — showing the defaults',
  );
});

test('a plain string field named like a credential gets the hint; other fields do not', () => {
  const plain = (key, label) => ({ key, label, type: 'string' });
  for (const key of ['apiKey', 'authToken', 'clientSecret', 'dbPassword', 'smtpPasswd']) {
    assert.equal(looksLikeCredential(plain(key, 'Value')), true, key);
  }
  assert.equal(looksLikeCredential(plain('credentialFile', 'File')), true);
  assert.equal(looksLikeCredential(plain('bearer', 'Bearer TOKEN')), true, 'by its label');
  assert.equal(looksLikeCredential({ key: 'apiKey', type: 'string' }), true, 'no label');
  assert.equal(looksLikeCredential(plain('region', 'Region')), false);
  assert.equal(looksLikeCredential({ key: 'endpoint', type: 'string' }), false);

  assert.equal(looksLikeCredential(field('apiKey')), false, 'a secret field is where it belongs');
  assert.equal(looksLikeCredential({ key: 'tokenLimit', label: 'Tokens', type: 'integer' }), false);
  assert.equal(looksLikeCredential({ key: 'keyType', label: 'Key type', type: 'enum' }), false);

  assert.equal(
    CREDENTIAL_HINT,
    'Stored on the relay and shown in clear — use a secret field for credentials.',
  );
});

test('a secret input is masked only where the page’s CSS says it can be — an error is no support', () => {
  const calls = [];
  const css = (answer) => ({
    supports: (...args) => {
      calls.push(args);
      return answer;
    },
  });
  assert.equal(secretMaskSupported(css(true)), true);
  assert.deepEqual(calls, [['-webkit-text-security', 'disc']]);
  assert.equal(secretMaskSupported(css(false)), false);
  assert.equal(secretMaskSupported(undefined), false);
  assert.equal(secretMaskSupported(null), false);
  assert.equal(secretMaskSupported({}), false);
  assert.equal(secretMaskSupported({ supports: 'yes' }), false);
  assert.equal(
    secretMaskSupported({
      supports: () => {
        throw new Error('not here');
      },
    }),
    false,
  );
});

test('a field’s type in words: its range, its options (five at most) and whether it is required', () => {
  assert.equal(fieldTypeText(field('apiKey')), 'secret, required');
  assert.equal(fieldTypeText(field('webhookToken')), 'secret');
  assert.equal(fieldTypeText(field('endpoint')), 'string, required');
  assert.equal(fieldTypeText(field('schedule')), 'string');
  assert.equal(fieldTypeText(field('verbose')), 'boolean');
  assert.equal(fieldTypeText(field('retries')), 'integer 0–10');
  assert.equal(fieldTypeText({ type: 'integer', min: 0 }), 'integer ≥ 0', 'a minimum of 0');
  assert.equal(fieldTypeText({ type: 'number', max: 1.5 }), 'number ≤ 1.5');
  assert.equal(
    fieldTypeText({ type: 'number', min: -1, max: 1, required: true }),
    'number -1–1, required',
  );
  assert.equal(fieldTypeText(field('ratio')), 'number');
  assert.equal(fieldTypeText(field('region')), 'enum: eu | us');

  const options = (n) => ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, n).map((value) => ({ value }));
  assert.equal(fieldTypeText({ type: 'enum', options: options(5) }), 'enum: a | b | c | d | e');
  assert.equal(fieldTypeText({ type: 'enum', options: options(6) }), 'enum: a | b | c | d | e | …');
});

test('an update’s schema diff becomes rows in a fixed order, with what each does to stored values', () => {
  assert.deepEqual(
    settingsDiffRows({
      secretToPlain: ['token'],
      newRequired: ['endpoint'],
      retyped: [{ key: 'token', from: 'secret', to: 'string' }],
      removed: [{ key: 'verbose', type: 'boolean' }],
      added: [{ key: 'endpoint', type: 'string' }],
    }),
    {
      rows: [
        { label: 'added', entries: ['endpoint (string)'], note: null },
        { label: 'removed', entries: ['verbose (boolean)'], note: 'their values are dropped' },
        {
          label: 'type changed',
          entries: ['token (secret → string)'],
          note: 'their values are dropped, not converted',
        },
        { label: 'newly required', entries: ['endpoint'], note: 'to be set after the update' },
      ],
      secretToPlain: ['token'],
    },
  );
  assert.deepEqual(
    settingsDiffRows({
      added: [
        { key: 'a', type: 'string' },
        { key: 'b', type: 'integer' },
      ],
      removed: [],
      retyped: [],
      newRequired: [],
      secretToPlain: [],
    }),
    {
      rows: [{ label: 'added', entries: ['a (string)', 'b (integer)'], note: null }],
      secretToPlain: [],
    },
    'empty rows are left out',
  );
});

test('no diff, an empty or a malformed one has no rows; a secret turned plain is warned of alone', () => {
  for (const diff of [null, undefined, 'diff', 42, {}]) {
    assert.equal(settingsDiffRows(diff), null, String(diff));
  }
  const empty = { added: [], removed: [], retyped: [], newRequired: [], secretToPlain: [] };
  assert.equal(settingsDiffRows(empty), null);
  assert.equal(settingsDiffRows({ added: 'endpoint', removed: { key: 'verbose' } }), null);
  assert.deepEqual(settingsDiffRows({ secretToPlain: ['token'] }), {
    rows: [],
    secretToPlain: ['token'],
  });
});

test('a diff row shows a field’s key and types — nothing else an entry carries', () => {
  const shown = settingsDiffRows({
    added: [{ key: 'endpoint', type: 'string', default: SECRET }],
    removed: [{ key: 'verbose', type: 'boolean', value: SECRET }],
    retyped: [{ key: 'token', from: 'secret', to: 'string', value: SECRET }],
    newRequired: ['endpoint'],
    secretToPlain: ['token'],
  });
  assert.deepEqual(
    shown.rows.map((row) => row.entries),
    [['endpoint (string)'], ['verbose (boolean)'], ['token (secret → string)'], ['endpoint']],
  );
  assert.equal(JSON.stringify(shown).includes(SECRET), false);
});
