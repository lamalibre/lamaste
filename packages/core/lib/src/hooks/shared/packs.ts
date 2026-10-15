/**
 * Rule packs of `lamaste:secret-scan`.
 *
 * Every rule matches on the raw text of a body, so a secret inside a JSON
 * string — a PEM key whose newlines are the two characters `\n` — is found
 * without parsing the body. Rules are chosen for a low false-positive rate:
 * `credentials` (the default pack) only holds formats with a distinctive
 * prefix or framing; `jwt` and `assignments` match far more often in normal
 * traffic and are enabled per plugin.
 *
 * A pack's version is `SECRET_SCAN_PACKS[pack]` in `../constants.ts`. Within a
 * Lamaste major a pack only gains rules; bump the version with every change
 * so Lamaste records it for the plugins that use the pack.
 */

import type { SecretScanPack } from '../constants.js';

export interface SecretScanRule {
  /** Stable id, shown in redactions (`[REDACTED:<id>]`) and audit entries. */
  readonly id: string;
  readonly pack: SecretScanPack;
  /** Global regular expression; bounded quantifiers only, no nested repetition. */
  readonly pattern: RegExp;
  /**
   * The capture group holding the secret, when the match carries context
   * (a key name) that must stay. Without it the whole match is the secret.
   */
  readonly valueGroup?: number;
}

/** Characters that can end a token: the rule needs the next one not to continue it. */
const TOKEN_END = '(?![A-Za-z0-9_-])';

const CREDENTIALS: readonly SecretScanRule[] = [
  {
    id: 'private-key',
    pack: 'credentials',
    // PEM and OpenSSH private keys. The body class includes `\` so the JSON
    // escape `\n` is part of the key, and excludes `"` so a match never runs
    // across the end of a JSON string.
    pattern:
      /-----BEGIN ((?:[A-Z0-9]+ ){0,3}PRIVATE KEY(?: BLOCK)?)-----[A-Za-z0-9+/=\s\\:,.-]{16,65536}?-----END \1-----/g,
  },
  {
    id: 'aws-access-key-id',
    pack: 'credentials',
    pattern: new RegExp(`\\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}${TOKEN_END}`, 'g'),
  },
  {
    id: 'github-token',
    pack: 'credentials',
    pattern: new RegExp(
      `\\b(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})${TOKEN_END}`,
      'g',
    ),
  },
  {
    id: 'gitlab-token',
    pack: 'credentials',
    pattern: new RegExp(`\\b(?:glpat|gldt|glrt|glptt|glcbt)-[A-Za-z0-9_-]{20,64}${TOKEN_END}`, 'g'),
  },
  {
    id: 'slack-token',
    pack: 'credentials',
    pattern: new RegExp(`\\bxox[abposr]-[A-Za-z0-9-]{10,250}${TOKEN_END}`, 'g'),
  },
  {
    id: 'slack-webhook',
    pack: 'credentials',
    pattern:
      /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{6,20}\/B[A-Z0-9]{6,20}\/[A-Za-z0-9]{20,40}/g,
  },
  {
    id: 'stripe-key',
    pack: 'credentials',
    pattern: new RegExp(`\\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,247}${TOKEN_END}`, 'g'),
  },
  {
    id: 'google-api-key',
    pack: 'credentials',
    pattern: new RegExp(`\\bAIza[0-9A-Za-z_-]{35}${TOKEN_END}`, 'g'),
  },
  {
    id: 'npm-token',
    pack: 'credentials',
    pattern: new RegExp(`\\bnpm_[A-Za-z0-9]{36}${TOKEN_END}`, 'g'),
  },
  {
    id: 'digitalocean-token',
    pack: 'credentials',
    pattern: new RegExp(`\\bdo[por]_v1_[a-f0-9]{64}${TOKEN_END}`, 'g'),
  },
  {
    id: 'anthropic-key',
    pack: 'credentials',
    pattern: new RegExp(`\\bsk-ant-[a-z]{2,10}[0-9]{2}-[A-Za-z0-9_-]{80,120}${TOKEN_END}`, 'g'),
  },
  {
    id: 'openai-key',
    pack: 'credentials',
    pattern: new RegExp(
      `\\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,200}T3BlbkFJ[A-Za-z0-9_-]{20,200}${TOKEN_END}`,
      'g',
    ),
  },
  {
    id: 'feria-token',
    pack: 'credentials',
    // Feria registry tokens: `feria_` + 32 random bytes, base64url.
    pattern: new RegExp(`\\bferia_[A-Za-z0-9_-]{43}${TOKEN_END}`, 'g'),
  },
];

const JWT: readonly SecretScanRule[] = [
  {
    id: 'jwt',
    pack: 'jwt',
    // Header and payload are base64url JSON objects, so both start with `eyJ`.
    pattern: new RegExp(
      `\\beyJ[A-Za-z0-9_-]{8,8192}\\.eyJ[A-Za-z0-9_-]{8,16384}\\.[A-Za-z0-9_-]{8,8192}${TOKEN_END}`,
      'g',
    ),
  },
];

const SECRET_KEY_NAMES =
  'password|passwd|passphrase|secret|client_secret|clientSecret|api_key|apiKey|apikey|access_token|accessToken|refresh_token|refreshToken|auth_token|authToken|private_key|privateKey|token';

const ASSIGNMENTS: readonly SecretScanRule[] = [
  {
    id: 'json-secret-field',
    pack: 'assignments',
    // "password": "…" — the value of a JSON string field whose name says it
    // is a secret. Escaped characters are part of the value.
    pattern: new RegExp(
      `"(?:${SECRET_KEY_NAMES})"\\s{0,16}:\\s{0,16}"((?:[^"\\\\]|\\\\.){4,4096})"`,
      'gi',
    ),
    valueGroup: 1,
  },
  {
    id: 'secret-assignment',
    pack: 'assignments',
    // password=… in query strings, form bodies, environment files and logs.
    pattern: new RegExp(
      `\\b(?:${SECRET_KEY_NAMES})[ \\t]{0,4}[=:][ \\t]{0,4}([^\\s&"',;<>]{4,4096})`,
      'gi',
    ),
    valueGroup: 1,
  },
];

export const SECRET_SCAN_RULES: Readonly<Record<SecretScanPack, readonly SecretScanRule[]>> =
  Object.freeze({
    credentials: CREDENTIALS,
    jwt: JWT,
    assignments: ASSIGNMENTS,
  });
