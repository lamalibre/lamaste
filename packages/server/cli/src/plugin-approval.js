/**
 * `lamaste-server plugins hooks|update|approve-hooks`: why an update waits
 * for approval, what an identity block lets a plugin learn and how an
 * update changes it, the command that approves it, and the arguments that
 * command takes. Pure — no output — so they are tested as they are.
 */

import { terminalText } from './plugin-settings.js';

const DIGEST_RE = /^[a-f0-9]{64}$/;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,64}$/;
/** The reason an update turns secret settings into plain ones. */
const SETTINGS_SECRET_TO_PLAIN = 'settings.secret-to-plain';
/** The reason an update adds or removes roles, or widens the attributes its users' records carry. */
const IDENTITY_CHANGED = 'identity.changed';

/** How `approve-hooks` is called. */
export const APPROVE_HOOKS_USAGE =
  'Usage: lamaste-server plugins approve-hooks <name> --digest <sha256> [--version <v>] (what `hooks <name>` shows)';

/**
 * Why a pending update waits, as the terminal shows it: each reason of
 * `approvalRequired` (`[{ code, reason }]`; a secret turned plain is a
 * warning; an identity change carries a note that auto-approve never
 * covers it), and the sentences of `autoApproveWithheld` that do not
 * repeat one of them — what auto-approve, when on, could not cover beyond
 * that. Every text as {@link terminalText}.
 *
 * @param {{ approvalRequired?: unknown, autoApproveWithheld?: unknown }} update
 * @returns {{ required: Array<{ text: string, warning: boolean, note: string | null }>, notCovered: string[] }}
 */
export function pendingUpdateReasons(update) {
  const required = (Array.isArray(update?.approvalRequired) ? update.approvalRequired : [])
    .filter((entry) => entry !== null && typeof entry === 'object')
    .map((entry) => ({
      text: terminalText(entry.reason),
      warning: entry.code === SETTINGS_SECRET_TO_PLAIN,
      note:
        entry.code === IDENTITY_CHANGED
          ? 'who its users are and what it learns about them — auto-approve never covers it'
          : null,
    }));
  const said = new Set(required.map((line) => line.text));
  const notCovered = (Array.isArray(update?.autoApproveWithheld) ? update.autoApproveWithheld : [])
    .map((reason) => terminalText(reason))
    .filter((text) => !said.has(text));
  return { required, notCovered };
}

/** What a plugin may declare to receive about its users, in words. */
const ATTRIBUTE_WORDS = { displayName: 'display name', email: 'email address' };

/** An identity attribute in words (`displayName` → display name). */
function attributeWords(attribute) {
  return ATTRIBUTE_WORDS[attribute] ?? terminalText(attribute);
}

/**
 * An identity block (normalized: `{ roles: [{ id, label, description? }],
 * attributes }`) as two lines — its roles, and what it receives about each
 * member. Empty for anything that is not a block. Every line as
 * {@link terminalText}.
 *
 * @param {unknown} block
 * @returns {string[]}
 */
export function identityBlockLines(block) {
  if (block === null || typeof block !== 'object' || !Array.isArray(block.roles)) return [];
  const roles = block.roles
    .filter((role) => role !== null && typeof role === 'object')
    .map((role) => `${role.id} (${role.label}${role.description ? ` — ${role.description}` : ''})`);
  const attributes = Array.isArray(block.attributes) ? block.attributes.map(attributeWords) : [];
  return [
    terminalText(`roles:    ${roles.length > 0 ? roles.join(', ') : 'none'}`),
    terminalText(
      `receives: ${['user id', 'username', 'roles', 'status', ...attributes].join(', ')} — of the users entitled to it`,
    ),
  ];
}

/**
 * How an update changes a plugin's identity block (`pendingUpdate.
 * identity`: `{ before, after, rolesAdded, rolesRemoved, attributesAdded,
 * attributesRemoved, labelsChanged, grantsAffected? }` — `grantsAffected`:
 * how many role grants approving it rewrites or revokes, null when unknown):
 * a headline and a line per kind of
 * change — roles added or removed and attributes widened wait for an
 * administrator (`approval`), narrowing and label edits only change the
 * digest. Null when neither version declares a block, or it is unchanged.
 * Every text as {@link terminalText}.
 *
 * @param {unknown} diff
 * @returns {{ headline: string, lines: Array<{ text: string, approval: boolean }> } | null}
 */
export function identityDiffLines(diff) {
  if (diff === null || typeof diff !== 'object') return null;
  const list = (value) => (Array.isArray(value) ? value.map(String) : []);
  const labelOf = (block, id) =>
    Array.isArray(block?.roles) ? (block.roles.find((r) => r?.id === id)?.label ?? null) : null;
  const role = (block) => (id) => {
    const label = labelOf(block, id);
    return label ? `${id} (${label})` : id;
  };
  const lines = [];
  const add = (label, entries, approval) => {
    if (entries.length === 0) return;
    lines.push({
      text: terminalText(
        `${label}: ${entries.join(', ')}${approval ? ' — waits for approval' : ''}`,
      ),
      approval,
    });
  };
  add('roles added', list(diff.rolesAdded).map(role(diff.after)), true);
  add('roles removed', list(diff.rolesRemoved).map(role(diff.before)), true);
  add('receives more about its users', list(diff.attributesAdded).map(attributeWords), true);
  add('receives less about its users', list(diff.attributesRemoved).map(attributeWords), false);
  add('role labels changed', list(diff.labelsChanged).map(role(diff.after)), false);
  // A removed role stays removed: approving revokes it from the grants that hold it.
  if (list(diff.rolesRemoved).length > 0 && 'grantsAffected' in diff) {
    const affected = diff.grantsAffected;
    const parts =
      affected === null || typeof affected !== 'object'
        ? ['not known (Gatekeeper could not be read)']
        : [
            ...(affected.revoked > 0 ? [`${affected.revoked} revoked`] : []),
            ...(affected.rewritten > 0
              ? [`${affected.rewritten} narrowed to the roles that stay`]
              : []),
          ];
    add('role grants affected', parts.length > 0 ? parts : ['none'], true);
  }
  const before = diff.before != null;
  const after = diff.after != null;
  if (lines.length === 0 && before === after) return null;
  const headline = !before
    ? 'declares identity for the first time'
    : !after
      ? 'no longer declares identity — it is sent no users, its role grants are revoked and its user surface is no longer served'
      : 'changes its identity';
  return { headline, lines };
}

/**
 * The command that approves what plugin `name` brings: the installed
 * version by its digest (`{ digest }`), or a pending update by its version
 * and — when it has one — its digest (`{ digest, version }`).
 *
 * @param {string} name
 * @param {{ digest?: string | null, version?: string | null }} target
 */
export function approveHooksCommand(name, { digest = null, version = null }) {
  return [
    `lamaste-server plugins approve-hooks ${terminalText(name)}`,
    ...(digest ? [`--digest ${terminalText(digest)}`] : []),
    ...(version ? [`--version ${terminalText(version)}`] : []),
  ].join(' ');
}

/**
 * The arguments of `approve-hooks <name>` after the name: `--digest
 * <sha256>` (the installed version's, or a pending update's) and
 * `--version <v>` (a pending update's) — at least one; `--version` alone
 * approves an update that brings neither relay hooks nor an agent half.
 *
 * @param {string[]} rest
 * @returns {{ digest: string | null, version: string | null } | { error: string }}
 */
export function parseApproveArgs(rest) {
  const valueOf = (flag) => {
    const idx = rest.indexOf(flag);
    return idx === -1 ? null : (rest[idx + 1] ?? '');
  };
  const digest = valueOf('--digest');
  const version = valueOf('--version');
  if (digest === null && version === null) return { error: APPROVE_HOOKS_USAGE };
  if (digest !== null && !DIGEST_RE.test(digest)) return { error: APPROVE_HOOKS_USAGE };
  if (version !== null && !VERSION_RE.test(version)) return { error: APPROVE_HOOKS_USAGE };
  return { digest, version };
}
