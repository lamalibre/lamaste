/**
 * An agent half's request body limit (4.12): the manifest's
 * `agent.maxBodySizeMb`, its bounds, the limit it resolves to, its place in
 * the approval digest, and the internal tunnel, which has none of its own.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_HALF_MAX_BODY_MB,
  AgentHalfMaxBodySizeSchema,
  ManifestValidationError,
  agentHalfMaxBodyMb,
  approvalDigest,
  validateManifest,
} from '@lamalibre/lamaste';
import {
  TUNNEL_MAX_BODY_MB,
  TunnelError,
  createTunnel,
  reconfigureTunnel,
  updateTunnel,
} from '@lamalibre/lamaste/server';

const manifest = (agent) => ({ name: 'corral', version: '1.0.0', hosting: 'agent', agent });

test('a manifest declares 1 to 100 MiB, a whole number, in its agent block', () => {
  for (const ok of [1, 26, 100]) {
    assert.equal(validateManifest(manifest({ maxBodySizeMb: ok })).agent.maxBodySizeMb, ok);
  }
  for (const bad of [0, -1, 101, 10240, 2.5, '26', null, Number.NaN]) {
    assert.throws(
      () => validateManifest(manifest({ maxBodySizeMb: bad })),
      ManifestValidationError,
      JSON.stringify(bad),
    );
    assert.equal(AgentHalfMaxBodySizeSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
  // Only the agent block's sets it.
  assert.equal(agentHalfMaxBodyMb(validateManifest({ ...manifest({}), maxBodySizeMb: 26 })), 10);
});

test('the limit a plugin gets: its declaration, else the default', () => {
  assert.equal(agentHalfMaxBodyMb(manifest({ maxBodySizeMb: 26 })), 26);
  assert.equal(agentHalfMaxBodyMb(manifest({})), 10);
  assert.equal(agentHalfMaxBodyMb({ agent: null }), 10);
  assert.equal(agentHalfMaxBodyMb({}), 10);
  // A tunnel's default, and the most an agent may set on a tunnel of its own.
  assert.equal(AGENT_HALF_MAX_BODY_MB.default, TUNNEL_MAX_BODY_MB.default);
  assert.equal(AGENT_HALF_MAX_BODY_MB.max, TUNNEL_MAX_BODY_MB.agentMax);
  assert.equal(AGENT_HALF_MAX_BODY_MB.min, TUNNEL_MAX_BODY_MB.min);
});

test('the approval digest covers a declared limit, and nothing changes without one', () => {
  const bare = { relay: null, agentHalf: null };
  // 4.11's digest of the same subject, byte for byte.
  assert.equal(
    approvalDigest(bare),
    '1e83a7841a1d60d9007f17d25225486829bc1d9d473a6050eb50a6462f301c4a',
  );
  assert.equal(approvalDigest({ ...bare, maxBodySizeMb: null }), approvalDigest(bare));
  assert.equal(approvalDigest({ ...bare, maxBodySizeMb: undefined }), approvalDigest(bare));
  // sha256 of {"agentHalf":null,"body":{"maxBodySizeMb":26},"relay":null,"v":2}
  assert.equal(
    approvalDigest({ ...bare, maxBodySizeMb: 26 }),
    'fd850cb7b65c67dae9cb897ed3327a41e1958dfcf590cee1ae10b2a2dda1ccc5',
  );
  assert.notEqual(
    approvalDigest({ ...bare, maxBodySizeMb: 26 }),
    approvalDigest({ ...bare, maxBodySizeMb: 25 }),
  );
  // Declaring the default is still a declaration: approved as such.
  assert.notEqual(approvalDigest({ ...bare, maxBodySizeMb: 10 }), approvalDigest(bare));
  for (const bad of [0, 101, 1.5]) {
    assert.throws(() => approvalDigest({ ...bare, maxBodySizeMb: bad }), /maxBodySizeMb/);
  }
});

/** A tunnel workflow that fails if it gets past validation. */
const unreachable = new Proxy(
  {},
  {
    get() {
      throw new Error('validation should have refused first');
    },
  },
);
const logger = { info() {}, warn() {}, error() {} };

test('an internal tunnel has no body limit of its own: none is stored, none can be set', async () => {
  await assert.rejects(
    createTunnel({
      exposure: 'internal',
      type: 'plugin',
      pluginName: '@lamalibre/corral-server',
      agentLabel: 'vm1',
      maxBodySizeMb: 26,
      domain: 'example.com',
      email: 'ops@example.com',
      nginx: unreachable,
      certbot: unreachable,
      chisel: unreachable,
      state: unreachable,
      agents: unreachable,
      logger,
    }),
    (err) =>
      err instanceof TunnelError &&
      err.code === 'INVALID_SETTING' &&
      /agent\.maxBodySizeMb/.test(err.message),
  );

  const internal = {
    id: 't1',
    subdomain: null,
    fqdn: null,
    port: 21000,
    description: null,
    type: 'plugin',
    enabled: true,
    createdAt: '2026-11-09T00:00:00.000Z',
    exposure: 'internal',
    agentLabel: 'vm1',
    pluginName: '@lamalibre/corral-server',
    pluginRoute: 'corral',
    // What 4.3–4.11 stored: nothing reads it.
    maxBodySizeMb: 10,
  };
  let writes = 0;
  const state = {
    readTunnels: async () => [{ ...internal }],
    writeTunnels: async () => {
      writes += 1;
    },
  };
  const opts = {
    id: 't1',
    email: 'ops@example.com',
    nginx: unreachable,
    certbot: unreachable,
    state,
    userSurface: unreachable,
    logger,
  };
  await assert.rejects(
    reconfigureTunnel({ ...opts, maxBodySizeMb: 26 }),
    (err) => err instanceof TunnelError && err.code === 'INVALID_SETTING',
  );
  assert.equal((await reconfigureTunnel(opts)).tunnel.id, 't1', 'nothing asked: nothing done');
  // Combined with a move, refused before the move runs: never half applied.
  await assert.rejects(
    updateTunnel({
      ...opts,
      agentLabel: 'vm2',
      maxBodySizeMb: 26,
      chisel: unreachable,
      agents: unreachable,
    }),
    (err) => err instanceof TunnelError && err.code === 'INVALID_SETTING',
  );
  assert.equal(writes, 0);
});
