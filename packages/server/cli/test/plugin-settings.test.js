/**
 * `lamaste-server plugins settings|configure`: the flags become the partial
 * update the panel takes (`{ revision, values?, secrets? }`) — values parsed
 * by their field's type, a secret refused on the command line, `--clear` as
 * `null`, the secrets read on stdin — and nothing a secret could be in (an
 * error, a summary, curl's command line) ever holds it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import {
  buildSettingsUpdate,
  describeChanges,
  fieldNote,
  fieldValueText,
  hostingText,
  parseConfigureArgs,
  parseSecretsJson,
  parseTextAnswer,
  settingsReadOnlyReason,
  settingsRefusal,
  settingsSourceText,
  updateSummary,
} from '../src/plugin-settings.js';
import { configureWithFlags, readStdinText } from '../src/commands/plugin-settings.js';
import { curlPanelRequest } from '../src/panel-api.js';
import { standInPanel } from './stand-in-panel.js';

const SECRET = 'sk-live-0123456789abcdefSECRET';
const NOW = Date.parse('2026-10-16T12:00:00.000Z');

const FIELDS = [
  { key: 'apiKey', label: 'API key', type: 'secret', required: true },
  { key: 'webhookToken', label: 'Webhook token', type: 'secret', maxLength: 64 },
  {
    key: 'schedule',
    label: 'Schedule',
    type: 'string',
    pattern: '^[0-9*/ ,-]+$',
    default: '0 * * * *',
  },
  { key: 'retries', label: 'Retries', type: 'integer', min: 0, max: 10, default: 3 },
  { key: 'ratio', label: 'Ratio', type: 'number', min: 0, max: 1 },
  {
    key: 'region',
    label: 'Region',
    type: 'enum',
    options: [
      { value: 'eu', label: 'Europe' },
      { value: 'us', label: 'United States' },
    ],
  },
  { key: 'verbose', label: 'Verbose', type: 'boolean' },
  { key: 'endpoint', label: 'Endpoint', type: 'string', required: true, maxLength: 20 },
];

const HOSTING_UP = {
  agentLabel: 'vm1',
  phase: 'active',
  state: 'up',
  reason: null,
  since: '2026-10-16T11:00:00.000Z',
  agentLastSeenAt: '2026-10-16T11:59:40.000Z',
};

function view(overrides = {}) {
  return {
    schemaVersion: 2,
    fields: FIELDS,
    values: {
      apiKey: { set: true, setAt: '2026-10-15T08:00:00.000Z' },
      webhookToken: { set: false },
      schedule: '0 * * * *',
      retries: 3,
      endpoint: 'https://a.example',
    },
    configured: true,
    missing: [],
    revision: 4,
    source: 'live',
    syncedAt: '2026-10-16T11:59:59.000Z',
    hosting: HOSTING_UP,
    ...overrides,
  };
}

/** Every message of a result, joined — to check that no value is in any. */
function messagesOf(result) {
  return JSON.stringify(result.ok ? {} : result.errors);
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

test('configure: the plugin name, --set, --clear and --secrets-stdin in any order and form', () => {
  assert.deepEqual(
    parseConfigureArgs([
      '--set',
      'retries=5',
      'fx',
      '--set=schedule=*/5 * * * *',
      '--clear',
      'region',
      '--clear=webhookToken',
      '--secrets-stdin',
      '--set',
      'endpoint=a=b',
    ]),
    {
      ok: true,
      name: 'fx',
      sets: [
        { key: 'retries', raw: '5' },
        { key: 'schedule', raw: '*/5 * * * *' },
        { key: 'endpoint', raw: 'a=b' },
      ],
      clears: ['region', 'webhookToken'],
      secretsStdin: true,
    },
  );
  assert.deepEqual(parseConfigureArgs(['fx']), {
    ok: true,
    name: 'fx',
    sets: [],
    clears: [],
    secretsStdin: false,
  });
});

test('configure: malformed arguments are refused without repeating them', () => {
  assert.match(parseConfigureArgs([]).error, /^Usage: lamaste-server plugins configure <name>/);
  for (const args of [
    ['fx', '--set'],
    ['fx', '--set', SECRET],
    ['fx', '--set', `=${SECRET}`],
    ['fx', '--set', `${SECRET}=x`],
    ['fx', `--set=${SECRET}`],
    ['fx', '--clear'],
    ['fx', '--clear', SECRET],
    ['fx', SECRET],
    ['fx', `-${SECRET}`],
  ]) {
    const parsed = parseConfigureArgs(args);
    assert.equal(parsed.ok, false, args.join(' '));
    assert.ok(!parsed.error.includes(SECRET), `"${parsed.error}" repeats an argument`);
  }
  assert.match(parseConfigureArgs(['fx', '--frobnicate']).error, /^Unknown option --frobnicate/);
});

test('--secrets-stdin: one JSON object; a parse failure does not quote what it read', () => {
  assert.deepEqual(parseSecretsJson(`{"apiKey":"${SECRET}","webhookToken":null}`), {
    ok: true,
    secrets: { apiKey: SECRET, webhookToken: null },
  });
  for (const text of [`${SECRET}`, `{"apiKey":"${SECRET}"`, '', `"${SECRET}"`, '[1]', 'null']) {
    const parsed = parseSecretsJson(text);
    assert.equal(parsed.ok, false);
    assert.ok(!parsed.error.includes(SECRET));
  }
});

test('stdin is read in full up to the limit, and refused beyond it without its content', async () => {
  assert.equal(
    await readStdinText(
      Readable.from([Buffer.from('{"apiKey":'), Buffer.from(`"${SECRET}"}`)]),
      1024,
    ),
    `{"apiKey":"${SECRET}"}`,
  );
  await assert.rejects(
    readStdinText(Readable.from([Buffer.from(SECRET.repeat(100))]), 1024),
    (err) => {
      assert.equal(err.message, 'stdin holds more than 1 KiB');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// The update
// ---------------------------------------------------------------------------

test('--set parses each value by its field type; --clear sends null; stdin secrets go to secrets', () => {
  const built = buildSettingsUpdate(view(), {
    sets: [
      { key: 'retries', raw: ' 7 ' },
      { key: 'ratio', raw: '0.25' },
      { key: 'verbose', raw: 'yes' },
      { key: 'region', raw: 'us' },
      { key: 'schedule', raw: '*/5 * * * *' },
    ],
    clears: ['webhookToken'],
    secrets: { apiKey: SECRET },
  });
  assert.deepEqual(built, {
    ok: true,
    body: {
      revision: 4,
      values: { retries: 7, ratio: 0.25, verbose: true, region: 'us', schedule: '*/5 * * * *' },
      secrets: { webhookToken: null, apiKey: SECRET },
    },
  });
  assert.deepEqual(updateSummary(built.body), {
    changed: ['retries', 'ratio', 'verbose', 'region', 'schedule'],
    cleared: [],
    secretsSet: ['apiKey'],
    secretsCleared: ['webhookToken'],
  });

  const cleared = buildSettingsUpdate(view(), { clears: ['retries', 'region'] });
  assert.deepEqual(cleared.body, { revision: 4, values: { retries: null, region: null } });
  for (const word of ['false', 'No', 'OFF']) {
    assert.equal(
      buildSettingsUpdate(view(), { sets: [{ key: 'verbose', raw: word }] }).body.values.verbose,
      false,
    );
  }
});

test('a secret is refused on the command line, pointing to stdin or the prompts, never repeating it', () => {
  const built = buildSettingsUpdate(view(), { sets: [{ key: 'apiKey', raw: SECRET }] });
  assert.equal(built.ok, false);
  assert.match(built.errors.apiKey, /^Is a secret — never on the command line/);
  assert.match(built.errors.apiKey, /--secrets-stdin/);
  assert.match(built.errors.apiKey, /without flags/);
  assert.ok(!messagesOf(built).includes(SECRET));
});

test('a value that is not one of its field is refused by key, with no value in the message', () => {
  const cases = [
    ['retries', 'abc', 'Must be an integer'],
    ['retries', '0x10', 'Must be an integer'],
    ['retries', '2.5', 'Must be an integer'],
    ['retries', '11', 'Must be at most 10'],
    ['retries', '-1', 'Must be at least 0'],
    ['retries', '99999999999999999999', 'Must be an integer'],
    ['ratio', 'half', 'Must be a number'],
    ['ratio', '1e999', 'Must be a number'],
    ['ratio', '1.5', 'Must be at most 1'],
    ['verbose', 'maybe', 'Must be true or false'],
    ['region', 'mars', 'Must be one of: eu, us'],
    ['endpoint', 'x'.repeat(21), 'Must be at most 20 characters'],
    ['retries', '', 'Is empty — use --clear to put it back to its default'],
    ['endpoint', '', 'Is empty — this setting needs a value'],
    ['nope', '1', 'Unknown setting'],
  ];
  for (const [key, raw, message] of cases) {
    const built = buildSettingsUpdate(view(), { sets: [{ key, raw }] });
    assert.equal(built.ok, false, `${key}=${raw}`);
    assert.equal(built.errors[key], message, `${key}=${raw}`);
  }
  // A string's pattern is left to the agent half (the relay never runs a plugin's regex).
  assert.equal(
    buildSettingsUpdate(view(), { sets: [{ key: 'schedule', raw: 'not a schedule' }] }).ok,
    true,
  );
});

test('--clear of a field that must keep a value is refused; a key may be named once', () => {
  const built = buildSettingsUpdate(view(), { clears: ['apiKey', 'endpoint', 'nope'] });
  assert.deepEqual(built, {
    ok: false,
    errors: { nope: 'Unknown setting', apiKey: 'Is required', endpoint: 'Is required' },
  });
  const twice = buildSettingsUpdate(view(), {
    sets: [{ key: 'retries', raw: '1' }],
    clears: ['retries', 'webhookToken'],
    secrets: { webhookToken: SECRET },
  });
  assert.deepEqual(twice.errors, {
    retries: 'Given more than once',
    webhookToken: 'Given more than once',
  });
});

test('the secrets on stdin: only secret keys, strings or null, checked like any value', () => {
  const built = buildSettingsUpdate(view(), {
    secrets: {
      retries: SECRET,
      webhookToken: SECRET.repeat(3),
      apiKey: '',
      nope: SECRET,
      'not a key': SECRET,
    },
  });
  assert.deepEqual(built, {
    ok: false,
    errors: {
      retries: 'Is not a secret — give it with --set',
      nope: 'Unknown setting',
      _: 'A key on stdin is not a setting name',
      webhookToken: 'Must be at most 64 characters',
      apiKey: 'Must not be empty',
    },
  });
  assert.ok(!messagesOf(built).includes(SECRET));
  assert.deepEqual(buildSettingsUpdate(view(), { secrets: { apiKey: 42 } }).errors, {
    apiKey: 'Must be a string, or null to clear it',
  });
  assert.deepEqual(buildSettingsUpdate(view(), { secrets: { apiKey: null } }).errors, {
    apiKey: 'Is required',
  });
});

test('an interactive text answer: empty puts the field back to its default, else parsed and checked', () => {
  const v = view();
  const field = (key) => FIELDS.find((f) => f.key === key);
  assert.deepEqual(parseTextAnswer(v, field('retries'), ''), { ok: true, value: null });
  assert.deepEqual(parseTextAnswer(v, field('retries'), '8'), { ok: true, value: 8 });
  assert.deepEqual(parseTextAnswer(v, field('retries'), '80'), {
    ok: false,
    message: 'Must be at most 10',
  });
  assert.deepEqual(parseTextAnswer(v, field('endpoint'), ''), {
    ok: false,
    message: 'Needs a value',
  });
});

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

test('a view in words: a secret only as set or not set, a field by what it is', () => {
  const v = view();
  const field = (key) => FIELDS.find((f) => f.key === key);
  assert.equal(fieldValueText(field('apiKey'), v.values.apiKey), 'set 2026-10-15T08:00:00.000Z');
  assert.equal(fieldValueText(field('webhookToken'), v.values.webhookToken), 'not set');
  assert.equal(fieldValueText(field('schedule'), v.values.schedule), '"0 * * * *"');
  assert.equal(fieldValueText(field('region'), 'eu'), 'eu (Europe)');
  assert.equal(fieldValueText(field('verbose'), undefined), 'not set');
  assert.equal(fieldNote(field('retries')), 'Retries · 0..10 · default 3');
  assert.equal(fieldNote(field('apiKey')), 'API key · required');
  assert.equal(fieldNote(field('region')), 'Region · eu | us');
});

test('the change summary names a secret as set, replaced or cleared — never its value', () => {
  const lines = describeChanges(view(), {
    revision: 4,
    values: { retries: 5, schedule: null },
    secrets: { apiKey: SECRET, webhookToken: SECRET },
  });
  assert.deepEqual(lines, [
    'apiKey: replaced',
    'webhookToken: set',
    'schedule: "0 * * * *" → the default, "0 * * * *"',
    'retries: 3 → 5',
  ]);
  assert.ok(!lines.join('\n').includes(SECRET));
});

test("the hosting in the panel's words, and when the settings cannot be changed", () => {
  assert.deepEqual(hostingText(HOSTING_UP, NOW), {
    offline: false,
    text: 'Hosted on agent vm1, up since 2026-10-16T11:00:00.000Z (1h ago)',
  });
  const offline = {
    ...HOSTING_UP,
    state: 'down',
    reason: 'tunnel',
    since: '2026-10-16T11:48:00.000Z',
  };
  assert.deepEqual(hostingText(offline, NOW), {
    offline: true,
    text: 'Hosting agent vm1 is offline since 2026-10-16T11:48:00.000Z (12m ago) — last sync 2026-10-16T11:59:40.000Z (20s ago)',
  });
  assert.equal(
    hostingText({ ...offline, agentLastSeenAt: null }, NOW).text,
    'Hosting agent vm1 is offline since 2026-10-16T11:48:00.000Z (12m ago) — no sync recorded',
  );
  assert.equal(
    hostingText({ ...offline, reason: 'app' }, NOW).text,
    'The agent half is not responding since 2026-10-16T11:48:00.000Z (12m ago)',
  );

  assert.equal(settingsReadOnlyReason(view(), NOW), null);
  // Health unknown: the panel's own call decides (it accepts a change unless the hosting is down).
  assert.equal(
    settingsReadOnlyReason(view({ hosting: { ...HOSTING_UP, state: 'unknown' } }), NOW),
    null,
  );
  assert.deepEqual(settingsReadOnlyReason(view({ hosting: offline }), NOW), {
    code: 'hosting_offline',
    message:
      'Hosting agent vm1 is offline since 2026-10-16T11:48:00.000Z (12m ago) — last sync 2026-10-16T11:59:40.000Z (20s ago) — the settings can be changed when it is back',
  });
  assert.equal(settingsReadOnlyReason(view({ hosting: null }), NOW).code, 'hosting_offline');
  assert.match(
    settingsReadOnlyReason(view({ hosting: { ...HOSTING_UP, phase: 'installing' } }), NOW).message,
    /^The hosting on vm1 is being set up — the settings can be changed once it is active$/,
  );
  assert.deepEqual(settingsReadOnlyReason(view({ revision: null, source: 'none' }), NOW), {
    code: 'settings_not_read',
    message: 'The settings could not be read from the agent half yet — try again in a moment',
  });

  assert.equal(settingsSourceText(view(), NOW), 'Read from the agent half');
  assert.equal(
    settingsSourceText(view({ source: 'cache', syncedAt: '2026-10-16T11:00:00.000Z' }), NOW),
    "From the relay's copy, synced from the agent half 2026-10-16T11:00:00.000Z (1h ago)",
  );
  assert.equal(
    settingsSourceText(view({ source: 'none', syncedAt: null }), NOW),
    'Never synced from the agent half — showing the defaults',
  );
});

test('a refusal says what to do: each field, a stale revision, an offline hosting', () => {
  const invalid = Object.assign(new Error('Invalid settings'), {
    errors: { schedule: 'Does not match the required format', _: 'Something about the whole' },
  });
  assert.deepEqual(settingsRefusal(invalid, 'fx', NOW).details, [
    'schedule: Does not match the required format',
    'Something about the whole',
  ]);
  const stale = Object.assign(new Error('changed'), { code: 'revision_mismatch', revision: 5 });
  assert.match(settingsRefusal(stale, 'fx', NOW).details[0], /changed since they were read.*again/);
  const offline = Object.assign(new Error('offline'), {
    code: 'hosting_offline',
    hosting: { ...HOSTING_UP, state: 'down', reason: 'app', since: '2026-10-16T11:59:00.000Z' },
  });
  assert.deepEqual(settingsRefusal(offline, 'fx', NOW).details, [
    'The agent half is not responding since 2026-10-16T11:59:00.000Z (1m ago).',
  ]);
});

// ---------------------------------------------------------------------------
// A run through curl
// ---------------------------------------------------------------------------

test("configure: a secret read on stdin reaches the panel in the body, never on curl's command line", async () => {
  const saved = view({
    revision: 5,
    values: {
      ...view().values,
      retries: 5,
      apiKey: { set: true, setAt: '2026-10-16T12:00:00.000Z' },
    },
  });
  const panel = await standInPanel((req) =>
    req.method === 'GET'
      ? { status: 200, body: JSON.stringify(view()) }
      : { status: 200, body: JSON.stringify(saved) },
  );
  // curl's private config directories go into a temporary directory of this
  // test's own: the test files run in parallel, and another one watches the
  // shared one for directories left behind.
  const sharedTmp = process.env.TMPDIR;
  const ownTmp = await mkdtemp(path.join(tmpdir(), 'lamaste-cli-settings-test-'));
  process.env.TMPDIR = ownTmp;
  try {
    const stdin = Readable.from([Buffer.from(JSON.stringify({ apiKey: SECRET }))]);
    const read = parseSecretsJson(await readStdinText(stdin, 256 * 1024));
    assert.equal(read.ok, true);
    const request = (method, path, body) =>
      curlPanelRequest({
        panelUrl: panel.panelUrl,
        method,
        path,
        body,
        p12Path: '/nonexistent/client.p12',
        p12Password: 'p12-password-SECRET',
      });

    const result = await configureWithFlags(
      'fx',
      { sets: [{ key: 'retries', raw: '5' }], clears: [], secrets: read.secrets },
      { request, now: () => NOW },
    );
    assert.equal(result.state, 'saved');
    assert.deepEqual(result.after, saved);

    assert.deepEqual(
      panel.seen.map((r) => [r.method, r.url]),
      [
        ['GET', '/api/plugins/fx/settings'],
        ['PUT', '/api/plugins/fx/settings'],
      ],
    );
    const put = panel.seen[1];
    assert.equal(put.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(put.body), {
      revision: 4,
      values: { retries: 5 },
      secrets: { apiKey: SECRET },
    });
    // Where `ps` is available, the live curl process is in it — without the
    // secret or the P12 password.
    for (const request of panel.seen) {
      if (request.commandLines === null) continue;
      assert.ok(request.commandLines.some((line) => line.startsWith('curl ')));
      for (const line of request.commandLines) {
        assert.ok(!line.includes(SECRET), 'the secret is not on the command line');
        assert.ok(!line.includes('SECRET'), 'no secret is on the command line');
      }
    }
    assert.deepEqual(await readdir(ownTmp), [], "curl's config directories are removed");
  } finally {
    if (sharedTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = sharedTmp;
    panel.server.close();
    await rmdir(ownTmp).catch(() => {});
  }
});

test('configure: refused before anything is sent — invalid flags, settings that cannot be changed', async () => {
  const offline = { ...HOSTING_UP, state: 'down', reason: 'tunnel' };
  const calls = [];
  const request = async (method, path, body) => {
    calls.push([method, path, body]);
    return method === 'GET' && path === '/api/plugins/off/settings'
      ? view({ hosting: offline })
      : view();
  };

  const invalid = await configureWithFlags(
    'fx',
    { sets: [{ key: 'apiKey', raw: SECRET }], clears: [], secrets: {} },
    { request, now: () => NOW },
  );
  assert.equal(invalid.state, 'invalid');
  assert.ok(!JSON.stringify(invalid).includes(SECRET));

  const readOnly = await configureWithFlags(
    'off',
    { sets: [{ key: 'retries', raw: '5' }], clears: [], secrets: {} },
    { request, now: () => NOW },
  );
  assert.equal(readOnly.state, 'read-only');
  assert.equal(readOnly.code, 'hosting_offline');
  assert.deepEqual(readOnly.hosting, offline);

  const unchanged = await configureWithFlags(
    'fx',
    { sets: [], clears: [], secrets: {} },
    { request, now: () => NOW },
  );
  assert.equal(unchanged.state, 'unchanged');

  assert.ok(
    calls.every(([method]) => method === 'GET'),
    'nothing was sent',
  );
});
