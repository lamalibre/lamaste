/**
 * Settings secrets on the wire — how a secret value an administrator typed
 * travels from the relay's panel to the agent half without being readable
 * by anything in between.
 *
 * The relay calls `PUT /admin/settings` through the plugin's internal
 * tunnel, whose ends are loopback ports. Whatever takes such a port while
 * the tunnel or the agent half is down receives the request, so a secret
 * must not travel in clear even there: each value is sealed with
 * AES-256-GCM under a key both ends derive from the installation secret,
 *
 *     key = HKDF-SHA256(ikm  = the 32 bytes of the installation secret,
 *                       salt = "lamaste/settings-secrets/v1",
 *                       info = the plugin's route), 32 bytes
 *
 * with 12 random IV bytes per value and, as additional data,
 * `JSON.stringify([plugin, nonce, key, baseRevision])` — the plugin, the
 * caller assertion's nonce, the setting's key and the revision the change
 * was made against. A sealed value therefore opens only for that plugin,
 * in the one request whose assertion carries that nonce, for that field
 * and on top of that revision: moved to another field, replayed in another
 * request or applied to another revision, it does not decrypt.
 *
 * Wire form: `{ v: 1, iv: <base64url, 12 bytes>, ct: <base64url,
 * ciphertext followed by the 16-byte tag> }`. Neither function's errors
 * ever contain the value.
 *
 * Residual (documented, not fixed here): the agent account and the agent
 * half's own service account hold the installation secret, so they can
 * read secrets in transit as well as at rest.
 */

import crypto from 'node:crypto';

/** The version of the sealed form ({@link EncryptedSettingsSecret.v}). */
export const SETTINGS_SECRET_ENCRYPTION_VERSION = 1 as const;

/** IV bytes per sealed value (GCM's standard nonce size). */
export const SETTINGS_SECRET_IV_BYTES = 12;

/** The GCM authentication tag, appended to the ciphertext. */
export const SETTINGS_SECRET_TAG_BYTES = 16;

const KEY_BYTES = 32;
const HKDF_SALT = Buffer.from('lamaste/settings-secrets/v1', 'utf-8');

/*
 * The formats `caller-assertion.ts` defines. That module imports this one
 * (a verified assertion decrypts with the secret that verified it), so this
 * one cannot import them back.
 */
const HOSTING_SECRET_RE = /^[a-f0-9]{64}$/;
const NONCE_RE = /^[a-f0-9]{32}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** A secret value as it travels from the relay to the agent half. */
export interface EncryptedSettingsSecret {
  readonly v: typeof SETTINGS_SECRET_ENCRYPTION_VERSION;
  /** base64url of the 12 IV bytes. */
  readonly iv: string;
  /** base64url of the ciphertext followed by the 16-byte tag. */
  readonly ct: string;
}

/** What a sealed value is bound to; both ends must name the same. */
export interface SettingsSecretContext {
  /** The installation secret (64 hex characters) the request is signed with. */
  readonly secret: string;
  /** The plugin's route. */
  readonly plugin: string;
  /** The nonce of the caller assertion of the request that carries the value. */
  readonly nonce: string;
  /** The setting's key. */
  readonly key: string;
  /** The revision the change is made against (`baseRevision` of the update). */
  readonly baseRevision: number;
}

function checkContext(ctx: SettingsSecretContext): void {
  if (typeof ctx.secret !== 'string' || !HOSTING_SECRET_RE.test(ctx.secret)) {
    throw new Error('Invalid installation secret format');
  }
  if (typeof ctx.nonce !== 'string' || !NONCE_RE.test(ctx.nonce)) {
    throw new Error('Invalid caller assertion nonce');
  }
  if (typeof ctx.plugin !== 'string' || ctx.plugin.length === 0) {
    throw new Error('A sealed secret names its plugin');
  }
  if (typeof ctx.key !== 'string' || ctx.key.length === 0) {
    throw new Error('A sealed secret names its setting');
  }
  if (!Number.isSafeInteger(ctx.baseRevision) || ctx.baseRevision < 0) {
    throw new Error('A sealed secret names the revision it is made against');
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

function additionalData(ctx: SettingsSecretContext): Buffer {
  return Buffer.from(JSON.stringify([ctx.plugin, ctx.nonce, ctx.key, ctx.baseRevision]), 'utf-8');
}

/** Bytes of a base64url string, or null when it is not one in its canonical spelling. */
function base64urlBytes(text: unknown): Buffer | null {
  if (typeof text !== 'string' || !BASE64URL_RE.test(text)) return null;
  const bytes = Buffer.from(text, 'base64url');
  // Node's decoder skips what it cannot read; only the canonical spelling
  // of the bytes is accepted, so one value has one wire form.
  return bytes.toString('base64url') === text ? bytes : null;
}

/** Seal one secret value for one request (see the module comment for the binding). */
export function encryptSettingsSecret(
  input: SettingsSecretContext & { readonly value: string },
): EncryptedSettingsSecret {
  checkContext(input);
  if (typeof input.value !== 'string') throw new Error('A settings secret is a string');
  const iv = crypto.randomBytes(SETTINGS_SECRET_IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey(input.secret, input.plugin), iv, {
    authTagLength: SETTINGS_SECRET_TAG_BYTES,
  });
  cipher.setAAD(additionalData(input));
  const ciphertext = Buffer.concat([cipher.update(input.value, 'utf-8'), cipher.final()]);
  return {
    v: SETTINGS_SECRET_ENCRYPTION_VERSION,
    iv: iv.toString('base64url'),
    ct: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString('base64url'),
  };
}

/**
 * Open a sealed secret value. Throws — with a message that never contains
 * the value, the key material or the ciphertext — when it was sealed for
 * another plugin, nonce, key or revision, under another installation
 * secret, or was altered.
 */
export function decryptSettingsSecret(
  input: SettingsSecretContext & { readonly sealed: EncryptedSettingsSecret },
): string {
  checkContext(input);
  const sealed: unknown = input.sealed;
  const failed = (): Error => new Error('The secret could not be decrypted');
  if (typeof sealed !== 'object' || sealed === null) throw failed();
  const { v, iv: ivText, ct: ctText } = sealed as Record<string, unknown>;
  if (v !== SETTINGS_SECRET_ENCRYPTION_VERSION) throw failed();
  const iv = base64urlBytes(ivText);
  const ct = base64urlBytes(ctText);
  if (!iv || iv.length !== SETTINGS_SECRET_IV_BYTES) throw failed();
  if (!ct || ct.length < SETTINGS_SECRET_TAG_BYTES) throw failed();
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      derivedKey(input.secret, input.plugin),
      iv,
      { authTagLength: SETTINGS_SECRET_TAG_BYTES },
    );
    decipher.setAAD(additionalData(input));
    decipher.setAuthTag(ct.subarray(ct.length - SETTINGS_SECRET_TAG_BYTES));
    const plain = Buffer.concat([
      decipher.update(ct.subarray(0, ct.length - SETTINGS_SECRET_TAG_BYTES)),
      decipher.final(),
    ]);
    // A value is UTF-8 text; bytes that are not would come back altered.
    const text = plain.toString('utf-8');
    if (!Buffer.from(text, 'utf-8').equals(plain)) throw failed();
    return text;
  } catch {
    // OpenSSL's own messages say nothing of the value, but they are not
    // this function's to pass on.
    throw failed();
  }
}

/**
 * Whether `raw` has the sealed form with sizes in bounds: `v: 1`, an IV of
 * exactly 12 bytes and a ciphertext of at least one byte plus the tag and
 * at most `maxPlaintextBytes` plus the tag, both base64url in their
 * canonical spelling. Builds a fresh object, so nothing beyond the form
 * survives. Not part of the package's public surface: the update parser
 * (`plugin-settings.ts`) is the caller.
 */
export function parseEncryptedSettingsSecret(
  raw: unknown,
  maxPlaintextBytes: number,
): EncryptedSettingsSecret | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { v, iv, ct } = raw as Record<string, unknown>;
  if (v !== SETTINGS_SECRET_ENCRYPTION_VERSION) return null;
  if (Object.keys(raw).length !== 3) return null;
  // Lengths first, so an oversized string is never decoded.
  const maxCtChars = Math.ceil(((maxPlaintextBytes + SETTINGS_SECRET_TAG_BYTES) * 4) / 3);
  if (typeof iv !== 'string' || iv.length !== 16) return null;
  if (typeof ct !== 'string' || ct.length > maxCtChars) return null;
  const ivBytes = base64urlBytes(iv);
  const ctBytes = base64urlBytes(ct);
  if (!ivBytes || ivBytes.length !== SETTINGS_SECRET_IV_BYTES) return null;
  if (
    !ctBytes ||
    ctBytes.length <= SETTINGS_SECRET_TAG_BYTES ||
    ctBytes.length > maxPlaintextBytes + SETTINGS_SECRET_TAG_BYTES
  ) {
    return null;
  }
  return { v: SETTINGS_SECRET_ENCRYPTION_VERSION, iv, ct };
}
