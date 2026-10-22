/**
 * Identity — who a plugin's users are, as Lamaste tells its agent half.
 *
 * An agent-hosted plugin declares its roles and the user attributes it may
 * receive in its manifest's `identity` block ({@link IdentityBlockSchema}).
 * The block enters the plugin's approval digest when present (`hook-set.ts`
 * — a plugin without it keeps its digest), and an update that adds or
 * removes a role or widens the attributes waits for approval again
 * ({@link identityChangeNeedsApproval}); narrowing and label edits only
 * change the digest.
 *
 * The plugin's **audience** is the users entitled to it, each with the
 * plugin's roles and only the declared attributes ({@link AudienceMember}).
 * The panel pushes it to the agent half through the internal tunnel, since
 * the agent half cannot reach the panel:
 *
 *     POST /admin/identity/notify  { protocol, directoryId, seq }
 *       → { protocol, directoryId, cursor }      what the half holds
 *     POST /admin/identity/changes { protocol, directoryId, from, to, reset,
 *                                    reconcile, pass, final, changes }
 *       → { protocol, directoryId, cursor, mismatches? }
 *
 * Both are Lamaste's own calls (`callAgentHalf`: caller `lamaste`, the body
 * hash bound, the responder over the answer body); the forwarder reserves
 * `/admin/identity*`. A batch's `changes` travel sealed to the request
 * (`identity-seal.ts`, {@link parseIdentityChangesWire}): the tunnel's
 * loopback ends never carry a member's attributes in clear. Each change is
 * the member's full state (`upsert`) or
 * a `remove` with its reason: `deleted` and `unentitled` carry the last
 * known declared attributes (`last`), so history stays readable; `erased`
 * carries none, and the half scrubs the row to the bare `userId`. Changes
 * are numbered by the directory's store-wide `seq`; the half's cursor is
 * the `to` of the last batch it applied (`createIdentityProjection` in
 * `@lamalibre/lamaste/agent`). A replay from 0 under one `pass` is the
 * snapshot — `reset` (the directory changed, or the cursor is void) or the
 * daily `reconcile` — and at its `final` batch the half marks every row the
 * pass did not mention as removed and reports the mismatches it found.
 *
 * Wire parsers return null for anything that is not the contract, and say
 * nothing about why: zod's messages may echo a received value, and the
 * values here are personal data.
 *
 * See `plugin-development/design/agent-hosted-app-plugins.md`, "Slice 6".
 */

import { z } from 'zod';

import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_REGEX } from './constants.js';
import { parseSealedIdentityChanges } from './identity-seal.js';
import type { IdentityChangesEnvelope, SealedIdentityChanges } from './identity-seal.js';
import { displayText } from './plugin-settings.js';

// ---------------------------------------------------------------------------
// Limits, paths and formats
// ---------------------------------------------------------------------------

/** The version of the feed's contract; every request and answer carries it. */
export const IDENTITY_PROTOCOL_VERSION = 1 as const;

/** The agent half's identity routes; the forwarder never reaches anything under it. */
export const AGENT_HALF_IDENTITY_PREFIX = '/admin/identity';

/** `POST`: the panel's head moved — the half answers what it holds. */
export const AGENT_HALF_IDENTITY_NOTIFY_PATH = `${AGENT_HALF_IDENTITY_PREFIX}/notify`;

/** `POST`: a batch of changes. */
export const AGENT_HALF_IDENTITY_CHANGES_PATH = `${AGENT_HALF_IDENTITY_PREFIX}/changes`;

/** At most this many changes in one batch. */
export const IDENTITY_BATCH_MAX_CHANGES = 500;

/** The largest request body of an identity call (a batch at most). */
export const IDENTITY_BATCH_MAX_BYTES = 1024 * 1024;

/** Larger than any answer of an identity call (the 409 included). */
export const IDENTITY_ANSWER_MAX_BYTES = 4096;

/** A role id: a lower-case letter, then lower-case letters, digits and `-`; at most 32. */
export const IDENTITY_ROLE_ID_REGEX = /^[a-z][a-z0-9-]{0,31}$/;

/** At most this many roles in a manifest — and so on a member. */
export const IDENTITY_ROLES_MAX = 32;

/** A user id, a directory id, a pass id: a UUID v4, lower case. */
export const IDENTITY_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The user attributes a plugin may declare — and so receive. */
export const IDENTITY_ATTRIBUTES = ['displayName', 'email'] as const;

export type IdentityAttribute = (typeof IDENTITY_ATTRIBUTES)[number];

/** What a plugin receives when its `identity` block declares no `attributes`. */
export const DEFAULT_IDENTITY_ATTRIBUTES: readonly IdentityAttribute[] = ['displayName'];

/** Why a user left a plugin's audience. */
export const AUDIENCE_REMOVE_REASONS = ['deleted', 'unentitled', 'erased'] as const;

export type AudienceRemoveReason = (typeof AUDIENCE_REMOVE_REASONS)[number];

/** A display name as the users API accepts one. */
export const IDENTITY_DISPLAY_NAME_MAX_LENGTH = 100;

/** The longest address RFC 5321 allows on the wire. */
export const IDENTITY_EMAIL_MAX_LENGTH = 254;

/** Whether `value` is a lower-case UUID v4 — a user id, a directory id, a pass id. */
export function isIdentityUuid(value: unknown): value is string {
  return typeof value === 'string' && IDENTITY_UUID_REGEX.test(value);
}

/**
 * Whether `value` is a plugin's roles as a member holds them: 1 to
 * {@link IDENTITY_ROLES_MAX} role ids, none repeated.
 */
export function isIdentityRoleList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= IDENTITY_ROLES_MAX &&
    value.every((role) => typeof role === 'string' && IDENTITY_ROLE_ID_REGEX.test(role)) &&
    new Set(value).size === value.length
  );
}

// ---------------------------------------------------------------------------
// Manifest block
// ---------------------------------------------------------------------------

export const IdentityRoleSchema = z
  .object({
    id: z
      .string()
      .regex(
        IDENTITY_ROLE_ID_REGEX,
        'A role id starts with a lower-case letter and has only lower-case letters, digits and hyphens (at most 32)',
      ),
    label: displayText(z.string().min(1).max(64)),
    description: displayText(z.string().max(200)).optional(),
  })
  .strict();

/**
 * The manifest's `identity` block: the plugin's roles (1 to
 * {@link IDENTITY_ROLES_MAX}, ids unique) and the user attributes it may
 * receive (a subset of {@link IDENTITY_ATTRIBUTES}, default
 * {@link DEFAULT_IDENTITY_ATTRIBUTES}). Only an agent-hosted plugin with an
 * agent half may declare it (`ManifestSchema` checks that): its users
 * reach the agent half.
 */
export const IdentityBlockSchema = z
  .object({
    roles: z
      .array(IdentityRoleSchema)
      .min(1)
      .max(IDENTITY_ROLES_MAX)
      .refine((roles) => new Set(roles.map((r) => r.id)).size === roles.length, {
        message: 'Role ids must be unique',
      }),
    attributes: z
      .array(z.enum(IDENTITY_ATTRIBUTES))
      .max(IDENTITY_ATTRIBUTES.length)
      .refine((attributes) => new Set(attributes).size === attributes.length, {
        message: 'attributes must not repeat',
      })
      .default(() => [...DEFAULT_IDENTITY_ATTRIBUTES]),
  })
  .strict();

/** The block as a manifest writes it (`attributes` optional). */
export type IdentityBlockInput = z.input<typeof IdentityBlockSchema>;

/** The block as parsed (`attributes` defaulted). */
export type IdentityBlock = z.output<typeof IdentityBlockSchema>;

export type IdentityRole = z.output<typeof IdentityRoleSchema>;

/** The canonical form: roles sorted by id, attributes sorted, the default applied. */
export interface NormalizedIdentityBlock {
  readonly roles: readonly IdentityRole[];
  readonly attributes: readonly IdentityAttribute[];
}

/**
 * The canonical form of an identity block — what the approval digest and
 * the approval preview work from: roles sorted by id (a description only
 * where one is declared), attributes sorted, the default applied when the
 * block declares none. Throws when `block` is not a valid identity block —
 * such a block cannot be approved.
 */
export function normalizeIdentityBlock(block: IdentityBlockInput): NormalizedIdentityBlock {
  const parsed = IdentityBlockSchema.safeParse(block);
  if (!parsed.success) {
    throw new Error(
      `Not a valid identity block (${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')})`,
    );
  }
  const roles = parsed.data.roles
    .map(
      (role): IdentityRole => ({
        id: role.id,
        label: role.label,
        ...(role.description !== undefined ? { description: role.description } : {}),
      }),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const attributes = IDENTITY_ATTRIBUTES.filter((a) => parsed.data.attributes.includes(a));
  return { roles, attributes };
}

/** What an update changes in a plugin's identity block. */
export interface IdentityDiff {
  readonly rolesAdded: readonly string[];
  readonly rolesRemoved: readonly string[];
  readonly attributesAdded: readonly IdentityAttribute[];
  readonly attributesRemoved: readonly IdentityAttribute[];
  /** Ids of roles in both whose label or description changed. */
  readonly labelsChanged: readonly string[];
}

/**
 * What changes from `before` to `after` (either null: the plugin declares
 * no identity — no roles, no attributes). Lists are sorted. Throws on a
 * block that is not valid ({@link normalizeIdentityBlock}).
 */
export function identityDiff(
  before: IdentityBlockInput | null,
  after: IdentityBlockInput | null,
): IdentityDiff {
  const empty: NormalizedIdentityBlock = { roles: [], attributes: [] };
  const a = before === null ? empty : normalizeIdentityBlock(before);
  const b = after === null ? empty : normalizeIdentityBlock(after);
  const rolesBefore = new Map(a.roles.map((r) => [r.id, r]));
  const rolesAfter = new Map(b.roles.map((r) => [r.id, r]));
  const labelsChanged: string[] = [];
  for (const [id, role] of rolesAfter) {
    const previous = rolesBefore.get(id);
    if (previous && (previous.label !== role.label || previous.description !== role.description)) {
      labelsChanged.push(id);
    }
  }
  return {
    rolesAdded: [...rolesAfter.keys()].filter((id) => !rolesBefore.has(id)),
    rolesRemoved: [...rolesBefore.keys()].filter((id) => !rolesAfter.has(id)),
    attributesAdded: b.attributes.filter((x) => !a.attributes.includes(x)),
    attributesRemoved: a.attributes.filter((x) => !b.attributes.includes(x)),
    labelsChanged,
  };
}

/**
 * Whether an identity change waits for an admin's approval: a role added
 * or removed, or an attribute added (the plugin would receive more about
 * its users). Narrowing the attributes and editing labels do not — they
 * only change the digest. Auto-approve never covers it.
 */
export function identityChangeNeedsApproval(diff: IdentityDiff): boolean {
  return (
    diff.rolesAdded.length > 0 || diff.rolesRemoved.length > 0 || diff.attributesAdded.length > 0
  );
}

// ---------------------------------------------------------------------------
// The feed (panel → agent half)
// ---------------------------------------------------------------------------

const UuidSchema = z.string().regex(IDENTITY_UUID_REGEX);
const UsernameSchema = z
  .string()
  .min(USERNAME_MIN_LENGTH)
  .max(USERNAME_MAX_LENGTH)
  .regex(USERNAME_REGEX);
const DisplayNameSchema = displayText(z.string().min(1).max(IDENTITY_DISPLAY_NAME_MAX_LENGTH));
const EmailSchema = z.string().max(IDENTITY_EMAIL_MAX_LENGTH).email();
const SeqSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const CursorSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const RoleListSchema = z
  .array(z.string().regex(IDENTITY_ROLE_ID_REGEX))
  .min(1)
  .max(IDENTITY_ROLES_MAX)
  .refine((roles) => new Set(roles).size === roles.length);

/**
 * A member of a plugin's audience: the user's stable id, username, the
 * declared attributes the directory has (`displayName`, `email` — only the
 * ones the plugin declared), the plugin's roles, the status and the
 * record's version.
 */
export const AudienceMemberSchema = z
  .object({
    userId: UuidSchema,
    username: UsernameSchema,
    displayName: DisplayNameSchema.optional(),
    email: EmailSchema.optional(),
    roles: RoleListSchema,
    status: z.enum(['active', 'disabled']),
    version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export type AudienceMember = z.infer<typeof AudienceMemberSchema>;

/** The last known declared attributes of a user who left the audience (`deleted`, `unentitled`). */
export const AudienceLastKnownSchema = z
  .object({
    username: UsernameSchema,
    displayName: DisplayNameSchema.optional(),
    email: EmailSchema.optional(),
  })
  .strict();

export type AudienceLastKnown = z.infer<typeof AudienceLastKnownSchema>;

const AudienceUpsertSchema = z
  .object({ seq: SeqSchema, kind: z.literal('upsert'), member: AudienceMemberSchema })
  .strict();

const AudienceRemoveSchema = z
  .object({
    seq: SeqSchema,
    kind: z.literal('remove'),
    userId: UuidSchema,
    reason: z.enum(AUDIENCE_REMOVE_REASONS),
    last: AudienceLastKnownSchema.optional(),
  })
  .strict()
  .refine((change) => (change.reason === 'erased') === (change.last === undefined));

/**
 * One change of the feed: a member's full new state, or a removal. `last`
 * is required for `deleted` and `unentitled` and forbidden for `erased`.
 */
export const AudienceChangeSchema = z.union([AudienceUpsertSchema, AudienceRemoveSchema]);

export type AudienceChange = z.infer<typeof AudienceChangeSchema>;

/** `POST /admin/identity/notify`: the panel's directory and its head. */
export const IdentityNotifyRequestSchema = z
  .object({
    protocol: z.literal(IDENTITY_PROTOCOL_VERSION),
    directoryId: UuidSchema,
    seq: CursorSchema,
  })
  .strict();

export type IdentityNotifyRequest = z.infer<typeof IdentityNotifyRequestSchema>;

/** The half's answer to a notification: its directory (null before the first batch) and cursor. */
export const IdentityNotifyAnswerSchema = z
  .object({
    protocol: z.literal(IDENTITY_PROTOCOL_VERSION),
    directoryId: UuidSchema.nullable(),
    cursor: CursorSchema,
  })
  .strict();

export type IdentityNotifyAnswer = z.infer<typeof IdentityNotifyAnswerSchema>;

/**
 * `POST /admin/identity/changes`: the changes of `(from, to]`, in strictly
 * increasing `seq`, at most {@link IDENTITY_BATCH_MAX_CHANGES} of them.
 * `reset` starts a replay from 0 (`from` must be 0): the half adopts
 * `directoryId` and restarts its cursor. `reconcile` marks a batch of the
 * daily check: the half counts every change that differs from its row.
 * `pass` names the replay the batch belongs to; at the replay's `final`
 * batch the half removes the rows the pass did not mention.
 */
export const IdentityChangesRequestSchema = z
  .object({
    protocol: z.literal(IDENTITY_PROTOCOL_VERSION),
    directoryId: UuidSchema,
    from: CursorSchema,
    to: CursorSchema,
    reset: z.boolean(),
    reconcile: z.boolean(),
    pass: UuidSchema,
    final: z.boolean(),
    changes: z.array(AudienceChangeSchema).max(IDENTITY_BATCH_MAX_CHANGES),
  })
  .strict()
  .superRefine((request, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (request.to < request.from) issue('"to" is before "from"');
    if (request.reset && request.from !== 0) issue('A reset replays from 0');
    let previous = request.from;
    for (const change of request.changes) {
      if (change.seq <= previous || change.seq > request.to) {
        issue('Changes are in strictly increasing seq, within (from, to]');
        return;
      }
      previous = change.seq;
    }
  });

export type IdentityChangesRequest = z.infer<typeof IdentityChangesRequestSchema>;

/**
 * A batch as it travels: the envelope in clear, its `changes` sealed to the
 * request (`identity-seal.ts` — the array {@link IdentityChangesRequestSchema}
 * describes, encrypted with a key derived from the installation secret and
 * bound to the caller assertion's nonce and to this envelope). The panel
 * builds it with `sealIdentityChanges`; the half opens it with the verified
 * request's `openIdentityChanges`, then parses the batch.
 */
export interface IdentityChangesWire {
  readonly protocol: typeof IDENTITY_PROTOCOL_VERSION;
  readonly envelope: IdentityChangesEnvelope;
  readonly sealed: SealedIdentityChanges;
}

const IdentityChangesWireSchema = z
  .object({
    protocol: z.literal(IDENTITY_PROTOCOL_VERSION),
    directoryId: UuidSchema,
    from: CursorSchema,
    to: CursorSchema,
    reset: z.boolean(),
    reconcile: z.boolean(),
    pass: UuidSchema,
    final: z.boolean(),
    changes: z.unknown(),
  })
  .strict();

/** A batch as the half receives it, its changes still sealed; null when it is not one. */
export function parseIdentityChangesWire(raw: unknown): IdentityChangesWire | null {
  const parsed = IdentityChangesWireSchema.safeParse(raw);
  if (!parsed.success) return null;
  const sealed = parseSealedIdentityChanges(parsed.data.changes);
  if (!sealed) return null;
  const { directoryId, from, to, reset, reconcile, pass, final } = parsed.data;
  return {
    protocol: IDENTITY_PROTOCOL_VERSION,
    envelope: { directoryId, from, to, reset, reconcile, pass, final },
    sealed,
  };
}

/**
 * The half's answer to a batch: its directory and cursor (`to`) after
 * applying it, and — for a batch of a replay — how many of its changes
 * differed from the rows the half held (plus, at the final batch, the rows
 * it removed because the pass did not mention them).
 */
export const IdentityChangesAnswerSchema = z
  .object({
    protocol: z.literal(IDENTITY_PROTOCOL_VERSION),
    directoryId: UuidSchema,
    cursor: CursorSchema,
    mismatches: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();

export type IdentityChangesAnswer = z.infer<typeof IdentityChangesAnswerSchema>;

/** The error of the half's 409: the batch does not continue its cursor. */
export const IDENTITY_CURSOR_MISMATCH = 'cursor_mismatch';

/**
 * The half's 409 to a batch that does not continue from its cursor (or is
 * for another directory without `reset`): what it holds, so the panel can
 * continue from there — or replay.
 */
export const IdentityCursorConflictSchema = z
  .object({
    error: z.literal(IDENTITY_CURSOR_MISMATCH),
    protocol: z.literal(IDENTITY_PROTOCOL_VERSION),
    directoryId: UuidSchema.nullable(),
    cursor: CursorSchema,
  })
  .strict();

export type IdentityCursorConflict = z.infer<typeof IdentityCursorConflictSchema>;

function parseWith<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: unknown): T | null {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** A notification as the half receives it; null when it is not one. */
export function parseIdentityNotifyRequest(raw: unknown): IdentityNotifyRequest | null {
  return parseWith(IdentityNotifyRequestSchema, raw);
}

/** The half's answer to a notification, as the panel reads it; null when it is not one. */
export function parseIdentityNotifyAnswer(raw: unknown): IdentityNotifyAnswer | null {
  return parseWith(IdentityNotifyAnswerSchema, raw);
}

/** A batch as the half receives it; null when it is not one. */
export function parseIdentityChangesRequest(raw: unknown): IdentityChangesRequest | null {
  return parseWith(IdentityChangesRequestSchema, raw);
}

/** The half's answer to a batch, as the panel reads it; null when it is not one. */
export function parseIdentityChangesAnswer(raw: unknown): IdentityChangesAnswer | null {
  return parseWith(IdentityChangesAnswerSchema, raw);
}

/** The half's 409 body, as the panel reads it; null when it is not one. */
export function parseIdentityCursorConflict(raw: unknown): IdentityCursorConflict | null {
  return parseWith(IdentityCursorConflictSchema, raw);
}
