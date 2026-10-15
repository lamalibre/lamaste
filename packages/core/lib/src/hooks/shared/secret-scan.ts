/**
 * `lamaste:secret-scan` — the shared `request:post-forward` hook that looks
 * for tokens and keys in a response before it leaves the relay.
 *
 * It runs in the plugin's hook runner like the plugin's own hooks and sees
 * only what they would see. Matching is done on the raw text (see
 * `packs.ts`); a body is never parsed and serialised again, so nothing but
 * the matched characters changes. `redact` replaces each secret with
 * `[REDACTED:<ruleId>]` — ASCII without quotes or backslashes, safe inside a
 * JSON string; `block` refuses the response. The audit entry names the rules
 * and counts, never a value.
 */

import { SECRET_SCAN_PACKS } from '../constants.js';
import type { SecretScanPack, SecretScanSettings } from '../constants.js';
import type { PostForwardDecision, ResponseHookInput } from '../types.js';
import { SECRET_SCAN_RULES } from './packs.js';

export interface SecretMatch {
  readonly ruleId: string;
  readonly start: number;
  readonly end: number;
}

/** Find every secret of the given packs in `text`; overlapping matches are merged. */
export function findSecrets(text: string, packs: readonly SecretScanPack[]): SecretMatch[] {
  const found: SecretMatch[] = [];
  for (const pack of packs) {
    for (const rule of SECRET_SCAN_RULES[pack]) {
      const re = new RegExp(
        rule.pattern.source,
        rule.pattern.flags.includes('d') ? rule.pattern.flags : `${rule.pattern.flags}d`,
      );
      for (const match of text.matchAll(re)) {
        if (match.index === undefined) continue;
        let start = match.index;
        let end = start + match[0].length;
        if (rule.valueGroup !== undefined) {
          const span = match.indices?.[rule.valueGroup];
          if (!span) continue;
          [start, end] = span;
        }
        if (end > start) found.push({ ruleId: rule.id, start, end });
      }
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: SecretMatch[] = [];
  for (const m of found) {
    const last = merged[merged.length - 1];
    if (last && m.start < last.end) {
      if (m.end > last.end) merged[merged.length - 1] = { ...last, end: m.end };
      continue;
    }
    merged.push(m);
  }
  return merged;
}

/** Replace each match with `[REDACTED:<ruleId>]`. */
export function redactSecrets(text: string, matches: readonly SecretMatch[]): string {
  let out = '';
  let at = 0;
  for (const m of matches) {
    out += text.slice(at, m.start) + `[REDACTED:${m.ruleId}]`;
    at = m.end;
  }
  return out + text.slice(at);
}

const TEXT_TYPES = [
  /^text\//,
  /^application\/(?:[a-z0-9.+-]+\+)?json$/,
  /^application\/(?:[a-z0-9.+-]+\+)?xml$/,
  /^application\/(?:x-)?ndjson$/,
  /^application\/(?:x-)?yaml$/,
  /^application\/(?:x-)?javascript$/,
  /^application\/x-www-form-urlencoded$/,
  /^application\/(?:x-)?csv$/,
  /^application\/graphql-response\+json$/,
];

/**
 * Why a response cannot be scanned, or null when it can: its encoding is
 * not identity, its type is not text, its charset is not UTF-8, or its bytes
 * are not valid UTF-8.
 */
export function unscannableReason(
  headers: Readonly<Record<string, string>>,
  bytes: Uint8Array,
): string | null {
  const encoding = (headers['content-encoding'] ?? '').trim().toLowerCase();
  if (encoding !== '' && encoding !== 'identity') return `content-encoding ${encoding}`;
  const type = (headers['content-type'] ?? '').toLowerCase();
  if (type !== '') {
    const [mime = '', ...params] = type.split(';').map((s) => s.trim());
    if (!TEXT_TYPES.some((re) => re.test(mime))) return `content-type ${mime}`;
    const charset = params.find((p) => p.startsWith('charset='))?.slice('charset='.length);
    if (charset && !['utf-8', 'utf8', 'us-ascii'].includes(charset.replace(/"/g, ''))) {
      return `charset ${charset}`;
    }
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return 'not valid UTF-8';
  }
  if (type === '' && bytes.includes(0)) return 'binary body';
  return null;
}

/** The versions of the packs a scan used, for the audit entry. */
function packVersions(packs: readonly SecretScanPack[]): string {
  return packs.map((p) => `${p}@${SECRET_SCAN_PACKS[p]}`).join(',');
}

/** The hook itself, called by the runner with the plugin's settings. */
export function secretScanHook(
  input: ResponseHookInput,
  settings: SecretScanSettings,
): PostForwardDecision {
  const body = input.body;
  if (!body || body.bytes.length === 0) return { action: 'pass' };
  const reason = unscannableReason(input.headers, body.bytes);
  if (reason !== null) {
    if (settings.onUnscannable === 'pass') return { action: 'pass' };
    return {
      action: 'block',
      reasonId: 'secret-scan.unscannable',
      effects: [
        {
          type: 'audit',
          event: 'secret-scan.unscannable',
          data: { reason, method: input.request.method, path: input.request.path },
        },
      ],
    };
  }
  const text = body.text();
  const matches = findSecrets(text, settings.packs);
  if (matches.length === 0) return { action: 'pass' };
  const rules = [...new Set(matches.map((m) => m.ruleId))].sort().join(',');
  const data = {
    rules,
    count: matches.length,
    packs: packVersions(settings.packs),
    method: input.request.method,
    path: input.request.path,
  };
  if (settings.action === 'block') {
    return {
      action: 'block',
      reasonId: 'secret-scan',
      effects: [{ type: 'audit', event: 'secret-scan.blocked', data }],
    };
  }
  return {
    action: 'replace',
    body: redactSecrets(text, matches),
    effects: [{ type: 'audit', event: 'secret-scan.redacted', data }],
  };
}
