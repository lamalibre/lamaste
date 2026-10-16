/**
 * Plugin settings (slice 4), the contract: the manifest's `settings` block,
 * update validation whose messages never carry a submitted value, the
 * configured status, effective values, the schema diff for an update's
 * preview, the wire parsers between the relay and the agent half, and
 * `callAgentHalf` — Lamaste's generic call to the agent half — against a
 * local HTTP server that verifies its caller assertion.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  validateManifest,
  ManifestValidationError,
  SettingsBlockSchema,
  SETTINGS_MAX_FIELDS,
  SETTINGS_DEFAULT_MAX_LENGTH,
  AGENT_HALF_SETTINGS_PATH,
  AGENT_HALF_SETTINGS_RELOAD_PATH,
  AGENT_HALF_SETTINGS_MAX_BYTES,
  validateSettingsUpdate,
  settingsStatus,
  effectiveSettingsValues,
  settingsSchemaDiff,
  parseAgentHalfSettingsState,
  parseAgentHalfSettingsUpdate,
  callAgentHalf,
  generateHostingSecret,
  verifyCallerAssertion,
  encryptSettingsSecret,
  NonceStore,
  CALLER_ASSERTION_HEADER,
  RESPONDER_HEADER,
  bodySha256Hex,
} from '@lamalibre/lamaste';
import { settingsFromManifest } from '@lamalibre/lamaste/agent';

/** Appears in submitted values only; no message, error or answer may contain it. */
const DISTINCT = 'Zq9-distinctive-VALUE-7731';

const agentBlock = {
  package: '@lamalibre/fx-agent',
  service: { entry: 'dist/agentd.js' },
};

const settings = {
  schemaVersion: 1,
  fields: [
    { key: 'apiKey', label: 'API key', type: 'secret', required: true, maxLength: 64 },
    { key: 'webhookToken', label: 'Webhook token', type: 'secret' },
    {
      key: 'schedule',
      label: 'Schedule',
      type: 'string',
      pattern: '^[0-9]{2}:[0-9]{2}$',
      default: '06:00',
      maxLength: 5,
    },
    { key: 'retries', label: 'Retries', type: 'integer', min: 0, max: 10, default: 3 },
    { key: 'ratio', label: 'Ratio', type: 'number', min: 0, max: 1 },
    {
      key: 'region',
      label: 'Region',
      type: 'enum',
      required: true,
      options: [
        { value: 'eu', label: 'Europe' },
        { value: 'us', label: 'United States' },
      ],
    },
    { key: 'verbose', label: 'Verbose', type: 'boolean' },
    { key: 'note', label: 'Note', type: 'string' },
  ],
};

const base = { name: 'fx', version: '1.0.0', hosting: 'agent', agent: agentBlock, settings };

function manifestError(extra) {
  try {
    validateManifest({ ...base, ...extra });
    return null;
  } catch (err) {
    assert.ok(err instanceof ManifestValidationError, String(err));
    return err.issues.map((e) => `${e.path}: ${e.message}`).join('\n');
  }
}

function blockError(block) {
  const result = SettingsBlockSchema.safeParse(block);
  if (result.success) return null;
  return result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
}

function withField(field) {
  return { schemaVersion: 1, fields: [field] };
}

// ---------------------------------------------------------------------------
// Manifest schema
// ---------------------------------------------------------------------------

test('manifest: a settings block with every field type validates beside the agent block', () => {
  const m = validateManifest(base);
  assert.equal(m.settings.schemaVersion, 1);
  assert.deepEqual(
    m.settings.fields.map((f) => f.type),
    ['secret', 'secret', 'string', 'integer', 'number', 'enum', 'boolean', 'string'],
  );
});

test('manifest: settings need an agent block', () => {
  assert.match(manifestError({ agent: undefined }), /^settings: settings needs an agent block$/m);
  // An agent-hosted plugin without an agent half, and a server plugin, alike.
  assert.match(
    manifestError({ agent: undefined, hosting: 'server' }),
    /^settings: settings needs an agent block$/m,
  );
  assert.equal(manifestError({ settings: undefined }), null);
});

test('schema: keys, labels, counts and versions', () => {
  const field = { key: 'note', label: 'Note', type: 'string' };
  assert.equal(blockError(withField(field)), null);
  assert.match(blockError(withField({ ...field, key: 'Note' })), /fields\.0\.key/);
  assert.match(blockError(withField({ ...field, key: 'a_b' })), /fields\.0\.key/);
  assert.match(blockError(withField({ ...field, key: `a${'b'.repeat(64)}` })), /fields\.0\.key/);
  assert.match(blockError(withField({ ...field, label: '' })), /fields\.0\.label/);
  assert.match(blockError(withField({ ...field, type: 'date' })), /fields\.0\.type/);
  assert.match(blockError(withField({ ...field, extra: 1 })), /Unrecognized key/);
  assert.match(blockError({ ...withField(field), schemaVersion: 0 }), /schemaVersion/);
  assert.match(blockError({ ...withField(field), schemaVersion: 1.5 }), /schemaVersion/);
  assert.match(blockError({ schemaVersion: 1, fields: [] }), /fields/);
  assert.match(blockError({ ...withField(field), extra: true }), /Unrecognized key/);
  const many = Array.from({ length: SETTINGS_MAX_FIELDS + 1 }, (_, i) => ({
    key: `f${i}`,
    label: `F${i}`,
    type: 'boolean',
  }));
  assert.match(blockError({ schemaVersion: 1, fields: many }), /^fields: /m);
  assert.equal(blockError({ schemaVersion: 1, fields: many.slice(0, SETTINGS_MAX_FIELDS) }), null);
  assert.match(
    blockError({ schemaVersion: 1, fields: [field, { ...field, label: 'Again' }] }),
    /fields\.1\.key: Setting "note" is declared twice/,
  );
});

test('schema: properties only on their types, and an enum needs options', () => {
  const s = { key: 'k', label: 'K', type: 'string' };
  const i = { key: 'k', label: 'K', type: 'integer' };
  assert.match(blockError(withField({ ...i, maxLength: 5 })), /fields\.0\.maxLength: .*only for/);
  assert.match(blockError(withField({ ...s, min: 1 })), /fields\.0\.min: .*only for/);
  assert.match(blockError(withField({ ...s, max: 1 })), /fields\.0\.max: .*only for/);
  assert.match(blockError(withField({ ...i, pattern: 'x' })), /fields\.0\.pattern: .*only for/);
  assert.match(
    blockError(withField({ key: 'k', label: 'K', type: 'secret', pattern: 'x' })),
    /fields\.0\.pattern: .*only for string/,
  );
  assert.match(
    blockError(withField({ ...s, options: [{ value: 'a', label: 'A' }] })),
    /fields\.0\.options: .*only for enum/,
  );
  assert.match(
    blockError(withField({ key: 'k', label: 'K', type: 'enum' })),
    /fields\.0\.options: An enum field needs "options"/,
  );
  assert.match(
    blockError(
      withField({
        key: 'k',
        label: 'K',
        type: 'enum',
        options: [
          { value: 'a', label: 'A' },
          { value: 'a', label: 'Again' },
        ],
      }),
    ),
    /fields\.0\.options\.1\.value: Option values must be unique/,
  );
  assert.match(blockError(withField({ ...i, min: 5, max: 1 })), /"min" is greater than "max"/);
  assert.match(blockError(withField({ ...s, maxLength: 4097 })), /fields\.0\.maxLength/);
  assert.match(blockError(withField({ ...s, maxLength: 0 })), /fields\.0\.maxLength/);
  assert.match(blockError(withField({ ...s, pattern: 'x'.repeat(257) })), /fields\.0\.pattern/);
  assert.equal(blockError(withField({ ...i, min: -5, max: 5 })), null);
});

test('schema: no default on a secret, a pattern must compile, a default must be a valid value', () => {
  assert.match(
    blockError(withField({ key: 'k', label: 'K', type: 'secret', default: 'x' })),
    /fields\.0\.default: A secret has no default/,
  );
  assert.match(
    blockError(withField({ key: 'k', label: 'K', type: 'string', pattern: '([a-z' })),
    /fields\.0\.pattern: "pattern" is not a valid regular expression/,
  );
  // Valid without the u flag, not with it.
  assert.match(
    blockError(withField({ key: 'k', label: 'K', type: 'string', pattern: '\\-' })),
    /fields\.0\.pattern/,
  );
  const bad = [
    { key: 'k', label: 'K', type: 'string', default: 7 },
    { key: 'k', label: 'K', type: 'string', maxLength: 3, default: 'abcd' },
    { key: 'k', label: 'K', type: 'string', default: 'x'.repeat(SETTINGS_DEFAULT_MAX_LENGTH + 1) },
    { key: 'k', label: 'K', type: 'integer', default: 1.5 },
    { key: 'k', label: 'K', type: 'integer', min: 0, max: 10, default: 11 },
    { key: 'k', label: 'K', type: 'number', min: 0, default: -0.5 },
    { key: 'k', label: 'K', type: 'boolean', default: 'true' },
    { key: 'k', label: 'K', type: 'enum', options: [{ value: 'a', label: 'A' }], default: 'b' },
  ];
  for (const field of bad) {
    assert.match(blockError(withField(field)), /fields\.0\.default: The default is not a valid/);
  }
  assert.equal(
    blockError(
      withField({ key: 'k', label: 'K', type: 'string', pattern: '^[0-9]+$', default: '12' }),
    ),
    null,
  );
  // The relay's schema never runs a manifest's pattern, not even on its own
  // default: the agent half checks that when it reads its manifest.
  const mismatched = { key: 'k', label: 'K', type: 'string', pattern: '^[0-9]+$', default: 'abc' };
  assert.equal(blockError(withField(mismatched)), null);
  assert.throws(
    () => settingsFromManifest({ settings: withField(mismatched) }),
    (err) =>
      err instanceof ManifestValidationError &&
      err.issues.some(
        (i) =>
          i.path === 'settings.fields.0.default' &&
          i.message === 'The default is not a valid value: Does not match the required format',
      ),
  );
});

// ---------------------------------------------------------------------------
// Update validation
// ---------------------------------------------------------------------------

const block = SettingsBlockSchema.parse(settings);
const RELAY = { checkPattern: false };
const HALF = { checkPattern: true };

test('update: valid values and secrets pass, null clears an optional field, empty is valid', () => {
  assert.deepEqual(validateSettingsUpdate(block, {}, RELAY), { ok: true, values: {}, secrets: {} });
  assert.deepEqual(validateSettingsUpdate(block, { values: {}, secrets: {} }, HALF), {
    ok: true,
    values: {},
    secrets: {},
  });
  const result = validateSettingsUpdate(
    block,
    {
      values: {
        schedule: '07:30',
        retries: 10,
        ratio: 0.25,
        region: 'us',
        verbose: false,
        note: '',
      },
      secrets: { apiKey: 'k-1', webhookToken: null },
    },
    HALF,
  );
  assert.deepEqual(result, {
    ok: true,
    values: { schedule: '07:30', retries: 10, ratio: 0.25, region: 'us', verbose: false, note: '' },
    secrets: { apiKey: 'k-1', webhookToken: null },
  });
  assert.deepEqual(validateSettingsUpdate(block, { values: { retries: null } }, RELAY), {
    ok: true,
    values: { retries: null },
    secrets: {},
  });
  // A required field with a default may go back to it: it keeps a value.
  const withDefault = {
    ...block,
    fields: block.fields.map((f) => (f.key === 'retries' ? { ...f, required: true } : f)),
  };
  assert.deepEqual(validateSettingsUpdate(withDefault, { values: { retries: null } }, RELAY), {
    ok: true,
    values: { retries: null },
    secrets: {},
  });
});

test('update: every rule has its message, and no message carries the submitted value', () => {
  const cases = [
    [{ values: { nope: DISTINCT } }, '_', '1 unknown setting'],
    [{ secrets: { nope: DISTINCT } }, '_', '1 unknown setting'],
    [{ values: { apiKey: DISTINCT } }, 'apiKey', 'Is a secret; send it in secrets'],
    [{ secrets: { note: DISTINCT } }, 'note', 'Is not a secret; send it in values'],
    [{ values: { region: null } }, 'region', 'Is required'],
    [{ secrets: { apiKey: null } }, 'apiKey', 'Is required'],
    [{ values: { note: 5 } }, 'note', 'Must be a string'],
    [{ values: { note: DISTINCT.repeat(50) } }, 'note', 'Must be at most 1024 characters'],
    [{ values: { schedule: DISTINCT } }, 'schedule', 'Must be at most 5 characters'],
    [{ values: { retries: DISTINCT } }, 'retries', 'Must be an integer'],
    [{ values: { retries: 1.5 } }, 'retries', 'Must be an integer'],
    [{ values: { retries: Number.MAX_SAFE_INTEGER + 1 } }, 'retries', 'Must be an integer'],
    [{ values: { retries: -1 } }, 'retries', 'Must be at least 0'],
    [{ values: { retries: 11 } }, 'retries', 'Must be at most 10'],
    [{ values: { ratio: Infinity } }, 'ratio', 'Must be a number'],
    [{ values: { ratio: NaN } }, 'ratio', 'Must be a number'],
    [{ values: { ratio: DISTINCT } }, 'ratio', 'Must be a number'],
    [{ values: { ratio: 1.5 } }, 'ratio', 'Must be at most 1'],
    [{ values: { verbose: DISTINCT } }, 'verbose', 'Must be true or false'],
    [{ values: { region: DISTINCT } }, 'region', 'Must be one of the options'],
    [{ values: { region: 3 } }, 'region', 'Must be one of the options'],
    [{ secrets: { apiKey: '' } }, 'apiKey', 'Must not be empty'],
    [{ secrets: { apiKey: 42 } }, 'apiKey', 'Must be a string'],
    [{ secrets: { apiKey: DISTINCT.repeat(3) } }, 'apiKey', 'Must be at most 64 characters'],
    [{ values: DISTINCT }, '_', '"values" must be an object'],
    [{ secrets: [DISTINCT] }, '_', '"secrets" must be an object'],
    [{ values: { [`bad key ${DISTINCT}`]: 1 } }, '_', '1 unknown setting'],
    [{ values: { [DISTINCT.toLowerCase().replace(/-/g, '')]: 1 } }, '_', '1 unknown setting'],
  ];
  for (const [input, key, message] of cases) {
    for (const opts of [RELAY, HALF]) {
      const result = validateSettingsUpdate(block, input, opts);
      assert.equal(result.ok, false, JSON.stringify(input));
      assert.equal(result.errors[key], message, JSON.stringify(input));
      assert.ok(!JSON.stringify(result).includes(DISTINCT), 'no value in the result');
    }
  }
  assert.deepEqual(validateSettingsUpdate(block, DISTINCT, RELAY), {
    ok: false,
    errors: { _: 'The update must be an object' },
  });
  // Several problems at once: one message per field.
  const several = validateSettingsUpdate(
    block,
    { values: { retries: 99, verbose: 'x', note: 'ok' }, secrets: { apiKey: '' } },
    HALF,
  );
  assert.deepEqual(Object.keys(several.errors).sort(), ['apiKey', 'retries', 'verbose']);
});

test('update: the pattern is checked only where checkPattern is set (never on the relay)', () => {
  const input = { values: { schedule: 'ab:cd' } };
  assert.equal(validateSettingsUpdate(block, input, RELAY).ok, true);
  const half = validateSettingsUpdate(block, input, HALF);
  assert.deepEqual(half, { ok: false, errors: { schedule: 'Does not match the required format' } });
  // A value of DISTINCT's shape that fits maxLength but not the pattern.
  const distinct = validateSettingsUpdate(block, { values: { schedule: 'Zq:97' } }, HALF);
  assert.ok(!JSON.stringify(distinct).includes('Zq:97'));
});

test('update: a submitted __proto__ is an unknown setting, not a prototype', () => {
  const input = JSON.parse(`{"values": {"__proto__": {"polluted": "${DISTINCT}"}}}`);
  const result = validateSettingsUpdate(block, input, HALF);
  assert.equal(result.ok, false);
  assert.equal(result.errors._, '1 unknown setting');
  assert.equal({}.polluted, undefined);
  assert.ok(!JSON.stringify(result).includes(DISTINCT));
});

// ---------------------------------------------------------------------------
// Status, effective values, schema diff
// ---------------------------------------------------------------------------

test('status: required secrets must be set; required values need a stored value or a default', () => {
  assert.deepEqual(settingsStatus(block, { values: {}, secretsSet: [] }), {
    configured: false,
    missing: ['apiKey', 'region'],
  });
  assert.deepEqual(settingsStatus(block, { values: { region: 'eu' }, secretsSet: ['apiKey'] }), {
    configured: true,
    missing: [],
  });
  // A stored value no longer valid for the field does not count.
  assert.deepEqual(
    settingsStatus(block, { values: { region: 'mars' }, secretsSet: ['apiKey'] }).missing,
    ['region'],
  );
  // A required field with a default is configured without a stored value.
  const withDefault = SettingsBlockSchema.parse(
    withField({ key: 'k', label: 'K', type: 'integer', required: true, default: 1 }),
  );
  assert.deepEqual(settingsStatus(withDefault, { values: {}, secretsSet: [] }), {
    configured: true,
    missing: [],
  });
});

test('effective values: defaults overlaid by stored values the schema knows, never a secret', () => {
  assert.deepEqual(effectiveSettingsValues(block, {}), { schedule: '06:00', retries: 3 });
  assert.deepEqual(
    effectiveSettingsValues(block, {
      retries: 5,
      region: 'eu',
      verbose: true,
      note: 'hi',
      unknown: 'dropped',
      apiKey: DISTINCT, // a secret's key among the values is never passed on
      ratio: 'wrong type',
      schedule: 12,
    }),
    { schedule: '06:00', retries: 5, region: 'eu', verbose: true, note: 'hi' },
  );
  // Out of range: the default stands.
  assert.deepEqual(effectiveSettingsValues(block, { retries: 99 }).retries, 3);
});

test('schema diff: added, removed, retyped, and the fields an update newly requires', () => {
  const v1 = SettingsBlockSchema.parse({
    schemaVersion: 1,
    fields: [
      { key: 'apiKey', label: 'API key', type: 'secret', required: true },
      { key: 'retries', label: 'Retries', type: 'integer', required: true, default: 3 },
      { key: 'gone', label: 'Gone', type: 'boolean' },
      { key: 'region', label: 'Region', type: 'string' },
      { key: 'mode', label: 'Mode', type: 'string', required: true },
      { key: 'label', label: 'Label', type: 'string', required: true, default: 'x' },
    ],
  });
  const v2 = SettingsBlockSchema.parse({
    schemaVersion: 2,
    fields: [
      { key: 'apiKey', label: 'API key', type: 'secret', required: true },
      { key: 'retries', label: 'Retries', type: 'string', required: true },
      { key: 'region', label: 'Region', type: 'string', required: true },
      { key: 'mode', label: 'Mode', type: 'string', required: true },
      { key: 'label', label: 'Label', type: 'string', required: true },
      { key: 'endpoint', label: 'Endpoint', type: 'string', required: true },
      { key: 'extra', label: 'Extra', type: 'boolean' },
    ],
  });
  assert.deepEqual(settingsSchemaDiff(v1, v2), {
    added: [
      { key: 'endpoint', type: 'string' },
      { key: 'extra', type: 'boolean' },
    ],
    removed: [{ key: 'gone', type: 'boolean' }],
    retyped: [{ key: 'retries', from: 'integer', to: 'string' }],
    // retries: retyped; region: was optional; label: had a default; endpoint: new.
    newRequired: ['retries', 'region', 'label', 'endpoint'],
    secretToPlain: [],
  });
  const v1Fields = v1.fields.map((f) => ({ key: f.key, type: f.type }));
  assert.deepEqual(settingsSchemaDiff(null, v1), {
    added: v1Fields,
    removed: [],
    retyped: [],
    newRequired: ['apiKey', 'mode'],
    secretToPlain: [],
  });
  assert.deepEqual(settingsSchemaDiff(v1, null), {
    added: [],
    removed: v1Fields,
    retyped: [],
    newRequired: [],
    secretToPlain: [],
  });
  const none = { added: [], removed: [], retyped: [], newRequired: [], secretToPlain: [] };
  assert.deepEqual(settingsSchemaDiff(null, null), none);
  assert.deepEqual(settingsSchemaDiff(v1, v1), none);
});

test('schema diff: a secret that becomes a plain value is named in secretToPlain', () => {
  const v1 = SettingsBlockSchema.parse({
    schemaVersion: 1,
    fields: [
      { key: 'apiKey', label: 'API key', type: 'secret' },
      { key: 'token', label: 'Token', type: 'secret' },
      { key: 'note', label: 'Note', type: 'string' },
    ],
  });
  const v2 = SettingsBlockSchema.parse({
    schemaVersion: 2,
    fields: [
      { key: 'apiKey', label: 'API key', type: 'string' },
      { key: 'token', label: 'Token', type: 'secret' },
      { key: 'note', label: 'Note', type: 'secret' },
    ],
  });
  const diff = settingsSchemaDiff(v1, v2);
  assert.deepEqual(diff.retyped, [
    { key: 'apiKey', from: 'secret', to: 'string' },
    { key: 'note', from: 'string', to: 'secret' },
  ]);
  // Plain to secret is safe (the value is dropped); only secret to plain is named.
  assert.deepEqual(diff.secretToPlain, ['apiKey']);
});

// ---------------------------------------------------------------------------
// Wire parsers
// ---------------------------------------------------------------------------

const state = {
  schemaVersion: 1,
  revision: 4,
  values: { retries: 5, verbose: true, note: 'x' },
  secrets: { apiKey: { setAt: '2026-10-16T10:00:00.000Z' } },
  configured: false,
  missing: ['region'],
};

test('state parser: a valid state round-trips; anything beyond the contract is dropped', () => {
  assert.deepEqual(parseAgentHalfSettingsState(state), state);
  const leaky = {
    ...state,
    extra: 1,
    secrets: { apiKey: { setAt: '2026-10-16T10:00:00.000Z', value: DISTINCT } },
  };
  const parsed = parseAgentHalfSettingsState(leaky);
  assert.deepEqual(parsed, state);
  assert.ok(!JSON.stringify(parsed).includes(DISTINCT));
  assert.deepEqual(parseAgentHalfSettingsState({ ...state, revision: 0 }).revision, 0);
});

test('state parser: any shape error is null', () => {
  for (const bad of [
    null,
    [],
    'x',
    { ...state, schemaVersion: 0 },
    { ...state, revision: -1 },
    { ...state, revision: 1.5 },
    { ...state, configured: 'yes' },
    { ...state, values: [] },
    { ...state, values: { 'bad key': 1 } },
    { ...state, values: { a: { nested: true } } },
    { ...state, values: { a: null } },
    { ...state, values: { a: 'x'.repeat(4097) } },
    { ...state, secrets: { apiKey: 'set' } },
    { ...state, secrets: { apiKey: {} } },
    { ...state, secrets: { apiKey: { setAt: '' } } },
    { ...state, secrets: { apiKey: { setAt: `2026-10-16T10:00:00.000Z ${DISTINCT}` } } },
    { ...state, secrets: { apiKey: { setAt: '2026-10-16 10:00:00' } } },
    { ...state, secrets: { apiKey: { setAt: '2026-10-16T10:00:00.000+02:00' } } },
    { ...state, secrets: { apiKey: { setAt: '2026-13-45T10:00:00.000Z' } } },
    { ...state, secrets: { apiKey: { setAt: 'yesterday' } } },
    { ...state, missing: 'region' },
    { ...state, missing: [1] },
    { ...state, missing: undefined },
  ]) {
    assert.equal(parseAgentHalfSettingsState(bad), null, JSON.stringify(bad));
  }
});

test('update parser: the envelope only; values are checked by validateSettingsUpdate', () => {
  const sealed = encryptSettingsSecret({
    secret: generateHostingSecret(),
    plugin: 'fx',
    nonce: 'a'.repeat(32),
    key: 'apiKey',
    baseRevision: 0,
    value: 'k',
  });
  const update = {
    schemaVersion: 1,
    baseRevision: 0,
    values: { retries: 4, note: null },
    secrets: { apiKey: sealed, webhookToken: null },
  };
  assert.deepEqual(parseAgentHalfSettingsUpdate(update), update);
  // A value of the wrong type for its field still parses — the store answers 422.
  assert.ok(parseAgentHalfSettingsUpdate({ ...update, values: { retries: 'x' } }));
  for (const bad of [
    null,
    { ...update, schemaVersion: 0 },
    { ...update, baseRevision: -1 },
    { ...update, values: undefined },
    { ...update, secrets: undefined },
    { ...update, values: { retries: { n: 1 } } },
    { ...update, values: { 'not a key': 1 } },
    { ...update, secrets: { apiKey: 5 } },
    // A secret in clear is not an update any more: it travels sealed.
    { ...update, secrets: { apiKey: 'k' } },
    { ...update, secrets: { apiKey: { ...sealed, v: 2 } } },
    { ...update, secrets: { apiKey: { ...sealed, extra: 1 } } },
    { ...update, secrets: { apiKey: { ...sealed, iv: sealed.iv.slice(1) } } },
    { ...update, secrets: { apiKey: { ...sealed, ct: 'AAAA' } } },
    { ...update, secrets: { apiKey: { ...sealed, ct: `${sealed.ct}=` } } },
    { ...update, secrets: { apiKey: { ...sealed, ct: 'A'.repeat(20_000) } } },
    { ...update, secrets: { Bad: sealed } },
  ]) {
    assert.equal(parseAgentHalfSettingsUpdate(bad), null, JSON.stringify(bad));
  }
});

test('paths and limits', () => {
  assert.equal(AGENT_HALF_SETTINGS_PATH, '/admin/settings');
  assert.equal(AGENT_HALF_SETTINGS_RELOAD_PATH, '/admin/settings/reload');
  assert.equal(AGENT_HALF_SETTINGS_MAX_BYTES, 2 * 1024 * 1024);
});

// ---------------------------------------------------------------------------
// callAgentHalf
// ---------------------------------------------------------------------------

const PLUGIN = 'fx';
let secret;
let server;
let port;
let seen;

function listen(srv) {
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

before(async () => {
  secret = generateHostingSecret();
  const nonces = new NonceStore();
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const verified = verifyCallerAssertion(req.headers[CALLER_ASSERTION_HEADER], {
        secrets: [secret],
        plugin: PLUGIN,
        method: req.method,
        path: req.url,
        nonces,
      });
      seen = {
        method: req.method,
        url: req.url,
        verified,
        contentType: req.headers['content-type'] ?? null,
        body: Buffer.concat(chunks).toString('utf-8'),
      };
      const url = new URL(req.url, 'http://127.0.0.1');
      // The agent half's answer, authenticated over its exact body.
      const send = (status, text, type = 'application/json') => {
        const headers = type ? { 'content-type': type } : {};
        if (verified.ok) headers[RESPONDER_HEADER] = verified.responder(status, text);
        res.writeHead(status, headers);
        res.end(text);
      };
      if (url.pathname === '/admin/json') {
        send(Number(url.searchParams.get('status') ?? 200), JSON.stringify({ answered: true }));
      } else if (url.pathname === '/admin/empty') {
        send(204, '', null);
      } else if (url.pathname === '/admin/text') {
        send(200, 'not json', 'text/plain');
      } else if (url.pathname === '/admin/big') {
        send(200, JSON.stringify({ pad: 'x'.repeat(4096) }));
      } else if (url.pathname === '/admin/hang') {
        // Never answers.
      } else {
        send(404, JSON.stringify({ error: 'Not found' }));
      }
    });
  });
  port = await listen(server);
});

after(() => {
  server?.closeAllConnections?.();
  server?.close();
});

function call(overrides) {
  return callAgentHalf({
    plugin: PLUGIN,
    port,
    secret,
    method: 'GET',
    path: '/admin/json',
    timeoutMs: 2_000,
    maxResponseBytes: 1024,
    ...overrides,
  });
}

test('callAgentHalf: signs as Lamaste over method, path and body; sends the body as JSON', async () => {
  const result = await call({ method: 'PUT', path: '/admin/json?x=1', body: { secret: DISTINCT } });
  assert.deepEqual(result, { ok: true, status: 200, body: { answered: true } });
  assert.equal(seen.verified.ok, true, JSON.stringify(seen.verified));
  assert.deepEqual(seen.verified.payload.caller, { type: 'lamaste' });
  assert.equal(seen.verified.payload.method, 'PUT');
  assert.equal(seen.verified.payload.path, '/admin/json?x=1');
  assert.equal(seen.verified.payload.bodySha256, bodySha256Hex(seen.body));
  assert.equal(seen.contentType, 'application/json');
  assert.deepEqual(JSON.parse(seen.body), { secret: DISTINCT });

  // No body: nothing sent, no content type, no body hash.
  await call({});
  assert.equal(seen.body, '');
  assert.equal(seen.contentType, null);
  assert.equal(seen.verified.payload.bodySha256, undefined);

  // A body function is handed the assertion's nonce before anything is signed.
  let handed = null;
  await call({
    method: 'PUT',
    body: (nonce) => {
      handed = nonce;
      return { bound: nonce };
    },
  });
  assert.match(handed, /^[a-f0-9]{32}$/);
  assert.equal(seen.verified.payload.nonce, handed);
  assert.deepEqual(JSON.parse(seen.body), { bound: handed });
});

test('callAgentHalf: any status passes through; empty or non-JSON bodies are null', async () => {
  assert.deepEqual(await call({ path: '/admin/json?status=422' }), {
    ok: true,
    status: 422,
    body: { answered: true },
  });
  assert.deepEqual(await call({ path: '/admin/json?status=500' }), {
    ok: true,
    status: 500,
    body: { answered: true },
  });
  assert.deepEqual(await call({ path: '/admin/nothing' }), {
    ok: true,
    status: 404,
    body: { error: 'Not found' },
  });
  assert.deepEqual(await call({ path: '/admin/empty' }), { ok: true, status: 204, body: null });
  assert.deepEqual(await call({ path: '/admin/text' }), { ok: true, status: 200, body: null });
});

test('callAgentHalf: refused, timeout and oversize are failures that never carry the body', async () => {
  // A port something answered on a moment ago, and nothing does now.
  const closed = http.createServer();
  const closedPort = await listen(closed);
  await new Promise((r) => closed.close(r));

  const refused = await call({ port: closedPort, method: 'PUT', body: { s: DISTINCT } });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'refused');

  const started = Date.now();
  const timeout = await call({
    path: '/admin/hang',
    method: 'POST',
    body: { s: DISTINCT },
    timeoutMs: 150,
  });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.code, 'timeout');
  assert.ok(Date.now() - started < 2_000);

  const big = await call({ path: '/admin/big', method: 'PUT', body: { s: DISTINCT } });
  assert.equal(big.ok, false);
  assert.equal(big.code, 'invalid');
  assert.match(big.error, /too large/);

  for (const failure of [refused, timeout, big]) {
    assert.ok(!JSON.stringify(failure).includes(DISTINCT));
  }
});

test('callAgentHalf: only paths under /admin/, only its methods, only a well-formed secret', () => {
  for (const path of [
    '/app/x',
    '/admin',
    'admin/x',
    '/adminx/y',
    '/admin/../app/x',
    '/admin/%2e%2e/app/x',
    '/admin/a/./b',
    '/admin/%E0%A4%A',
  ]) {
    assert.throws(() => call({ path }), /under \/admin\//, path);
  }
  assert.throws(() => call({ method: 'PATCH' }), /GET, PUT, POST or DELETE/);
  assert.throws(() => call({ secret: 'short' }), /installation secret/);
});
