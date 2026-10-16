/**
 * `lamaste-server plugins hooks|update|approve-hooks`: why an update waits
 * for approval, the command that approves it, and the arguments that
 * command takes. Pure — no output — so they are tested as they are.
 */

import { terminalText } from './plugin-settings.js';

const DIGEST_RE = /^[a-f0-9]{64}$/;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,64}$/;
/** The reason an update turns secret settings into plain ones. */
const SETTINGS_SECRET_TO_PLAIN = 'settings.secret-to-plain';

/** How `approve-hooks` is called. */
export const APPROVE_HOOKS_USAGE =
  'Usage: lamaste-server plugins approve-hooks <name> --digest <sha256> [--version <v>] (what `hooks <name>` shows)';

/**
 * Why a pending update waits, as the terminal shows it: each reason of
 * `approvalRequired` (`[{ code, reason }]`; a secret turned plain is a
 * warning), and the sentences of `autoApproveWithheld` that do not repeat
 * one of them — what auto-approve, when on, could not cover beyond that.
 * Every text as {@link terminalText}.
 *
 * @param {{ approvalRequired?: unknown, autoApproveWithheld?: unknown }} update
 * @returns {{ required: Array<{ text: string, warning: boolean }>, notCovered: string[] }}
 */
export function pendingUpdateReasons(update) {
  const required = (Array.isArray(update?.approvalRequired) ? update.approvalRequired : [])
    .filter((entry) => entry !== null && typeof entry === 'object')
    .map((entry) => ({
      text: terminalText(entry.reason),
      warning: entry.code === SETTINGS_SECRET_TO_PLAIN,
    }));
  const said = new Set(required.map((line) => line.text));
  const notCovered = (Array.isArray(update?.autoApproveWithheld) ? update.autoApproveWithheld : [])
    .map((reason) => terminalText(reason))
    .filter((text) => !said.has(text));
  return { required, notCovered };
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
