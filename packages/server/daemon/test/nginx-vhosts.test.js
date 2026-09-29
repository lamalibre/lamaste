/**
 * Every vhost the panel generates must pass lamaste-priv's allow-list — the
 * root helper refuses anything else, and a refused vhost is a feature that
 * does not work on a real server. Runs the generators against a stand-in
 * `sudo` that captures what they would hand to the helper.
 *
 * The allow-list's refusals are tested in
 * packages/provisioners/server/test/lamaste-priv.test.js.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { validateVhost, PANEL_SITE_RE } = require(
  fileURLToPath(new URL('../../../provisioners/server/scripts/lamaste-priv', import.meta.url)),
);

let work;
let captured;
let nginx;

before(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'lamaste-vhosts-'));
  captured = path.join(work, 'captured');
  const bin = path.join(work, 'bin');
  await mkdir(captured);
  await mkdir(bin);
  // Stand-in sudo: keep `lamaste-priv nginx-site write <name>` input, succeed otherwise.
  const fakeSudo = path.join(bin, 'sudo');
  await writeFile(
    fakeSudo,
    `#!/bin/sh\nif [ "$2" = nginx-site ] && [ "$3" = write ]; then cat > "${captured}/$4"; fi\nexit 0\n`,
  );
  await chmod(fakeSudo, 0o755);
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  nginx = await import('../src/lib/nginx.js');
});

after(async () => {
  await rm(work, { recursive: true, force: true });
});

test('every generated vhost passes the lamaste-priv allow-list', async () => {
  const d = 'example.com';
  await nginx.writePanelVhost(d);
  await nginx.writeAuthVhost(d);
  await nginx.writeTunnelVhost(d);
  await nginx.writePublicVhost('app1', d, 20010);
  await nginx.writePublicVhost('app2', d, 20011, '/etc/letsencrypt/live/example.com/', {
    pathPrefix: 'herd',
    maxBodySizeMb: 100,
  });
  await nginx.writeAuthenticatedVhost('app3', d, 20012, undefined, { maxBodySizeMb: 5 });
  await nginx.writeRestrictedVhost('app4', d, 20013, undefined, {
    pathPrefix: 'shell',
    enabled: false,
  });
  await nginx.writeAgentPanelVhost('agent-r730', d, 9393);
  await nginx.writeStaticSiteVhost(
    {
      id: '3f1d2c3a-1b2c-4d5e-8f90-123456789abc',
      fqdn: 'www.example.com',
      spaMode: true,
      autheliaProtected: false,
      rootPath: '/var/www/lamaste/3f1d2c3a-1b2c-4d5e-8f90-123456789abc/',
      aliases: ['example.com'],
    },
    '/etc/letsencrypt/live/www.example.com',
    d,
  );
  await nginx.writeStaticSiteVhost(
    {
      id: '4f1d2c3a-1b2c-4d5e-8f90-123456789abc',
      fqdn: 'docs.example.com',
      spaMode: false,
      autheliaProtected: true,
      rootPath: '/var/www/lamaste/4f1d2c3a-1b2c-4d5e-8f90-123456789abc',
    },
    '/etc/letsencrypt/live/docs.example.com/',
    d,
  );

  const names = await readdir(captured);
  assert.equal(names.length, 10);
  for (const name of names) {
    assert.match(name, PANEL_SITE_RE);
    const text = await readFile(path.join(captured, name), 'utf8');
    assert.doesNotThrow(() => validateVhost(text), name);
  }
});
