/**
 * The identity feed's changes on the wire — sealed, so a member's username,
 * name and address cross the internal tunnel readable by the agent half
 * alone.
 *
 * The panel sends `POST /admin/identity/changes` through the plugin's
 * internal tunnel, whose ends are loopback ports: the chisel server's on
 * the relay, the agent's on the agent. Whatever takes such a port while the
 * tunnel or the agent half is down receives the request — and every process
 * on either machine can read loopback traffic it holds. The batch envelope
 * (directory, cursors, flags, pass) is no one's personal data and travels
 * in clear; its `changes` array travels sealed with AES-256-GCM under a key
 * both ends derive from the installation secret,
 *
 *     key = HKDF-SHA256(ikm  = the 32 bytes of the installation secret,
 *                       salt = "lamaste/identity-changes/v1",
 *                       info = the plugin's route), 32 bytes
 *
 * — domain-separated from the settings secrets' key (`settings-secrets.ts`,
 * salt `lamaste/settings-secrets/v1`), so a value sealed for one never opens
 * as the other — with 12 random IV bytes and, as additional data,
 * `JSON.stringify([plugin, nonce, directoryId, from, to, reset, reconcile,
 * pass, final])`: the plugin, the caller assertion's nonce and the whole
 * envelope. Sealed changes therefore open only for that plugin, in the one
 * request whose assertion carries that nonce, inside that envelope: replayed
 * in another request, or moved under another cursor or flags, they do not
 * decrypt.
 *
 * Wire form, in place of the array: `changes: { v: 1, iv: <base64url, 12
 * bytes>, ct: <base64url, the JSON array's UTF-8 bytes encrypted, followed
 * by the 16-byte tag> }`. Errors never contain the plaintext.
 *
 * Residual (as for settings secrets): the agent account and the agent
 * half's own service account hold the installation secret.
 */

import crypto from 'node:crypto';

/** The version of the sealed form. */
export const IDENTITY_CHANGES_SEAL_VERSION = 1 as const;

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HKDF_SALT = Buffer.from('lamaste/identity-changes/v1', 'utf-8');

/*
 * The formats `caller-assertion.ts` defines. That module imports this one
 * (a verified assertion opens the changes with the secret that verified
 * it), so this one cannot import them back.
 */
const HOSTING_SECRET_RE = /^[a-f0-9]{64}$/;
const NONCE_RE = /^[a-f0-9]{32}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** The `changes` of a batch as they travel. */
export interface SealedIdentityChanges {
  readonly v: typeof IDENTITY_CHANGES_SEAL_VERSION;
  /** base64url of the 12 IV bytes. */
  readonly iv: string;
  /** base64url of the ciphertext followed by the 16-byte tag. */
  readonly ct: string;
}

/** The batch envelope the sealed changes are bound to — everything but `changes`. */
export interface IdentityChangesEnvelope {
  readonly directoryId: string;
  readonly from: number;
  readonly to: number;
  readonly reset: boolean;
  readonly reconcile: boolean;
  readonly pass: string;
  readonly final: boolean;
}

/** What sealed changes are bound to; both ends must name the same. */
export interface IdentityChangesSealContext {
  /** The installation secret (64 hex characters) the request is signed with. */
  readonly secret: string;
  /** The plugin's route. */
  readonly plugin: string;
  /** The nonce of the caller assertion of the request that carries them. */
  readonly nonce: string;
  readonly envelope: IdentityChangesEnvelope;
}

function checkContext(ctx: IdentityChangesSealContext): void {
  if (typeof ctx.secret !== 'string' || !HOSTING_SECRET_RE.test(ctx.secret)) {
    throw new Error('Invalid installation secret format');
  }
  if (typeof ctx.nonce !== 'string' || !NONCE_RE.test(ctx.nonce)) {
    throw new Error('Invalid caller assertion nonce');
  }
  if (typeof ctx.plugin !== 'string' || ctx.plugin.length === 0) {
    throw new Error('Sealed identity changes name their plugin');
  }
  const e = ctx.envelope;
  if (
    typeof e !== 'object' ||
    e === null ||
    typeof e.directoryId !== 'string' ||
    !Number.isSafeInteger(e.from) ||
    !Number.isSafeInteger(e.to) ||
    typeof e.reset !== 'boolean' ||
    typeof e.reconcile !== 'boolean' ||
    typeof e.pass !== 'string' ||
    typeof e.final !== 'boolean'
  ) {
    throw new Error('Sealed identity changes are bound to a batch envelope');
  }
}

function derivedKey(secret: string, plugin: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(secret, 'hex'),
      HKDF_SALT,
      Buffer.from(plugin, 'utf-8'),
      KEY_BYTES,
    ),
  );
}

function additionalData(ctx: IdentityChangesSealContext): Buffer {
  const e = ctx.envelope;
  return Buffer.from(
    JSON.stringify([
      ctx.plugin,
      ctx.nonce,
      e.directoryId,
      e.from,
      e.to,
      e.reset,
      e.reconcile,
      e.pass,
      e.final,
    ]),
    'utf-8',
  );
}

/** Bytes of a base64url string, or null when it is not one in its canonical spelling. */
function base64urlBytes(text: unknown): Buffer | null {
  if (typeof text !== 'string' || !BASE64URL_RE.test(text)) return null;
  const bytes = Buffer.from(text, 'base64url');
  return bytes.toString('base64url') === text ? bytes : null;
}

/** Seal a batch's changes for one request (see the module comment for the binding). */
export function sealIdentityChanges(
  input: IdentityChangesSealContext & { readonly changes: readonly unknown[] },
): SealedIdentityChanges {
  checkContext(input);
  if (!Array.isArray(input.changes)) throw new Error('Identity changes are a list');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey(input.secret, input.plugin), iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(additionalData(input));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(input.changes), 'utf-8'),
    cipher.final(),
  ]);
  return {
    v: IDENTITY_CHANGES_SEAL_VERSION,
    iv: iv.toString('base64url'),
    ct: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString('base64url'),
  };
}

/**
 * Whether `raw` has the sealed form: `v: 1`, an IV of exactly 12 bytes, a
 * ciphertext longer than the tag, both base64url in their canonical
 * spelling, nothing else. Builds a fresh object.
 */
export function parseSealedIdentityChanges(raw: unknown): SealedIdentityChanges | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { v, iv, ct } = raw as Record<string, unknown>;
  if (v !== IDENTITY_CHANGES_SEAL_VERSION || Object.keys(raw).length !== 3) return null;
  if (typeof iv !== 'string' || iv.length !== 16) return null;
  const ivBytes = base64urlBytes(iv);
  const ctBytes = base64urlBytes(ct);
  if (!ivBytes || ivBytes.length !== IV_BYTES) return null;
  if (!ctBytes || ctBytes.length <= TAG_BYTES) return null;
  return { v: IDENTITY_CHANGES_SEAL_VERSION, iv, ct: ct as string };
}

/**
 * Open sealed changes: the parsed JSON (the batch parser checks it is the
 * contract). Throws — with a message that never contains the changes, the
 * key material or the ciphertext — when they were sealed for another
 * plugin, nonce or envelope, under another installation secret, were
 * altered, or are not JSON.
 */
export function openIdentityChanges(
  input: IdentityChangesSealContext & { readonly sealed: SealedIdentityChanges },
): unknown {
  checkContext(input);
  const failed = (): Error => new Error('The identity changes could not be opened');
  const sealed = parseSealedIdentityChanges(input.sealed);
  const iv = sealed ? base64urlBytes(sealed.iv) : null;
  const ct = sealed ? base64urlBytes(sealed.ct) : null;
  if (!iv || !ct) throw failed();
  let plain: Buffer;
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      derivedKey(input.secret, input.plugin),
      iv,
      { authTagLength: TAG_BYTES },
    );
    decipher.setAAD(additionalData(input));
    decipher.setAuthTag(ct.subarray(ct.length - TAG_BYTES));
    plain = Buffer.concat([
      decipher.update(ct.subarray(0, ct.length - TAG_BYTES)),
      decipher.final(),
    ]);
  } catch {
    throw failed();
  }
  try {
    return JSON.parse(plain.toString('utf-8')) as unknown;
  } catch {
    throw failed();
  }
}
