/**
 * Plugin settings — what an agent-hosted plugin lets an admin configure,
 * declared in its manifest (`settings: { schemaVersion, fields[] }`), and
 * the contract between the relay and the agent half that holds the values.
 *
 * The agent half is the system of record: it keeps the values in its own
 * data directory (`createSettingsStore` in `@lamalibre/lamaste/agent`) and
 * answers `GET` / `PUT /admin/settings` for Lamaste alone. The relay keeps
 * a cache of the non-secret values and of *when* each secret was set —
 * never a secret's value: a secret exists on the relay only in the memory
 * of the request that carries it through the tunnel to the agent half.
 *
 * Validation is pure and shared by both ends. Its messages never contain a
 * submitted value (a secret typed into the wrong field must not come back
 * in an error, a log line or a response), which is why settings values are
 * checked by hand here and not with zod's enum or literal schemas — zod 3
 * echoes the received value in those messages. A string field's `pattern`
 * is checked only where `checkPattern` is set — the agent half and the
 * form, never the relay, where a manifest's regular expression could stall
 * the panel. A pattern is tested as `new RegExp(pattern, 'u').test(value)`,
 * unanchored: a manifest anchors it with `^` and `$` when it means the
 * whole value.
 *
 * Settings are outside the approval digest: they declare data, not code.
 * When an update changes a field's type, the stored value is dropped on
 * both sides, never converted ({@link settingsSchemaDiff} names those
 * fields for the update preview).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Limits and paths
// ---------------------------------------------------------------------------

export const SETTINGS_FIELD_TYPES = [
  'string',
  'secret',
  'integer',
  'number',
  'boolean',
  'enum',
] as const;

export type SettingsFieldType = (typeof SETTINGS_FIELD_TYPES)[number];

/** At most this many fields in one settings block. */
export const SETTINGS_MAX_FIELDS = 50;

/** A field key: a lower-case letter, then letters and digits, at most 64 characters. */
export const SETTINGS_KEY_RE = /^[a-z][A-Za-z0-9]{0,63}$/;

/** The largest `maxLength` a string or secret field may declare. */
export const SETTINGS_STRING_MAX_LENGTH = 4096;

/** The `maxLength` of a string or secret field that declares none. */
export const SETTINGS_DEFAULT_MAX_LENGTH = 1024;

export const SETTINGS_PATTERN_MAX_LENGTH = 256;

export const SETTINGS_ENUM_MAX_OPTIONS = 100;

/** `GET` (the state) and `PUT` (an update) on the agent half; the forwarder never reaches it. */
export const AGENT_HALF_SETTINGS_PATH = '/admin/settings';

/** `POST` on the agent half: re-read the settings files, after a restore. */
export const AGENT_HALF_SETTINGS_RELOAD_PATH = '/admin/settings/reload';

/** The largest request or response body of a settings call. */
export const AGENT_HALF_SETTINGS_MAX_BYTES = 256 * 1024;

/** Longest `setAt` a state may carry (an ISO 8601 timestamp is 24 characters). */
const SET_AT_MAX_LENGTH = 64;

// ---------------------------------------------------------------------------
// Manifest schema
// ---------------------------------------------------------------------------

const SettingsOptionSchema = z
  .object({
    value: z.string().min(1).max(200),
    label: z.string().min(1).max(100),
  })
  .strict();

/**
 * One field of a settings block. Which properties a field may carry
 * depends on its type; {@link SettingsBlockSchema} checks that, and that a
 * default is itself a valid value.
 */
export const SettingsFieldSchema = z
  .object({
    key: z
      .string()
      .regex(
        SETTINGS_KEY_RE,
        'A setting key starts with a lower-case letter and has only letters and digits (at most 64)',
      ),
    label: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    type: z.enum(SETTINGS_FIELD_TYPES),
    required: z.boolean().optional(),
    /** Never on a secret. */
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    /** string / secret; {@link SETTINGS_DEFAULT_MAX_LENGTH} when unset. */
    maxLength: z.number().int().min(1).max(SETTINGS_STRING_MAX_LENGTH).optional(),
    /** integer / number. */
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    /** string only; compiled with the `u` flag, tested unanchored. */
    pattern: z.string().max(SETTINGS_PATTERN_MAX_LENGTH).optional(),
    /** enum only, and required there. */
    options: z.array(SettingsOptionSchema).min(1).max(SETTINGS_ENUM_MAX_OPTIONS).optional(),
  })
  .strict();

export type SettingsField = z.infer<typeof SettingsFieldSchema>;

/**
 * The manifest's `settings` block. Only on a plugin with an agent half —
 * the agent half stores the values (`ManifestSchema` checks that).
 */
export const SettingsBlockSchema = z
  .object({
    /** Bumped by the plugin when its fields change; an update across versions is refused (409). */
    schemaVersion: z.number().int().min(1),
    fields: z.array(SettingsFieldSchema).min(1).max(SETTINGS_MAX_FIELDS),
  })
  .strict()
  .superRefine((block, ctx) => {
    const keys = new Set<string>();
    block.fields.forEach((field, idx) => {
      const issue = (path: readonly (string | number)[], message: string): void => {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields', idx, ...path], message });
      };
      if (keys.has(field.key)) issue(['key'], `Setting "${field.key}" is declared twice`);
      keys.add(field.key);

      const textual = field.type === 'string' || field.type === 'secret';
      const numeric = field.type === 'integer' || field.type === 'number';
      if (field.maxLength !== undefined && !textual) {
        issue(['maxLength'], '"maxLength" is only for string and secret fields');
      }
      if (field.min !== undefined && !numeric) {
        issue(['min'], '"min" is only for integer and number fields');
      }
      if (field.max !== undefined && !numeric) {
        issue(['max'], '"max" is only for integer and number fields');
      }
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        issue(['min'], '"min" is greater than "max"');
      }
      if (field.pattern !== undefined && field.type !== 'string') {
        issue(['pattern'], '"pattern" is only for string fields');
      }
      if (field.options !== undefined && field.type !== 'enum') {
        issue(['options'], '"options" is only for enum fields');
      }
      if (field.type === 'enum' && field.options === undefined) {
        issue(['options'], 'An enum field needs "options"');
      }
      if (field.options !== undefined) {
        const seen = new Set<string>();
        field.options.forEach((option, optionIdx) => {
          if (seen.has(option.value)) {
            issue(['options', optionIdx, 'value'], 'Option values must be unique');
          }
          seen.add(option.value);
        });
      }

      let patternCompiles = true;
      if (field.pattern !== undefined) {
        try {
          new RegExp(field.pattern, 'u');
        } catch {
          patternCompiles = false;
          issue(['pattern'], '"pattern" is not a valid regular expression (with the "u" flag)');
        }
      }

      if (field.default === undefined) return;
      if (field.type === 'secret') {
        issue(['default'], 'A secret has no default');
        return;
      }
      // An enum without options is reported above; its default could not match anything.
      if (field.type === 'enum' && field.options === undefined) return;
      // A manifest's own default, compiled and tested once at validation.
      const checked = checkSettingsValue(field, field.default, { checkPattern: patternCompiles });
      if (!checked.ok) issue(['default'], `The default is not a valid value: ${checked.message}`);
    });
  });

export type SettingsBlock = z.infer<typeof SettingsBlockSchema>;

export type SettingsValue = string | number | boolean;

export type SettingsValues = Record<string, SettingsValue>;

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export interface SettingsCheckOptions {
  /** Test a string field's `pattern`: the agent half and the form do, the relay never (ReDoS). */
  readonly checkPattern: boolean;
}

export type SettingsValueCheck =
  | { readonly ok: true; readonly value: SettingsValue }
  | { readonly ok: false; readonly message: string };

function rangeCheck(field: SettingsField, value: number): SettingsValueCheck {
  if (field.min !== undefined && value < field.min) {
    return { ok: false, message: `Must be at least ${field.min}` };
  }
  if (field.max !== undefined && value > field.max) {
    return { ok: false, message: `Must be at most ${field.max}` };
  }
  return { ok: true, value };
}

/**
 * Whether `value` is a valid value of `field`: its type, length, range,
 * option and (with `checkPattern`) pattern. A failure's message never
 * contains the value. Shared by the manifest's default check, update
 * validation and the agent half's reconcile; not part of the package's
 * public surface.
 */
export function checkSettingsValue(
  field: SettingsField,
  value: unknown,
  opts: SettingsCheckOptions,
): SettingsValueCheck {
  switch (field.type) {
    case 'string':
    case 'secret': {
      if (typeof value !== 'string') return { ok: false, message: 'Must be a string' };
      if (field.type === 'secret' && value.length === 0) {
        return { ok: false, message: 'Must not be empty' };
      }
      const maxLength = field.maxLength ?? SETTINGS_DEFAULT_MAX_LENGTH;
      if (value.length > maxLength) {
        return { ok: false, message: `Must be at most ${maxLength} characters` };
      }
      if (opts.checkPattern && field.type === 'string' && field.pattern !== undefined) {
        let re: RegExp;
        try {
          re = new RegExp(field.pattern, 'u');
        } catch {
          return { ok: false, message: 'Cannot be checked: the pattern does not compile' };
        }
        if (!re.test(value)) return { ok: false, message: 'Does not match the required format' };
      }
      return { ok: true, value };
    }
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        return { ok: false, message: 'Must be an integer' };
      }
      return rangeCheck(field, value);
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, message: 'Must be a number' };
      }
      return rangeCheck(field, value);
    case 'boolean':
      return typeof value === 'boolean'
        ? { ok: true, value }
        : { ok: false, message: 'Must be true or false' };
    case 'enum':
      if (typeof value !== 'string' || !(field.options ?? []).some((o) => o.value === value)) {
        return { ok: false, message: 'Must be one of the options' };
      }
      return { ok: true, value };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSettingsValue(value: unknown): value is SettingsValue {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSchemaVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/** The stored value of a non-secret field, when there is one that is still valid for it. */
function storedValueOf(field: SettingsField, values: SettingsValues): SettingsValue | undefined {
  if (!Object.hasOwn(values, field.key)) return undefined;
  const checked = checkSettingsValue(field, values[field.key], { checkPattern: false });
  return checked.ok ? checked.value : undefined;
}

export interface SettingsUpdateInput {
  /** Non-secret values; `null` puts a field back to its default (or unset). */
  readonly values?: Record<string, unknown>;
  /** Secrets; `null` clears one. */
  readonly secrets?: Record<string, unknown>;
}

export type SettingsUpdateValidation =
  | {
      readonly ok: true;
      readonly values: Record<string, SettingsValue | null>;
      readonly secrets: Record<string, string | null>;
    }
  | { readonly ok: false; readonly errors: Record<string, string> };

/**
 * Validate a partial update against the schema. An empty update is valid
 * (it changes nothing). `null` clears a field — a non-secret one goes back
 * to its default — refused when that leaves a required field without a value.
 * Errors are keyed by the field's key, or `_` for a malformed envelope (and
 * for a name that could not be a setting key at all, so that nothing but a
 * key is ever echoed). Messages never contain a submitted value.
 */
export function validateSettingsUpdate(
  block: SettingsBlock,
  input: SettingsUpdateInput,
  opts: SettingsCheckOptions,
): SettingsUpdateValidation {
  const errors: [string, string][] = [];
  const failed = new Set<string>();
  const fail = (key: string, message: string): void => {
    if (failed.has(key)) return;
    failed.add(key);
    errors.push([key, message]);
  };
  // Object.fromEntries defines own properties, so a submitted `__proto__`
  // ends up as a key like any other instead of reaching the prototype.
  const failure = (): SettingsUpdateValidation => ({
    ok: false,
    errors: Object.fromEntries(errors),
  });

  if (!isRecord(input)) return { ok: false, errors: { _: 'The update must be an object' } };
  const rawValues: unknown = input.values;
  const rawSecrets: unknown = input.secrets;
  if (rawValues !== undefined && !isRecord(rawValues)) fail('_', '"values" must be an object');
  if (rawSecrets !== undefined && !isRecord(rawSecrets)) fail('_', '"secrets" must be an object');
  if (errors.length > 0) return failure();

  const fields = new Map(block.fields.map((field) => [field.key, field]));
  const unknownSetting = (key: string): void => {
    if (SETTINGS_KEY_RE.test(key)) fail(key, 'Unknown setting');
    else fail('_', 'Unknown setting (not a valid setting name)');
  };

  const values: [string, SettingsValue | null][] = [];
  for (const [key, value] of Object.entries(isRecord(rawValues) ? rawValues : {})) {
    const field = fields.get(key);
    if (!field) {
      unknownSetting(key);
      continue;
    }
    if (field.type === 'secret') {
      fail(key, 'Is a secret; send it in secrets');
      continue;
    }
    if (value === null) {
      // Back to the default: refused only when that leaves a required field empty.
      if (needsValue(field)) fail(key, 'Is required');
      else values.push([key, null]);
      continue;
    }
    const checked = checkSettingsValue(field, value, opts);
    if (checked.ok) values.push([key, checked.value]);
    else fail(key, checked.message);
  }

  const secrets: [string, string | null][] = [];
  for (const [key, value] of Object.entries(isRecord(rawSecrets) ? rawSecrets : {})) {
    const field = fields.get(key);
    if (!field) {
      unknownSetting(key);
      continue;
    }
    if (field.type !== 'secret') {
      fail(key, 'Is not a secret; send it in values');
      continue;
    }
    if (value === null) {
      if (field.required) fail(key, 'Is required');
      else secrets.push([key, null]);
      continue;
    }
    const checked = checkSettingsValue(field, value, opts);
    if (checked.ok && typeof checked.value === 'string') secrets.push([key, checked.value]);
    else fail(key, checked.ok ? 'Must be a string' : checked.message);
  }

  if (errors.length > 0) return failure();
  return { ok: true, values: Object.fromEntries(values), secrets: Object.fromEntries(secrets) };
}

export interface SettingsStatus {
  readonly configured: boolean;
  /** Keys of the required fields without a value, in schema order. */
  readonly missing: string[];
}

/**
 * Required fields without a value: a non-secret one with no stored value
 * (valid for the field) and no default, a secret one that is not set.
 */
export function settingsStatus(
  block: SettingsBlock,
  stored: { readonly values: SettingsValues; readonly secretsSet: readonly string[] },
): SettingsStatus {
  const secretsSet = new Set(stored.secretsSet);
  const missing: string[] = [];
  for (const field of block.fields) {
    if (!field.required) continue;
    if (field.type === 'secret') {
      if (!secretsSet.has(field.key)) missing.push(field.key);
      continue;
    }
    if (field.default !== undefined) continue;
    if (storedValueOf(field, stored.values) === undefined) missing.push(field.key);
  }
  return { configured: missing.length === 0, missing };
}

/**
 * The values a plugin runs with: each non-secret field's stored value, or
 * its default. Only keys the schema knows, only values still valid for the
 * field (type, length, range, option — never the pattern, which is the
 * agent half's to check), and never a secret.
 */
export function effectiveSettingsValues(
  block: SettingsBlock,
  values: SettingsValues,
): SettingsValues {
  const out: [string, SettingsValue][] = [];
  for (const field of block.fields) {
    if (field.type === 'secret') continue;
    const stored = storedValueOf(field, values);
    if (stored !== undefined) out.push([field.key, stored]);
    else if (field.default !== undefined) out.push([field.key, field.default]);
  }
  return Object.fromEntries(out);
}

export interface SettingsSchemaDiff {
  readonly added: string[];
  readonly removed: string[];
  /** Same key, different type: the stored value is dropped, never converted. */
  readonly retyped: string[];
  /** Fields the plugin will need filled after the update (required, no default). */
  readonly newRequired: string[];
}

function needsValue(field: SettingsField): boolean {
  return field.required === true && field.default === undefined;
}

/**
 * What an update changes in the settings schema, for its preview. A field
 * in `newRequired` is required without a default in `next` and was not so
 * in `prev` (absent, optional, or with a default) — or was retyped, which
 * drops its value.
 */
export function settingsSchemaDiff(
  prev: SettingsBlock | null,
  next: SettingsBlock | null,
): SettingsSchemaDiff {
  const before = new Map((prev?.fields ?? []).map((field) => [field.key, field]));
  const after = next?.fields ?? [];
  const afterKeys = new Set(after.map((field) => field.key));
  const added: string[] = [];
  const retyped: string[] = [];
  const newRequired: string[] = [];
  for (const field of after) {
    const old = before.get(field.key);
    if (!old) added.push(field.key);
    const isRetyped = old !== undefined && old.type !== field.type;
    if (isRetyped) retyped.push(field.key);
    if (needsValue(field) && (old === undefined || isRetyped || !needsValue(old))) {
      newRequired.push(field.key);
    }
  }
  const removed = [...before.keys()].filter((key) => !afterKeys.has(key));
  return { added, removed, retyped, newRequired };
}

// ---------------------------------------------------------------------------
// Wire contract between the relay and the agent half
// ---------------------------------------------------------------------------

/** `GET /admin/settings` (and the answer to a successful `PUT`). */
export interface AgentHalfSettingsState {
  readonly schemaVersion: number;
  /** ≥ 0; +1 per successful update. */
  readonly revision: number;
  /** The explicitly stored non-secret values — no defaults. */
  readonly values: SettingsValues;
  /** The secrets that are set, and when — NEVER a value. */
  readonly secrets: Record<string, { readonly setAt: string }>;
  readonly configured: boolean;
  readonly missing: string[];
}

/** `PUT /admin/settings`. */
export interface AgentHalfSettingsUpdate {
  /** The relay's installed manifest's `settings.schemaVersion`. */
  readonly schemaVersion: number;
  /** The revision the admin edited. */
  readonly baseRevision: number;
  /** `null`: back to the default, or unset. */
  readonly values: Record<string, SettingsValue | null>;
  /** `null`: clear. */
  readonly secrets: Record<string, string | null>;
}

/**
 * The agent half's answer to `GET /admin/settings`, or null on any shape
 * error. Builds a fresh object, so nothing the agent half sent beyond the
 * contract — a secret's value in particular — survives parsing.
 */
export function parseAgentHalfSettingsState(raw: unknown): AgentHalfSettingsState | null {
  if (!isRecord(raw)) return null;
  const { schemaVersion, revision, values, secrets, configured, missing } = raw;
  if (!isSchemaVersion(schemaVersion) || !isRevision(revision)) return null;
  if (typeof configured !== 'boolean') return null;
  if (!isRecord(values) || !isRecord(secrets) || !Array.isArray(missing)) return null;

  const valueEntries = Object.entries(values);
  if (valueEntries.length > SETTINGS_MAX_FIELDS) return null;
  const outValues: [string, SettingsValue][] = [];
  for (const [key, value] of valueEntries) {
    if (!SETTINGS_KEY_RE.test(key) || !isSettingsValue(value)) return null;
    if (typeof value === 'string' && value.length > SETTINGS_STRING_MAX_LENGTH) return null;
    outValues.push([key, value]);
  }

  const secretEntries = Object.entries(secrets);
  if (secretEntries.length > SETTINGS_MAX_FIELDS) return null;
  const outSecrets: [string, { readonly setAt: string }][] = [];
  for (const [key, entry] of secretEntries) {
    if (!SETTINGS_KEY_RE.test(key) || !isRecord(entry)) return null;
    const setAt = entry['setAt'];
    if (typeof setAt !== 'string' || setAt.length === 0 || setAt.length > SET_AT_MAX_LENGTH) {
      return null;
    }
    outSecrets.push([key, { setAt }]);
  }

  if (missing.length > SETTINGS_MAX_FIELDS) return null;
  const outMissing: string[] = [];
  for (const key of missing as unknown[]) {
    if (typeof key !== 'string' || !SETTINGS_KEY_RE.test(key)) return null;
    outMissing.push(key);
  }

  return {
    schemaVersion,
    revision,
    values: Object.fromEntries(outValues),
    secrets: Object.fromEntries(outSecrets),
    configured,
    missing: outMissing,
  };
}

/**
 * A `PUT /admin/settings` body, or null on any shape error. Only the
 * envelope: whether each value suits its field is
 * {@link validateSettingsUpdate}'s to say, with a message per field.
 */
export function parseAgentHalfSettingsUpdate(raw: unknown): AgentHalfSettingsUpdate | null {
  if (!isRecord(raw)) return null;
  const { schemaVersion, baseRevision, values, secrets } = raw;
  if (!isSchemaVersion(schemaVersion) || !isRevision(baseRevision)) return null;
  if (!isRecord(values) || !isRecord(secrets)) return null;

  const valueEntries = Object.entries(values);
  if (valueEntries.length > SETTINGS_MAX_FIELDS) return null;
  const outValues: [string, SettingsValue | null][] = [];
  for (const [key, value] of valueEntries) {
    if (!SETTINGS_KEY_RE.test(key)) return null;
    if (value !== null && !isSettingsValue(value)) return null;
    outValues.push([key, value]);
  }

  const secretEntries = Object.entries(secrets);
  if (secretEntries.length > SETTINGS_MAX_FIELDS) return null;
  const outSecrets: [string, string | null][] = [];
  for (const [key, value] of secretEntries) {
    if (!SETTINGS_KEY_RE.test(key)) return null;
    if (value !== null && typeof value !== 'string') return null;
    outSecrets.push([key, value]);
  }

  return {
    schemaVersion,
    baseRevision,
    values: Object.fromEntries(outValues),
    secrets: Object.fromEntries(outSecrets),
  };
}
