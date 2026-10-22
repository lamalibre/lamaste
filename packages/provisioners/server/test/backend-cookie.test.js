/**
 * The http-level nginx map that keeps Authelia's session cookie from every
 * tunnel and agent backend (core `renderBackendCookieMap`, installed by
 * create-lamaste as /etc/nginx/conf.d/lamalibre-lamaste-backend-cookie.conf).
 *
 * The map is evaluated here the way nginx evaluates it: each `map` in
 * order, its quoted regular expressions unescaped as nginx's configuration
 * parser does, tried in order, the first match's value built from its
 * captures — and the expressions are held to the constructs PCRE and
 * JavaScript read alike, so the evaluation is PCRE's. Cookie strings put
 * the session cookie first, in the middle and last, twice and more, next to
 * names that only look like it, and with every spacing a client may send;
 * a seeded generator adds browser-shaped strings. Gatekeeper's reader
 * (`autheliaSessionCookies`) is held to the same grammar.
 *
 * When an nginx binary is on the PATH, a last test runs it: the map in a
 * real http{} block, a location that proxies to a stand-in backend with
 * `proxy_set_header Cookie $lamaste_backend_cookie;`, and the backend
 * reports the Cookie header it received — none at all when nothing is left.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  AUTHELIA_SESSION_COOKIE,
  BACKEND_COOKIE_MAP_FILE,
  BACKEND_COOKIE_STRIP_ROUNDS,
  BACKEND_COOKIE_VARIABLE,
  autheliaSessionCookies,
  renderBackendCookieMap,
} from '@lamalibre/lamaste';

const MAP = renderBackendCookieMap();

// ---------------------------------------------------------------------------
// An evaluator of the rendered map, as nginx evaluates it
// ---------------------------------------------------------------------------

/** nginx's unescaping of a double-quoted configuration string (ngx_conf_read_token). */
function unquote(token) {
  assert.ok(token.startsWith('"') && token.endsWith('"'), token);
  const inner = token.slice(1, -1);
  let out = '';
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (c === '\\' && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (next === '"' || next === "'" || next === '\\') {
        out += next;
        i += 1;
        continue;
      }
      if (next === 't' || next === 'r' || next === 'n') {
        out += { t: '\t', r: '\r', n: '\n' }[next];
        i += 1;
        continue;
      }
    }
    out += c;
  }
  return out;
}

/** A configuration token: a quoted string or a run of non-space characters. */
function tokens(line) {
  return [...line.matchAll(/"(?:\\.|[^"\\])*"|[^\s;]+/g)].map((m) => m[0]);
}

/**
 * The regular-expression constructs the map may use: those PCRE and
 * JavaScript read alike on a header value (no line breaks, which nginx
 * refuses in a header): anchors, groups (capturing and `(?:`), classes,
 * `*` and `?` (greedy and lazy), `.`, `|`, and literal `;`, `=`, space,
 * tab — and the cookie name itself.
 */
function assertPortablePattern(pattern) {
  const rest = pattern.split(AUTHELIA_SESSION_COOKIE).join('');
  assert.match(rest, /^[\^$()?:|.*[\] \t;=]*$/, `only portable constructs: ${pattern}`);
}

/** The maps of a rendered http{} snippet, in order. */
function parseMaps(text) {
  const maps = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (current === null) {
      const m = /^map (\$[a-z_0-9]+) (\$[a-z_0-9]+) \{$/.exec(line);
      assert.ok(m, `a map: ${line}`);
      current = { source: m[1], variable: m[2], default: null, entries: [] };
      continue;
    }
    if (line === '}') {
      maps.push(current);
      current = null;
      continue;
    }
    assert.ok(line.endsWith(';'), line);
    const [key, value, ...extra] = tokens(line);
    assert.equal(extra.length, 0, line);
    if (key === 'default') {
      current.default = value;
      continue;
    }
    const pattern = unquote(key);
    assert.ok(pattern.startsWith('~') && !pattern.startsWith('~*'), `case-sensitive regex: ${key}`);
    assertPortablePattern(pattern.slice(1));
    current.entries.push({ regex: new RegExp(pattern.slice(1)), value });
  }
  assert.equal(current, null, 'every map is closed');
  return maps;
}

/** A map value: a quoted string, or `$1`/`$2`/variables run together. */
function expand(value, vars, captures) {
  const text = value.startsWith('"') ? unquote(value) : value;
  return text.replace(/\$(\d|[a-z_][a-z_0-9]*)/g, (_m, name) => {
    if (/^\d$/.test(name)) return captures[Number(name)] ?? '';
    assert.ok(name in vars, `variable $${name}`);
    return vars[name];
  });
}

/** The value of `$lamaste_backend_cookie` for a `Cookie` header, as nginx computes it. */
function backendCookie(cookieHeader, maps = parseMaps(MAP)) {
  const vars = { http_cookie: cookieHeader };
  for (const map of maps) {
    const input = vars[map.source.slice(1)];
    let out = null;
    for (const { regex, value } of map.entries) {
      const m = regex.exec(input);
      if (m) {
        out = expand(value, vars, m);
        break;
      }
    }
    vars[map.variable.slice(1)] = out ?? expand(map.default, vars, []);
  }
  return vars[BACKEND_COOKIE_VARIABLE.slice(1)];
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

test('the map: a chain of strip rounds ending in the variable the vhosts use', () => {
  const maps = parseMaps(MAP);
  assert.equal(maps.length, BACKEND_COOKIE_STRIP_ROUNDS + 1);
  assert.equal(maps[0].source, '$http_cookie');
  for (let i = 1; i < maps.length; i += 1) assert.equal(maps[i].source, maps[i - 1].variable);
  assert.equal(maps.at(-1).variable, BACKEND_COOKIE_VARIABLE);
  assert.equal(BACKEND_COOKIE_VARIABLE, '$lamaste_backend_cookie');
  assert.equal(BACKEND_COOKIE_MAP_FILE, '/etc/nginx/conf.d/lamalibre-lamaste-backend-cookie.conf');
  // The cookie name Authelia is configured with, and no other.
  assert.equal(AUTHELIA_SESSION_COOKIE, 'authelia_session');
  assert.ok(MAP.includes('authelia_session[ \\t]*='));
  assert.equal(renderBackendCookieMap(), MAP, 'pure: a redeploy compares it byte for byte');
  for (const bad of ['a b', 'a;b', 'a$b', 'a.b', '']) {
    assert.throws(() => renderBackendCookieMap(bad), /Invalid cookie name/);
  }
});

test('the session cookie goes wherever it is: first, middle, last, alone', () => {
  for (const [cookie, expected] of [
    ['', ''],
    ['authelia_session=abc', ''],
    ['authelia_session=abc; theme=dark', 'theme=dark'],
    ['theme=dark; authelia_session=abc', 'theme=dark'],
    ['a=1; authelia_session=abc; b=2', 'a=1; b=2'],
    ['a=1; b=2; authelia_session=abc; c=3; d=4', 'a=1; b=2; c=3; d=4'],
    ['theme=dark', 'theme=dark'],
    ['authelia_session=a=b=c; x=1', 'x=1'],
    ['authelia_session=; x=1', 'x=1'],
    ['authelia_session="quoted"; x=1', 'x=1'],
  ]) {
    assert.equal(backendCookie(cookie), expected, JSON.stringify(cookie));
  }
});

test('every occurrence goes — up to the bound; past it, no Cookie at all', () => {
  const s = (v) => `authelia_session=${v}`;
  assert.equal(backendCookie(`${s(1)}; ${s(2)}`), '');
  assert.equal(backendCookie(`${s(1)}; a=1; ${s(2)}`), 'a=1');
  assert.equal(backendCookie(`a=1; ${s(1)}; b=2; ${s(2)}; c=3`), 'a=1; b=2; c=3');
  const many = (n) =>
    Array.from({ length: n }, (_v, i) => `k${i}=v; ${s(i)}`)
      .join('; ')
      .concat('; tail=1');
  for (let n = 1; n <= BACKEND_COOKIE_STRIP_ROUNDS; n += 1) {
    const out = backendCookie(many(n));
    assert.equal(
      out,
      Array.from({ length: n }, (_v, i) => `k${i}=v`)
        .concat('tail=1')
        .join('; '),
      `${n} occurrences`,
    );
  }
  // One more than the map strips: fail closed.
  assert.equal(backendCookie(many(BACKEND_COOKIE_STRIP_ROUNDS + 1)), '');
  assert.equal(backendCookie(Array(12).fill(s('x')).join('; ')), '');
});

test('names that only look like it, and values that contain it, are other cookies', () => {
  for (const cookie of [
    'authelia_session_x=1',
    'xauthelia_session=1',
    'Authelia_Session=1',
    'AUTHELIA_SESSION=1',
    'authelia_session2=1; authelia_sessions=2',
    'note=authelia_session=x',
    'a=1; note=x authelia_session=y',
    'authelia-session=1',
  ]) {
    assert.equal(backendCookie(cookie), cookie, cookie);
  }
  assert.equal(
    backendCookie('authelia_session_x=1; authelia_session=s; xauthelia_session=2'),
    'authelia_session_x=1; xauthelia_session=2',
  );
});

test('any spacing a client sends: around the name, the =, the separators; tabs too', () => {
  for (const [cookie, expected] of [
    ['a=1;authelia_session=abc;b=2', 'a=1;b=2'],
    ['a=1 ; authelia_session=abc ; b=2', 'a=1; b=2'],
    ['  authelia_session =abc ;  b=2', 'b=2'],
    ['a=1;\tauthelia_session\t=\tabc', 'a=1'],
    ['a=1;   authelia_session   =   abc', 'a=1'],
    ['authelia_session=abc;', ''],
    [';;authelia_session=x;;', ';;;'],
  ]) {
    assert.equal(backendCookie(cookie), expected, JSON.stringify(cookie));
    // Whatever is left holds no session cookie as Gatekeeper reads one.
    assert.deepEqual(autheliaSessionCookies(backendCookie(cookie)), []);
  }
});

test('browser-shaped cookie strings: the others stay, in order; the session never passes', () => {
  // A seeded generator: the same strings on every run.
  let seed = 0x5eed;
  const next = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const names = [
    AUTHELIA_SESSION_COOKIE,
    'authelia_session_x',
    'xauthelia_session',
    'Authelia_session',
    'theme',
    'csrf',
    '_ga',
    'lang',
  ];
  const separators = ['; ', ';', ' ; ', ';\t'];
  for (let run = 0; run < 2000; run += 1) {
    const pairs = Array.from({ length: 1 + next(8) }, () => {
      const name = names[next(names.length)];
      const value = ['abc', '', 'a=b', 'x%3By', '"q"', 'authelia_session=z'][next(6)];
      return { name, pair: `${name}=${value}` };
    });
    const sep = separators[next(separators.length)];
    const cookie = pairs.map((p) => p.pair).join(sep);
    const sessions = pairs.filter((p) => p.name === AUTHELIA_SESSION_COOKIE).length;
    const out = backendCookie(cookie);
    // Gatekeeper's reader sees exactly the pairs the map strips.
    assert.equal(autheliaSessionCookies(cookie).length, sessions, cookie);
    if (sessions > BACKEND_COOKIE_STRIP_ROUNDS) {
      assert.equal(out, '', `fail closed: ${cookie}`);
      continue;
    }
    assert.deepEqual(autheliaSessionCookies(out), [], `${cookie} → ${out}`);
    const kept = pairs.filter((p) => p.name !== AUTHELIA_SESSION_COOKIE).map((p) => p.pair);
    const outPairs = out
      .split(';')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    assert.deepEqual(outPairs, kept, `${cookie} → ${out}`);
  }
});

// ---------------------------------------------------------------------------
// The map in a real nginx (when one is installed)
// ---------------------------------------------------------------------------

const nginxBinary = spawnSync('nginx', ['-v']).status === 0 ? 'nginx' : null;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Send raw HTTP/1.1 header lines to nginx (several Cookie lines, as a client may). */
function rawRequest(port, headerLines) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        [
          'GET / HTTP/1.1',
          'Host: app.example.com',
          'Connection: close',
          ...headerLines,
          '',
          '',
        ].join('\r\n'),
      );
    });
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString('utf-8');
    });
    socket.on('end', () => resolve(data.slice(data.indexOf('\r\n\r\n') + 4)));
    socket.on('error', reject);
  });
}

test(
  'nginx itself: the backend gets the other cookies, or no Cookie header at all',
  { skip: nginxBinary ? false : 'no nginx binary on the PATH' },
  async () => {
    const prefix = await mkdtemp(path.join(tmpdir(), 'lamaste-cookie-map-'));
    const backend = http.createServer((req, res) => {
      const body = Buffer.from(JSON.stringify({ cookie: req.headers.cookie ?? null }));
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': String(body.length),
      });
      res.end(body);
    });
    await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
    const port = await freePort();
    await mkdir(path.join(prefix, 'logs'));
    await writeFile(path.join(prefix, 'backend-cookie.conf'), MAP);
    await writeFile(
      path.join(prefix, 'nginx.conf'),
      [
        'worker_processes 1;',
        `pid ${path.join(prefix, 'nginx.pid')};`,
        `error_log ${path.join(prefix, 'logs', 'error.log')};`,
        'events { worker_connections 64; }',
        'http {',
        `  access_log off;`,
        `  client_body_temp_path ${path.join(prefix, 'tmp-body')};`,
        `  proxy_temp_path ${path.join(prefix, 'tmp-proxy')};`,
        `  fastcgi_temp_path ${path.join(prefix, 'tmp-fcgi')};`,
        `  uwsgi_temp_path ${path.join(prefix, 'tmp-uwsgi')};`,
        `  scgi_temp_path ${path.join(prefix, 'tmp-scgi')};`,
        `  include ${path.join(prefix, 'backend-cookie.conf')};`,
        '  server {',
        `    listen 127.0.0.1:${port};`,
        '    location / {',
        `      proxy_set_header Cookie ${BACKEND_COOKIE_VARIABLE};`,
        `      proxy_pass http://127.0.0.1:${backend.address().port};`,
        '      proxy_http_version 1.1;',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    const conf = path.join(prefix, 'nginx.conf');
    const check = spawnSync(nginxBinary, ['-t', '-p', prefix, '-c', conf], { encoding: 'utf-8' });
    assert.equal(check.status, 0, check.stderr);
    const server = spawn(nginxBinary, ['-p', prefix, '-c', conf, '-g', 'daemon off;'], {
      stdio: 'ignore',
    });
    try {
      for (let i = 0; i < 100; i += 1) {
        const up = await new Promise((resolve) => {
          const s = net.connect(port, '127.0.0.1', () => {
            s.end();
            resolve(true);
          });
          s.on('error', () => resolve(false));
        });
        if (up) break;
        await sleep(50);
      }
      const seen = async (lines) => JSON.parse(await rawRequest(port, lines)).cookie;

      assert.equal(
        await seen(['Cookie: theme=dark; authelia_session=abc; csrf=1']),
        'theme=dark; csrf=1',
      );
      assert.equal(await seen(['Cookie: authelia_session=abc']), null, 'nothing left: no header');
      assert.equal(await seen([]), null);
      assert.equal(await seen(['Cookie: a=1; authelia_session_x=2']), 'a=1; authelia_session_x=2');
      // Two Cookie lines: nginx joins them, the map strips across both.
      assert.equal(
        await seen(['Cookie: a=1; authelia_session=abc', 'Cookie: authelia_session=def; b=2']),
        'a=1; b=2',
      );
      const flood = Array.from({ length: 6 }, (_v, i) => `authelia_session=${i}`).join('; ');
      assert.equal(await seen([`Cookie: keep=1; ${flood}`]), null, 'fail closed past the bound');

      // The evaluator above agrees with nginx on the browser-shaped cases.
      for (const cookie of [
        'a=1 ; authelia_session=abc ; b=2',
        'authelia_session=x; authelia_session=y; z=1',
        'Authelia_Session=1; authelia_session=2',
      ]) {
        const expected = backendCookie(cookie);
        assert.equal(await seen([`Cookie: ${cookie}`]), expected === '' ? null : expected, cookie);
      }
    } finally {
      server.kill('SIGTERM');
      await new Promise((resolve) => server.once('exit', resolve));
      backend.close();
      const errors = await readFile(path.join(prefix, 'logs', 'error.log'), 'utf-8').catch(
        () => '',
      );
      await rm(prefix, { recursive: true, force: true });
      assert.doesNotMatch(errors, /\[(?:emerg|alert|crit)\]/, errors);
    }
  },
);

// ---------------------------------------------------------------------------
// When create-lamaste installs it
// ---------------------------------------------------------------------------

/** The titles of the subtasks a task function hands Listr. */
async function subtaskTitles(tasks) {
  const { fileURLToPath } = await import('node:url');
  const ctx = {
    installDir: '/opt/lamalibre/lamaste',
    configDir: '/etc/lamalibre/lamaste',
    pkiDir: path.join(path.dirname(fileURLToPath(import.meta.url)), 'pki'),
  };
  let list = null;
  tasks(ctx, {
    newListr(items) {
      list = items;
      return items;
    },
  });
  return list.map((t) => t.title);
}

test('installed before the panel writes a tunnel vhost — fresh install and redeploy', async () => {
  const MAP_STEP = "Keeping Authelia's session cookie from tunnel backends";
  const { nginxTasks } = await import('../src/tasks/nginx.js');
  const install = await subtaskTitles(nginxTasks);
  assert.ok(install.includes(MAP_STEP), install.join(' | '));
  assert.ok(
    install.indexOf(MAP_STEP) < install.indexOf('Validating and starting nginx'),
    'tested with nginx before it starts',
  );

  // The redeploy's first change: before the running panel is stopped (a
  // relay whose nginx refuses the map keeps the version it runs), and so
  // long before the new panel starts and re-renders every tunnel vhost.
  const { redeployTasks } = await import('../src/tasks/redeploy.js');
  const redeploy = await subtaskTitles(redeployTasks);
  assert.equal(redeploy.indexOf(MAP_STEP), 1, redeploy.join(' | '));
  assert.equal(redeploy[0], 'Checking versions');
  assert.equal(redeploy[2], 'Stopping panel services');
  assert.ok(
    redeploy.indexOf(MAP_STEP) < redeploy.indexOf('Reloading systemd and restarting panel'),
  );
});
