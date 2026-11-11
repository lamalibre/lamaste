/**
 * Every refusal the invitation page's and the inviter's page's APIs can
 * give is one their page can put in its own words
 * (packages/core/docs/page-language-design.md §6): the pages never show a
 * refusal's `error` (English, for the panel, the CLI, scripts and logs) —
 * they map its `code`, else its status. So every 4xx on those paths carries
 * a code the page's catalogue holds, or is listed here as answered by its
 * status, or as not on those paths (the administrators' API), each with
 * why. A new refusal in these files fails here until it is one of the
 * three. Read from the source: `httpError(…)`, `reply.code(…).send({…})`
 * and `resolveUserCaller`'s answers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { INVITATIONS_PAGE_KEYS, INVITE_PAGE_KEYS } from '@lamalibre/lamaste';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** The files on each page's paths, and the keys that page's data block carries. */
const PATHS = {
  'routes/invite.js': INVITE_PAGE_KEYS,
  'lib/invitation-acceptance.js': INVITE_PAGE_KEYS,
  // The store answers both pages: an acceptance's refusals the invitation
  // page, a new link's (reissue) the inviter's page.
  'lib/invitations.js': [...INVITE_PAGE_KEYS, ...INVITATIONS_PAGE_KEYS],
  'routes/delegated-invitations.js': INVITATIONS_PAGE_KEYS,
  'lib/delegated-invitations.js': INVITATIONS_PAGE_KEYS,
  'lib/user-caller.js': INVITATIONS_PAGE_KEYS,
};

/** Refusals without a code: the page shows its status's text, and that is the right one. */
const BY_STATUS = {
  'routes/delegated-invitations.js': {
    "'cross-site request refused'": 'not the page’s own request: nothing to explain to a person',
    "'unauthenticated'": 'the page shows its sign-in view for a 401',
    "'cross-origin request refused'": 'not the page’s own request',
  },
  'lib/user-caller.js': {
    "'Not found'": 'the page shows its "no invitations page here" view for a 404',
    "'The plugin is not ready for its users yet'": 'a 503: "try again later"',
    NOT_ENTITLED: 'a 403: the page shows "not available" — it never tells who is entitled',
    "'This user is disabled'": 'a 403, as one not entitled',
  },
};

/** Refusals of these files that neither page's API gives: the administrators' API. */
const NOT_ON_PATH = {
  'lib/invitations.js': {
    "'A pending invitation already exists for this username'": 'an administrator’s invitation',
    "'Invitation not found'": 'revoking or deleting one in the administrators’ API',
    "'This invitation made an account: it stays on record'":
      'deleting one in the administrators’ API',
  },
  'lib/delegated-invitations.js': {
    '`Plugin "${name}" is not installed`': 'the invitation policy, administrators only',
    "issue?.message ?? 'Invalid invitation policy'": 'the invitation policy',
    '`Invitations cannot be enabled: ${unavailableText(surface.reason)}`': 'the invitation policy',
  },
};

/**
 * The index just past the bracket, string or template literal that opens at
 * `open` — strings skipped, template literals with their `${…}`.
 */
function skip(src, open) {
  const c = src[open];
  if (c === "'" || c === '"') {
    let i = open + 1;
    while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
    return i + 1;
  }
  if (c === '`') {
    let i = open + 1;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') i += 2;
      else if (src[i] === '$' && src[i + 1] === '{') i = skip(src, i + 1);
      else i++;
    }
    return i + 1;
  }
  const close = { '(': ')', '{': '}', '[': ']' }[c];
  let i = open + 1;
  while (i < src.length && src[i] !== close) {
    i = '\'"`({['.includes(src[i]) ? skip(src, i) : i + 1;
  }
  return i + 1;
}

/** The text inside the brackets opening at `open`. */
function inside(src, open) {
  return src.slice(open + 1, skip(src, open) - 1);
}

/** The top-level comma-separated parts of an argument list's text. */
function topLevel(args) {
  const parts = [];
  let start = 0;
  let i = 0;
  while (i < args.length) {
    if ('\'"`({['.includes(args[i])) {
      i = skip(args, i);
      continue;
    }
    if (args[i] === ',') {
      parts.push(args.slice(start, i).trim());
      start = i + 1;
    }
    i++;
  }
  parts.push(args.slice(start).trim());
  return parts.filter((p) => p.length > 0);
}

/** A literal `code: '…'`, `'(pass-through)'` for a computed one, or null. */
function codeOf(text) {
  const literal = /\bcode:\s*'([a-z_]+)'/.exec(text);
  if (literal) return literal[1];
  return /\bcode[,:]/.test(text) ? '(pass-through)' : null;
}

/** Every refusal a file's source holds: `{ status, message, code, cap, field }`. */
function refusalsOf(src) {
  const found = [];
  for (const m of src.matchAll(/\bhttpError\(/g)) {
    const open = m.index + m[0].length - 1;
    const [message = '', status = '', extra = ''] = topLevel(inside(src, open));
    found.push({ status: Number(status), message, code: codeOf(extra), extra });
  }
  for (const m of src.matchAll(/\.code\((\d{3})\)\s*\.send\(/g)) {
    const open = m.index + m[0].length - 1;
    let body = inside(src, open).trim();
    // A named answer: `const NAME = Object.freeze({ … })`.
    const constant = /^[A-Z_]+$/.test(body)
      ? new RegExp(`const ${body} = [^;]*`).exec(src)?.[0]
      : null;
    if (constant) body = constant;
    const error = /\berror:\s*([^,}]+)/.exec(body)?.[1]?.trim() ?? '';
    found.push({ status: Number(m[1]), message: error, code: codeOf(body), extra: body });
  }
  for (const m of src.matchAll(
    /\{\s*ok:\s*false,\s*status:\s*(\d{3}),\s*error:\s*([^}]+?)\s*\}/g,
  )) {
    found.push({ status: Number(m[1]), message: m[2], code: null, extra: '' });
  }
  return found.filter((r) => r.status >= 400);
}

test('every refusal on the pages’ paths has a code its page maps, or is answered by its status, or is not on them', () => {
  let coded = 0;
  for (const [file, keys] of Object.entries(PATHS)) {
    const src = fs.readFileSync(path.join(SRC, file), 'utf-8');
    const refusals = refusalsOf(src);
    assert.ok(refusals.length > 0 || file === 'routes/invite.js', `${file}: refusals read`);
    for (const r of refusals) {
      const where = `${file}: ${r.status} ${r.message}`;
      if (NOT_ON_PATH[file]?.[r.message]) continue;
      if (r.code === '(pass-through)') continue; // a code the error it answers with carries
      if (r.code === null) {
        if (r.status >= 500) continue; // "something went wrong — try again later"
        assert.ok(
          BY_STATUS[file]?.[r.message],
          `${where}: no code, and not listed as answered by its status`,
        );
        continue;
      }
      coded++;
      // The page reads `error.<code>.<field|cap>` first, then `error.<code>`.
      const cap = /\bcap:\s*'([a-z]+)'/.exec(r.extra)?.[1];
      const key = cap ? `error.${r.code}.${cap}` : `error.${r.code}`;
      assert.ok(keys.includes(key), `${where}: ${key} is not in its page’s catalogue`);
    }
  }
  assert.ok(coded >= 20, `the coded refusals were read (${coded})`);
});

test('the listed exceptions all still exist: a refusal removed or reworded is taken off the lists', () => {
  for (const [file, listed] of [...Object.entries(BY_STATUS), ...Object.entries(NOT_ON_PATH)]) {
    const messages = refusalsOf(fs.readFileSync(path.join(SRC, file), 'utf-8')).map(
      (r) => r.message,
    );
    for (const message of Object.keys(listed)) {
      assert.ok(messages.includes(message), `${file}: ${message} is listed but not found`);
    }
  }
});

test('the 4.10 codes: each refusal the design names carries its own', () => {
  const codesOf = (file) =>
    refusalsOf(fs.readFileSync(path.join(SRC, file), 'utf-8')).map((r) => `${r.status} ${r.code}`);
  const acceptance = codesOf('lib/invitation-acceptance.js');
  for (const expected of [
    '404 invitation_not_found',
    '410 invitation_used',
    '410 invitation_expired',
    '410 invitation_closed',
    '409 username_unavailable',
  ]) {
    assert.ok(acceptance.includes(expected), expected);
  }
  assert.ok(codesOf('lib/invitations.js').includes('410 invitation_closed'));
  // Giving one's own a new link; revoking one's own (none, or no longer open).
  assert.deepEqual(
    codesOf('lib/delegated-invitations.js').filter((c) => c.startsWith('404 not_found')),
    ['404 not_found', '404 not_found', '404 not_found'],
  );
  // No plugin on the route, another domain's, a malformed id (new link, revoke).
  assert.equal(
    codesOf('routes/delegated-invitations.js').filter((c) => c === '404 not_found').length,
    4,
  );
});
