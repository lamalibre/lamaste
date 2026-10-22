/**
 * lamaste-server plugins identity|audience|entitlements|identity-sync — the
 * people of an agent-hosted plugin that declares identity (its manifest's
 * `identity` block: roles, and the attributes it receives about its users).
 *
 *   identity <name>       What its installed version declares, its approval,
 *                         whether users reach its application (and why not),
 *                         its audience in numbers, the feed to its agent half
 *                         and the erasures it has not acknowledged
 *   audience <name>       Its members — and the users who left (tombstones) —
 *                         as its agent half is told
 *   entitlements <name>   Who may use it, with which roles: Gatekeeper plugin
 *                         grants with roles, to users or Lamaste groups
 *   entitlements <name> --user <u> | --group <g> --roles a,b
 *                         Give exactly these roles (replacing what it held)
 *   entitlements <name> --revoke --user <u> | --group <g>
 *                         Take every role away
 *   identity-sync <name> [--reconcile]
 *                         Send its agent half what it has not applied now;
 *                         --reconcile replays everything and counts what was
 *                         out of step (as the daily reconcile does)
 *
 * Every subcommand goes through the running panel
 * (`/api/plugins/:name/{identity,audience,entitlements,identity/sync}`,
 * admin certificate). What the panel says is printed only as
 * `terminalText`; `--json` emits it as it came.
 */

import chalk from 'chalk';
import { panelRequest } from '../panel-api.js';
import { emit, emitComplete, emitError } from '../ndjson.js';
import { identityBlockLines } from '../plugin-approval.js';
import {
  audienceRowText,
  parseEntitlementsArgs,
  parseIdentitySyncArgs,
  readinessText,
  syncRows,
  warningLine,
} from '../plugin-identity.js';
import { terminalText } from '../plugin-settings.js';

/** `/api/plugins/<name>/<rest>`. */
function pluginPath(name, rest) {
  return `/api/plugins/${encodeURIComponent(name)}/${rest}`;
}

/**
 * Exit with a usage error or a refused request, as text or NDJSON (with
 * the refusal's `code`).
 *
 * @param {string} message
 * @param {boolean} json
 * @param {{ code?: string }} [err]
 * @returns {never}
 */
function fail(message, json, err = {}) {
  if (json) emitError(message, false, typeof err.code === 'string' ? { code: err.code } : {});
  else console.error(`\n  ${chalk.red(terminalText(message))}\n`);
  process.exit(1);
}

/** Print a change's warnings: what the panel could not complete beside it. */
function printWarnings(warnings) {
  for (const warning of warnings ?? []) {
    console.log(`  ${chalk.yellow('!')} ${warningLine(warning)}`);
  }
}

/** `label:` padded, then the value. */
function row(label, value) {
  console.log(`  ${chalk.dim(`${label}:`.padEnd(16))}${value}`);
}

/**
 * `plugins identity <name>`.
 *
 * @param {string | undefined} name
 * @param {{ json: boolean }} options
 */
export async function identityCmd(name, { json }) {
  if (!name) fail('Usage: lamaste-server plugins identity <name>', json);
  let result;
  try {
    result = await panelRequest('GET', pluginPath(name, 'identity'));
  } catch (err) {
    fail(err.message, json, err);
  }
  if (json) {
    emit(result);
    return;
  }
  const view = result.identity;
  const now = Date.now();
  const ready = readinessText(view.readiness);
  console.log('');
  if (!view.declared) {
    console.log(`  Plugin ${chalk.cyan(name)} declares no identity: no user reaches it.`);
    console.log(chalk.dim(`  (${ready.text})`));
    console.log('');
    return;
  }
  console.log(chalk.bold(`  People of ${terminalText(name)}`));
  console.log(chalk.dim('  ' + '─'.repeat(40)));
  row(
    'identity',
    view.approval.approved
      ? chalk.green('approved')
      : chalk.yellow('waits for approval — lamaste-server plugins hooks ' + terminalText(name)),
  );
  row('users', ready.ready ? chalk.green(ready.text) : chalk.yellow(ready.text));
  for (const line of identityBlockLines(view.declared)) {
    const [label, ...value] = line.split(':');
    row(label.trim(), value.join(':').trim());
  }
  const counts = view.audience;
  if (counts) {
    row(
      'audience',
      `${counts.active} active, ${counts.disabled} disabled` +
        chalk.dim(` · left: ${counts.removed} removed, ${counts.erased} erased`),
    );
  }
  if (view.sync) {
    console.log('');
    console.log(chalk.bold('  Feed to the agent half'));
    for (const [label, value] of syncRows(view.sync, now)) {
      row(label, label === 'last error' ? chalk.red(value) : value);
    }
  }
  if (view.pendingErasures.length > 0) {
    console.log('');
    console.log(chalk.bold('  Erasures its agent half has not acknowledged'));
    for (const userId of view.pendingErasures) console.log(`    ${terminalText(userId)}`);
  }
  console.log('');
}

/**
 * `plugins audience <name>`.
 *
 * @param {string | undefined} name
 * @param {{ json: boolean }} options
 */
export async function audienceCmd(name, { json }) {
  if (!name) fail('Usage: lamaste-server plugins audience <name>', json);
  let result;
  try {
    result = await panelRequest('GET', pluginPath(name, 'audience'));
  } catch (err) {
    fail(err.message, json, err);
  }
  if (json) {
    emit(result);
    return;
  }
  const rows = result.audience.map(audienceRowText);
  if (rows.length === 0) {
    console.log(`\n  ${chalk.cyan(name)} has no members yet.\n`);
    return;
  }
  const print = (list, title) => {
    if (list.length === 0) return;
    const who = Math.max('USER'.length, ...list.map((r) => r.who.length));
    console.log('');
    console.log(chalk.bold(`  ${title}`));
    console.log(chalk.dim(`  ${'USER ID'.padEnd(36)}  ${'USER'.padEnd(who)}  STATUS    ROLES`));
    for (const r of list) {
      const status =
        r.status === 'active'
          ? chalk.green(r.status.padEnd(8))
          : r.status === 'disabled'
            ? chalk.yellow(r.status.padEnd(8))
            : chalk.dim(r.status);
      console.log(
        `  ${r.userId.padEnd(36)}  ${r.who.padEnd(who)}  ${status}  ${r.roles}${chalk.dim(` (seq ${r.seq})`)}`,
      );
    }
  };
  print(
    rows.filter((r) => r.member),
    `Audience of ${terminalText(name)} (head seq ${result.head})`,
  );
  print(
    rows.filter((r) => !r.member),
    'Left the audience (the plugin keeps their last known name until they are erased)',
  );
  console.log('');
}

/**
 * `plugins entitlements <name> [--user <u> | --group <g> --roles a,b]
 * [--revoke --user <u> | --group <g>]`.
 *
 * @param {string[]} args  what follows the subcommand
 * @param {{ json: boolean }} options
 */
export async function entitlementsCmd(args, { json }) {
  const parsed = parseEntitlementsArgs(args);
  if (!parsed.ok) fail(parsed.error, json);
  const { name } = parsed;
  const path = pluginPath(name, 'entitlements');

  if (parsed.action === 'list') {
    let result;
    try {
      result = await panelRequest('GET', path);
    } catch (err) {
      fail(err.message, json, err);
    }
    if (json) {
      emit(result);
      return;
    }
    const { entitlements, roleless } = result;
    console.log('');
    if (entitlements.length === 0) {
      console.log(`  Nobody holds a role on ${chalk.cyan(name)} yet.`);
    } else {
      console.log(chalk.bold(`  Entitlements on ${terminalText(name)}`));
      const width = Math.max(
        'PRINCIPAL'.length,
        ...entitlements.map((e) => `${e.principalType}:${e.principalId}`.length),
      );
      console.log(chalk.dim(`  ${'PRINCIPAL'.padEnd(width)}  ROLES`));
      for (const e of entitlements) {
        const principal = terminalText(`${e.principalType}:${e.principalId}`);
        const unknown =
          e.unknownRoles.length > 0
            ? chalk.dim(` (no longer declared: ${terminalText(e.unknownRoles.join(', '))})`)
            : '';
        const userId = e.userId ? chalk.dim(`  ${terminalText(e.userId)}`) : '';
        console.log(
          `  ${chalk.cyan(principal.padEnd(width))}  ${terminalText(e.roles.join(', '))}${unknown}${userId}`,
        );
      }
    }
    if (roleless > 0) {
      console.log(
        chalk.dim(
          `\n  ${roleless} grant(s) on it carry no roles (desktop installs, migrated grants) — they never make anyone a member.`,
        ),
      );
    }
    console.log(
      chalk.dim(
        `\n  Give roles:  lamaste-server plugins entitlements ${terminalText(name)} --user <u> | --group <g> --roles a,b` +
          `\n  Take away:   lamaste-server plugins entitlements ${terminalText(name)} --revoke --user <u> | --group <g>`,
      ),
    );
    console.log('');
    return;
  }

  const principal = { principalType: parsed.principalType, principalId: parsed.principalId };
  const who = `${principal.principalType} ${principal.principalId}`;
  if (parsed.action === 'set') {
    let result;
    try {
      result = await panelRequest('PUT', path, { ...principal, roles: parsed.roles });
    } catch (err) {
      fail(err.message, json, err);
    }
    if (json) {
      emitComplete({ name, ...result });
      return;
    }
    console.log(
      result.changed
        ? `\n  ${chalk.green('✓')} ${terminalText(who)} holds ${chalk.cyan(parsed.roles.join(', '))} on ${terminalText(name)}`
        : `\n  ${terminalText(who)} already holds exactly ${parsed.roles.join(', ')} on ${terminalText(name)}`,
    );
    printWarnings(result.warnings);
    console.log('');
    return;
  }

  const query = new URLSearchParams(principal).toString();
  let result;
  try {
    result = await panelRequest('DELETE', `${path}?${query}`);
  } catch (err) {
    fail(err.message, json, err);
  }
  if (json) {
    emitComplete({ name, ...principal, ...result });
    return;
  }
  console.log(
    `\n  ${chalk.green('✓')} ${terminalText(who)} holds no role on ${terminalText(name)} any more` +
      chalk.dim(` (${result.revoked} grant(s) revoked)`),
  );
  printWarnings(result.warnings);
  console.log('');
}

/**
 * `plugins identity-sync <name> [--reconcile]`: exits non-zero when the
 * sync was skipped or failed.
 *
 * @param {string[]} args  what follows the subcommand
 * @param {{ json: boolean }} options
 */
export async function identitySyncCmd(args, { json }) {
  const parsed = parseIdentitySyncArgs(args);
  if (!parsed.ok) fail(parsed.error, json);
  const { name, reconcile } = parsed;
  let response;
  try {
    response = await panelRequest('POST', pluginPath(name, 'identity/sync'), { reconcile });
  } catch (err) {
    fail(err.message, json, err);
  }
  if (json) {
    emitComplete({ name, ...response });
  } else {
    const { result } = response;
    if (result.status === 'synced') {
      console.log(
        `\n  ${chalk.green('✓')} ${terminalText(name)}: ${result.replay ? 'replayed' : 'synced'} up to seq ${result.cursor}` +
          (reconcile ? ` — ${result.mismatches ?? 0} out of step` : ''),
      );
    } else if (result.status === 'up-to-date') {
      console.log(
        `\n  ${chalk.green('✓')} ${terminalText(name)}: its agent half is up to date (seq ${result.cursor})`,
      );
    } else {
      console.error(
        `\n  ${chalk.red(`${result.status}:`)} ${terminalText(result.error ?? result.reason ?? '')}`,
      );
    }
    console.log('');
  }
  if (!response.ok) process.exit(1);
}
