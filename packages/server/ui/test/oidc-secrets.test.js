/**
 * The secrets of confidential OIDC clients a plugin change created: split
 * off the response that carried them (so only the dialog holds them),
 * queued for the dialog and dropped once acknowledged, and read from a
 * finished operation at once when this panel started it — otherwise only
 * when the administrator asks, so a CLI following its own operation still
 * gets them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createdSecrets,
  initialRevealState,
  markSecretsRead,
  operationSecretsAction,
  revealHeading,
  revealReducer,
  withoutSecrets,
} from '../src/admin/lib/oidcSecrets.js';

const SECRET = 'Zm9vYmFyYmF6cXV4'.repeat(4);

test('only well-formed { id, secret } pairs are taken, and nothing else of them', () => {
  assert.deepEqual(
    createdSecrets([
      { id: 'feria-ci', plugin: 'feria', secret: SECRET },
      { id: 'feria-cli' },
      { id: '', secret: SECRET },
      { id: 'feria-x', secret: '' },
      { id: 7, secret: SECRET },
      null,
      'feria-ci',
    ]),
    [{ id: 'feria-ci', secret: SECRET }],
  );
  assert.deepEqual(createdSecrets(undefined), []);
  assert.deepEqual(createdSecrets({ id: 'feria-ci', secret: SECRET }), []);
});

test('an install response is split: the rest may be kept, the secrets go to the dialog', () => {
  const response = {
    ok: true,
    plugin: { name: 'feria', version: '1.0.0' },
    oidcClients: [{ id: 'feria-ci', secret: SECRET }],
    hooks: null,
  };
  const { result, secrets } = withoutSecrets(response);
  assert.deepEqual(result, { ok: true, plugin: { name: 'feria', version: '1.0.0' }, hooks: null });
  assert.equal(JSON.stringify(result).includes(SECRET), false, 'the kept part has no secret');
  assert.deepEqual(secrets, [{ id: 'feria-ci', secret: SECRET }]);
  assert.ok('oidcClients' in response, 'the response itself is not changed');
});

test('a response without secrets — or an operation read after them — yields none', () => {
  assert.deepEqual(withoutSecrets({ ok: true, name: 'feria', status: 'enabled' }), {
    result: { ok: true, name: 'feria', status: 'enabled' },
    secrets: [],
  });
  assert.deepEqual(withoutSecrets({ id: 'op', status: 'succeeded', oidcClients: [] }).secrets, []);
  assert.deepEqual(withoutSecrets(null), { result: null, secrets: [] });
});

test('reveals queue in order, each with its own key; one without secrets queues nothing', () => {
  let state = revealReducer(initialRevealState, {
    type: 'reveal',
    plugin: 'feria',
    cause: 'install',
    secrets: [{ id: 'feria-ci', secret: SECRET }],
  });
  state = revealReducer(state, { type: 'reveal', plugin: 'fx', cause: 'enable', secrets: [] });
  state = revealReducer(state, {
    type: 'reveal',
    plugin: 'ox',
    cause: 'update',
    secrets: [{ id: 'ox-service', secret: 'other', extra: true }],
  });
  assert.deepEqual(
    state.queue.map(({ key, plugin, cause, secrets }) => ({ key, plugin, cause, secrets })),
    [
      { key: 1, plugin: 'feria', cause: 'install', secrets: [{ id: 'feria-ci', secret: SECRET }] },
      { key: 2, plugin: 'ox', cause: 'update', secrets: [{ id: 'ox-service', secret: 'other' }] },
    ],
  );
});

test('acknowledging drops the secrets shown — and a second click does not drop the next ones', () => {
  const reveal = (plugin) => ({
    type: 'reveal',
    plugin,
    cause: 'install',
    secrets: [{ id: `${plugin}-ci`, secret: SECRET }],
  });
  let state = revealReducer(revealReducer(initialRevealState, reveal('a')), reveal('b'));
  const shown = state.queue[0].key;
  state = revealReducer(state, { type: 'acknowledge', key: shown });
  assert.deepEqual(
    state.queue.map((r) => r.plugin),
    ['b'],
  );
  assert.equal(revealReducer(state, { type: 'acknowledge', key: shown }), state, 'stale key');
  state = revealReducer(state, { type: 'acknowledge', key: state.queue[0].key });
  assert.deepEqual(state.queue, []);
  assert.equal(JSON.stringify(state).includes(SECRET), false, 'nothing of them is kept');
  assert.equal(revealReducer(state, { type: 'acknowledge', key: 3 }), state);
});

test('the dialog says what created the secrets', () => {
  const one = [{ id: 'feria-ci', secret: SECRET }];
  const two = [...one, { id: 'feria-cli', secret: SECRET }];
  assert.equal(
    revealHeading({ plugin: 'feria', cause: 'install', secrets: one }),
    'Installing feria created a confidential OIDC client',
  );
  assert.equal(
    revealHeading({ plugin: 'feria', cause: 'enable', secrets: two }),
    'Enabling feria created 2 confidential OIDC clients',
  );
  assert.equal(
    revealHeading({ plugin: 'ox', cause: 'update', secrets: one }),
    'Updating ox created a confidential OIDC client',
  );
  assert.equal(
    revealHeading({ plugin: 'ox', cause: 'host', secrets: two }),
    'An operation on ox created 2 confidential OIDC clients',
  );
});

test('an operation started here is read as it ends; one started elsewhere is only offered', () => {
  const running = { status: 'running', revealPending: false };
  const waiting = { status: 'succeeded', revealPending: true };
  const done = { status: 'succeeded', revealPending: false };
  const rolledBack = { status: 'rolled-back', revealPending: false };

  assert.equal(operationSecretsAction(running, 'followed'), null, 'still running');
  assert.equal(operationSecretsAction(running, undefined), null);
  assert.equal(operationSecretsAction(waiting, 'followed'), 'read');
  assert.equal(operationSecretsAction(waiting, 'reading'), 'reading', 'one read at a time');
  assert.equal(operationSecretsAction(done, 'reading'), 'reading', 'until the read settles');
  assert.equal(operationSecretsAction(waiting, undefined), 'offer', 'the CLI may be following it');
  assert.equal(operationSecretsAction(done, 'followed'), 'forget', 'nothing to show');
  assert.equal(operationSecretsAction(rolledBack, 'followed'), 'forget');
  assert.equal(operationSecretsAction(done, undefined), null);
  assert.equal(operationSecretsAction({ status: 'succeeded' }, undefined), null, 'older panel');
});

test('once read, the cached list stops offering that operation’s secrets', () => {
  const data = {
    operations: [
      { id: 'b', status: 'succeeded', revealPending: true },
      { id: 'a', status: 'succeeded', revealPending: true },
    ],
  };
  const next = markSecretsRead(data, 'a');
  assert.deepEqual(
    next.operations.map((op) => [op.id, op.revealPending]),
    [
      ['b', true],
      ['a', false],
    ],
  );
  assert.equal(data.operations[1].revealPending, true, 'the cached object is not mutated');
  assert.equal(markSecretsRead(undefined, 'a'), undefined, 'nothing cached yet');
});
