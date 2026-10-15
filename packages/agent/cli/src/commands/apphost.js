/**
 * lamaste-agent apphost — the app host helper on this machine (slice 3).
 *
 * Usage:
 *   sudo lamaste-agent apphost enable [--user <name>]
 *   sudo lamaste-agent apphost pin [--label <label>] [--user <name>]
 *   lamaste-agent apphost status [--json]
 *   lamaste-agent apphost relay-keys [--label <label>] [--json]
 *   sudo lamaste-agent apphost remove <route> [--purge] [--label <label>]
 *   sudo lamaste-agent apphost disable [--force]
 *
 * `lamaste-apphost` (shipped in this package's `scripts/`) installs the
 * agent halves of agent-hosted plugins this agent hosts: their system
 * accounts, hardened units, directories and approved system packages. It
 * runs as root; the agent's user may run it through one sudoers rule that
 * names only that user. An agent that itself runs as root needs no rule.
 * It installs, switches and removes only what the agent's relay signed,
 * verified with the relay key pinned for each agent label on the machine.
 *
 * `enable` installs the helper root:root 0755 at /usr/local/sbin and the
 * rule (0440, checked with `visudo -c` before it is renamed into place),
 * checks that the agent's user can run it, and pins the relay key of every
 * agent on the machine (`apphost-setup.js`). `pin` pins them again after a
 * relay rotated its key. `relay-keys` shows what each agent's relay
 * publishes (run as the agent's user; `pin` runs it so). `remove` takes an
 * agent half off the machine as the operator, with no relay involved — for
 * an agent its relay can no longer reach. `disable` refuses while agent
 * halves are installed; `--force` removes them first, keeping their data.
 * Linux only: an agent half is a systemd service.
 */

import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import chalk from 'chalk';
import { execa } from 'execa';
import { APPHOST_PATHS, APPHOST_PROTOCOL_VERSION, APPHOST_ROUTE_RE } from '@lamalibre/lamaste';
import { appHostStatus, isAppHostEnabled } from '@lamalibre/lamaste/agent';
import {
  HELPER_SOURCE,
  ROOT_OWNED_INSTALL,
  collectRelayKeys,
  fetchRelayKeysAs,
  pinRelayKeys,
  readRelayPins,
  removeRelayPins,
  sudoersRule,
  trustedSourcePaths,
  untrustedPaths,
} from '../lib/apphost-setup.js';

const requireHelper = createRequire(import.meta.url);

/** The helper's interpreter (its shebang), and the Node.js the agent halves run on. */
const NODE_BIN = '/usr/bin/node';
const VISUDO = '/usr/sbin/visudo';
const SUDO = '/usr/bin/sudo';
const SYSTEM_ENV = { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' };
/** A login name sudoers can name without quoting. */
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

const SUBCOMMANDS = ['enable', 'pin', 'status', 'relay-keys', 'remove', 'disable'];

/**
 * @param {string[]} args
 * @param {{ json?: boolean, label?: string }} options - `label`: the global --label
 */
export async function runApphost(args, { json = false, label } = {}) {
  const sub = args[0];
  if (!SUBCOMMANDS.includes(sub)) {
    printUsage();
    process.exit(sub ? 1 : 0);
  }
  if (process.platform !== 'linux') {
    throw new Error(
      'The app host helper runs agent halves as systemd services; it is available on Linux agents only.',
    );
  }
  switch (sub) {
    case 'enable':
      return enable(args.slice(1), json);
    case 'pin':
      return pin(args.slice(1), label, json);
    case 'status':
      return status(json);
    case 'relay-keys':
      return relayKeys(label, json);
    case 'remove':
      return remove(args.slice(1), label, json);
    case 'disable':
      return disable(args.slice(1), json);
  }
}

function printUsage() {
  const b = chalk.bold;
  const c = chalk.cyan;
  console.log(`
${b('Usage:')} lamaste-agent apphost <subcommand>

${b('Subcommands:')}
  ${c('enable [--user <name>]')}   Install the app host helper and the sudoers rule that lets
                           the agent's user run it, and pin each agent's relay key (run
                           with sudo; the user defaults to the one who ran sudo, --user
                           root when the agent runs as root)
  ${c('pin [--label <label>]')}    Pin the relay key again after a relay rotated it (run with
                           sudo); the helper runs only jobs the pinned key signed
  ${c('status [--json]')}          Show the helper, its rule, the pinned relay keys and the
                           agent halves it installed
  ${c('relay-keys [--label <l>]')} Show the key each agent's relay signs with now
  ${c('remove <route> [--purge]')} Remove an agent half here as the operator (run with sudo),
                           for an agent its relay can no longer reach; --purge also
                           deletes its data and account
  ${c('disable [--force]')}        Remove the helper, its rule and the pinned keys (run with
                           sudo); --force first removes the agent halves it installed,
                           keeping their data
`);
}

function requireRoot(sub) {
  if (process.getuid?.() !== 0) {
    throw new Error(`Run it as root: sudo lamaste-agent apphost ${sub}`);
  }
}

/**
 * Refuse to act as root from a lamaste-agent another user could have
 * changed: the helper root installs comes from it, and root runs it.
 */
async function requireRootOwnedInstall(sub) {
  const problems = await untrustedPaths(trustedSourcePaths());
  if (problems.length === 0) return;
  throw new Error(
    `This lamaste-agent is not a root-owned install, so root will not ${sub} the app host ` +
      `helper from it (${problems.slice(0, 3).join('; ')}). Install it root-owned with ` +
      `\`${ROOT_OWNED_INSTALL}\` and run \`sudo lamaste-agent apphost ${sub}\` from that install.`,
  );
}

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
  return value;
}

/** The user the agent runs as: --user, else the one who ran sudo. */
async function agentUser(args) {
  const user = flagValue(args, '--user') ?? process.env.SUDO_USER;
  if (!user) {
    throw new Error(
      'Name the user the agent runs as: sudo lamaste-agent apphost enable --user <name> ' +
        '(--user root when the agent runs as root)',
    );
  }
  if (!USER_RE.test(user)) throw new Error(`"${user}" is not a valid user name`);
  const { exitCode } = await execa('id', ['-u', user], {
    reject: false,
    extendEnv: false,
    env: SYSTEM_ENV,
  });
  if (exitCode !== 0) throw new Error(`There is no user named "${user}"`);
  return user;
}

async function fsyncDir(dir) {
  const fh = await open(dir, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/**
 * Install `content` at `dest`, root:root `mode`, atomically: written under a
 * hidden name with a dot (sudo ignores such files in sudoers.d), checked by
 * `validate`, then renamed into place — an invalid file is never live.
 */
async function installFile(dest, content, mode, validate) {
  const dir = path.dirname(dest);
  await mkdir(dir, { recursive: true, mode: 0o755 });
  const tmp = path.join(dir, `.${path.basename(dest)}.${crypto.randomBytes(8).toString('hex')}`);
  const fh = await open(
    tmp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await fh.writeFile(content);
    await fh.chown(0, 0);
    await fh.chmod(mode);
    await fh.sync();
  } catch (err) {
    await fh.close();
    await rm(tmp, { force: true });
    throw err;
  }
  await fh.close();
  try {
    if (validate) await validate(tmp);
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  await fsyncDir(dir);
}

async function validateSudoers(file) {
  const result = await execa(VISUDO, ['-c', '-q', '-f', file], {
    reject: false,
    extendEnv: false,
    env: SYSTEM_ENV,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `visudo refused the rule; nothing was changed: ${(result.stderr || result.stdout || '').trim()}`,
    );
  }
}

/** The user the installed rule names, or null (no rule, or not readable as this user). */
async function sudoersUser() {
  let text;
  try {
    text = await readFile(APPHOST_PATHS.sudoers, 'utf-8');
  } catch {
    return null;
  }
  const line = text.split('\n').find((l) => l.includes(APPHOST_PATHS.helper) && !l.startsWith('#'));
  return line ? (line.trim().split(/\s+/)[0] ?? null) : null;
}

async function fileSha256(file) {
  return crypto
    .createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
}

async function enable(args, json) {
  requireRoot('enable');
  await requireRootOwnedInstall('enable');
  const user = await agentUser(args);
  try {
    await access(NODE_BIN, constants.X_OK);
  } catch {
    throw new Error(
      `${NODE_BIN} is missing: it runs the app host helper and the agent halves. ` +
        'Install Node.js from the distribution or NodeSource so that it is there.',
    );
  }
  const systemd = await stat('/run/systemd/system').then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!systemd) {
    throw new Error('systemd is not the system manager here; agent halves run as systemd services');
  }
  if (user !== 'root') {
    for (const bin of [SUDO, VISUDO]) {
      try {
        await access(bin, constants.X_OK);
      } catch {
        throw new Error(
          `${bin} is missing: the agent's user runs the helper through sudo. Install sudo, ` +
            'or enable the helper with --user root if the agent runs as root.',
        );
      }
    }
  }

  await installFile(APPHOST_PATHS.helper, await readFile(HELPER_SOURCE), 0o755);
  if (user === 'root') {
    // The agent runs as root and calls the helper directly; a rule left from
    // an earlier enable for another user must not outlive it.
    await rm(APPHOST_PATHS.sudoers, { force: true });
  } else {
    await installFile(APPHOST_PATHS.sudoers, sudoersRule(user), 0o440, validateSudoers);
  }

  const availability = await appHostStatus();
  if (availability.state !== 'ready') {
    throw new Error(
      `The helper was installed but does not answer: ${availability.state === 'unusable' ? availability.reason : 'it is missing'}`,
    );
  }
  if (user !== 'root') {
    const probe = await execa(
      SUDO,
      ['-n', '-u', user, '--', SUDO, '-n', APPHOST_PATHS.helper, 'status'],
      { reject: false, extendEnv: false, env: SYSTEM_ENV, timeout: 60_000 },
    );
    if (probe.exitCode !== 0) {
      throw new Error(
        `The rule is installed, but ${user} cannot run the helper with sudo -n: ` +
          `${(probe.stderr || '').trim().split('\n')[0] || `exit status ${probe.exitCode}`}`,
      );
    }
  }

  // The relay keys the helper verifies each agent's app jobs with. The
  // helper is in place either way; without a key it runs no job, and
  // `apphost pin` can be run again.
  let relays = [];
  let relayError = null;
  try {
    relays = await pinRelayKeys(await fetchRelayKeysAs(user));
  } catch (err) {
    relayError = err instanceof Error ? err.message : String(err);
  }

  const { protocol, node } = availability.status;
  if (json) {
    console.log(
      JSON.stringify({
        ok: true,
        helper: APPHOST_PATHS.helper,
        protocol,
        node,
        sudoers: user === 'root' ? null : APPHOST_PATHS.sudoers,
        user,
        relays,
        ...(relayError !== null ? { relayError } : {}),
      }),
    );
    return;
  }
  console.log('');
  console.log(chalk.green(`  App host helper enabled (protocol ${protocol}).`));
  console.log(`  Helper:  ${APPHOST_PATHS.helper}`);
  console.log(`  Node.js: ${node} (${NODE_BIN}) — what the agent halves run on`);
  if (user === 'root') {
    console.log('  Sudoers: none needed — the agent runs as root and calls the helper directly.');
  } else {
    console.log(`  Sudoers: ${APPHOST_PATHS.sudoers} (${user} may run the helper as root)`);
  }
  if (relayError !== null) {
    console.log(
      chalk.red(`  Relay keys: not pinned — ${relayError}.`) +
        chalk.yellow(' Run sudo lamaste-agent apphost pin once that is fixed.'),
    );
  } else {
    printPinned(relays);
  }
  console.log(
    chalk.dim('  The agent reports it to the panel on its next sync; the panel can then host'),
  );
  console.log(chalk.dim('  plugins whose agent half Lamaste installs on this agent.\n'));
}

/** What `enable` and `pin` pinned, label by label. */
function printPinned(relays) {
  if (relays.length === 0) {
    console.log(
      chalk.yellow('  Relay keys: none pinned — no agent is set up on this machine for ') +
        chalk.yellow('that user. Set one up, then run sudo lamaste-agent apphost pin.'),
    );
    return;
  }
  console.log('  Relay keys (the helper runs only app jobs these signed):');
  for (const r of relays) {
    if ('error' in r) {
      console.log(`    ${r.label.padEnd(20)} ${chalk.red(`not pinned: ${r.error}`)}`);
      continue;
    }
    const was =
      r.previousKid === null
        ? ''
        : r.previousKid === r.kid
          ? chalk.dim(' (unchanged)')
          : chalk.yellow(` (was ${r.previousKid})`);
    console.log(`    ${r.label.padEnd(20)} ${r.kid}${was}  ${chalk.dim(r.panelUrl)}`);
  }
}

/**
 * The user the agent runs as for `pin`: --user, else the one the sudoers
 * rule names, else root (an agent running as root needs no rule).
 */
async function pinUser(args) {
  const flag = flagValue(args, '--user');
  const user = flag ?? (await sudoersUser()) ?? 'root';
  if (!USER_RE.test(user)) throw new Error(`"${user}" is not a valid user name`);
  return user;
}

/**
 * Pin each agent's relay key again (all, or `label`'s) — after the relay
 * rotated its signing key, the helper refuses its jobs until then.
 */
async function pin(args, label, json) {
  requireRoot('pin');
  await requireRootOwnedInstall('pin');
  if (!(await isAppHostEnabled())) {
    throw new Error('The app host helper is not enabled: sudo lamaste-agent apphost enable');
  }
  const user = await pinUser(args);
  const relays = await pinRelayKeys(await fetchRelayKeysAs(user, { label }));
  const failed = relays.filter((r) => 'error' in r);
  if (json) {
    console.log(JSON.stringify({ ok: failed.length === 0, user, relays }));
  } else {
    console.log('');
    printPinned(relays);
    console.log('');
  }
  if (failed.length > 0 || relays.length === 0) process.exitCode = 1;
}

/** What each agent's relay publishes now, beside what is pinned (run as the agent's user). */
async function relayKeys(label, json) {
  const relays = await collectRelayKeys({ label });
  if (json) {
    console.log(JSON.stringify({ relays }));
    return;
  }
  const pinned = await readRelayPins();
  console.log('');
  for (const r of relays) {
    if ('error' in r) {
      console.log(`  ${r.label.padEnd(20)} ${chalk.red(r.error)}`);
      continue;
    }
    const kid = r.keys[0]?.kid ?? null;
    const pin = pinned[r.label];
    const note =
      kid === null
        ? chalk.red('the relay publishes no key')
        : pin?.state === 'pinned' && pin.pin.kid === kid
          ? chalk.green('pinned')
          : chalk.yellow('not pinned — sudo lamaste-agent apphost pin');
    console.log(`  ${r.label.padEnd(20)} ${kid ?? '-'}  ${note}`);
  }
  console.log('');
}

/**
 * The installed helper, loaded into this (root) process: what the
 * operator's removals call directly — with operator authority, which only
 * code already running as root can give, never the helper's command line.
 */
async function installedHelper() {
  const problems = await untrustedPaths([APPHOST_PATHS.helper]);
  if (problems.length > 0) {
    throw new Error(
      `${APPHOST_PATHS.helper} is not a root-owned file (${problems.slice(0, 2).join('; ')}); ` +
        'run sudo lamaste-agent apphost enable',
    );
  }
  return requireHelper(APPHOST_PATHS.helper);
}

/**
 * Remove agent half `route` as the operator (with its owner's label, or
 * `label` when it has no owner record): the helper's own removal, called
 * here as root without a relay's signature.
 */
async function removeAsOperator(helper, route, label, purge) {
  try {
    return helper.main(['remove', label, route, ...(purge ? ['--purge'] : [])], {
      operator: true,
    });
  } catch (err) {
    throw new Error(
      `The agent half of ${route} could not be removed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function remove(args, label, json) {
  requireRoot('remove');
  await requireRootOwnedInstall('remove');
  const route = args.find((a) => !a.startsWith('--'));
  if (!route || !APPHOST_ROUTE_RE.test(route)) {
    throw new Error('Usage: sudo lamaste-agent apphost remove <route> [--purge] [--label <label>]');
  }
  const purge = args.includes('--purge');
  if (!(await isAppHostEnabled())) {
    throw new Error('The app host helper is not enabled; there is no agent half to remove');
  }
  const availability = await appHostStatus(route);
  if (availability.state !== 'ready') {
    throw new Error(
      `The helper does not answer (${availability.state === 'unusable' ? availability.reason : 'missing'})`,
    );
  }
  const owner = availability.status.apps[route]?.owner ?? null;
  const as = owner?.label ?? label;
  if (as === undefined) {
    throw new Error(
      `${route} has no owner record here; name the agent it belonged to with --label <label>`,
    );
  }
  const outcome = await removeAsOperator(await installedHelper(), route, as, purge);
  if (json) {
    console.log(JSON.stringify({ ok: true, route, purge, outcome }));
    return;
  }
  console.log('');
  console.log(
    chalk.green(
      `  Removed the agent half of ${route}${purge ? ' with its data and account' : ''}.`,
    ),
  );
  if (!purge) console.log(`  Its data is kept in ${APPHOST_PATHS.dataDir(route)}.`);
  console.log(
    chalk.yellow(
      '  If its relay still lists the plugin as hosted here, unhost or uninstall it there.',
    ),
  );
  console.log('');
}

async function status(json) {
  const installed = await isAppHostEnabled();
  const upToDate = installed
    ? (await fileSha256(APPHOST_PATHS.helper)) === (await fileSha256(HELPER_SOURCE))
    : null;
  // From an install another user can change, enable refuses: status then
  // points at a root-owned install, never at enable.
  const installProblems = await untrustedPaths(trustedSourcePaths());
  const fix =
    installProblems.length === 0
      ? `run ${chalk.cyan('sudo lamaste-agent apphost enable')}`
      : `install lamaste-agent root-owned first (${chalk.cyan(ROOT_OWNED_INSTALL)}) — this one is not`;
  const isRoot = process.getuid?.() === 0;
  const user = isRoot ? await sudoersUser() : undefined;
  const availability = installed ? await appHostStatus() : { state: 'absent' };
  const apps = availability.state === 'ready' ? availability.status.apps : {};
  const pins = await readRelayPins();
  const relays = Object.fromEntries(
    Object.entries(pins).map(([label, p]) => [
      label,
      p.state === 'pinned'
        ? { kid: p.pin.kid, agent: p.pin.agent, panelUrl: p.pin.panelUrl, pinnedAt: p.pin.pinnedAt }
        : { error: p.state === 'invalid' ? p.reason : 'not pinned' },
    ]),
  );

  if (json) {
    console.log(
      JSON.stringify({
        helper: {
          path: APPHOST_PATHS.helper,
          installed,
          upToDate,
          protocol: availability.state === 'ready' ? availability.status.protocol : null,
          node: availability.state === 'ready' ? availability.status.node : null,
          ...(availability.state === 'unusable' ? { error: availability.reason } : {}),
        },
        install: { rootOwned: installProblems.length === 0, problems: installProblems },
        // undefined (left out) when not run as root: /etc/sudoers.d is root's.
        sudoers: { path: APPHOST_PATHS.sudoers, user },
        // The relay key pinned for each agent label (anyone may read them).
        relays,
        apps,
      }),
    );
    return;
  }

  const b = chalk.bold;
  console.log('');
  if (!installed) {
    console.log(`  ${b('Helper:')}  not enabled — ${fix}`);
    console.log('');
    return;
  }
  if (availability.state === 'ready') {
    const protocol = availability.status.protocol;
    const note =
      protocol < APPHOST_PROTOCOL_VERSION || !upToDate
        ? chalk.yellow(` — out of date: ${fix}`)
        : '';
    console.log(
      `  ${b('Helper:')}  ${APPHOST_PATHS.helper} (protocol ${protocol}, ` +
        `Node.js ${availability.status.node})${note}`,
    );
  } else {
    console.log(
      `  ${b('Helper:')}  ${APPHOST_PATHS.helper} ${chalk.red(`does not answer: ${availability.reason}`)}`,
    );
  }
  if (user !== undefined) {
    console.log(
      `  ${b('Sudoers:')} ${user ? `${APPHOST_PATHS.sudoers} (${user})` : 'no rule — the agent runs as root'}`,
    );
  }
  const labels = Object.keys(relays);
  console.log(
    `  ${b('Relay keys:')} ${labels.length === 0 ? chalk.yellow(`none pinned — ${chalk.cyan('sudo lamaste-agent apphost pin')}`) : ''}`,
  );
  for (const label of labels) {
    const r = relays[label];
    console.log(
      `    ${label.padEnd(24)} ${'error' in r ? chalk.red(r.error) : `${r.kid}  ${chalk.dim(`${r.panelUrl}, pinned ${r.pinnedAt}`)}`}`,
    );
  }
  const routes = Object.keys(apps);
  console.log(`  ${b('Agent halves:')} ${routes.length === 0 ? 'none' : ''}`);
  for (const route of routes) {
    const app = apps[route];
    const previous = app.previous ? chalk.dim(` (previous ${app.previous})`) : '';
    const unit =
      app.unit === 'active'
        ? chalk.green(app.unit)
        : app.unit === 'inactive'
          ? chalk.yellow(app.unit)
          : chalk.dim(app.unit);
    const owner = app.owner
      ? chalk.dim(`  ${app.owner.package}, agent ${app.owner.label}`)
      : chalk.red('  no owner record');
    console.log(`    ${route.padEnd(24)} ${app.current ?? '-'}${previous}  ${unit}${owner}`);
  }
  console.log('');
}

async function disable(args, json) {
  requireRoot('disable');
  await requireRootOwnedInstall('disable');
  const force = args.includes('--force');
  const removed = [];
  if (await isAppHostEnabled()) {
    const availability = await appHostStatus();
    if (availability.state !== 'ready') {
      if (!force) {
        throw new Error(
          `The helper does not answer (${availability.state === 'unusable' ? availability.reason : 'missing'}), ` +
            'so its agent halves cannot be listed; pass --force to remove it anyway',
        );
      }
    } else {
      const apps = Object.entries(availability.status.apps);
      if (apps.length > 0 && !force) {
        throw new Error(
          `Agent halves are installed: ${apps.map(([r]) => r).join(', ')}. Uninstall or unhost ` +
            'those plugins on the panel first, or pass --force to remove them here (their data ' +
            'is kept).',
        );
      }
      const helper = apps.length > 0 ? await installedHelper() : null;
      for (const [route, app] of apps) {
        // Removed as the agent that owns it, the one the helper accepts.
        if (!app.owner) {
          throw new Error(
            `The agent half of ${route} has no owner record; remove ${APPHOST_PATHS.codeDir(route)} ` +
              'and its unit by hand, then disable the helper',
          );
        }
        await removeAsOperator(helper, route, app.owner.label, false);
        removed.push(route);
      }
    }
  }
  // The rule goes first, so the agent cannot start the helper while it goes.
  await rm(APPHOST_PATHS.sudoers, { force: true });
  await rm(APPHOST_PATHS.helper, { force: true });
  await removeRelayPins();

  if (json) {
    console.log(JSON.stringify({ ok: true, removed }));
    return;
  }
  console.log('');
  console.log(chalk.green('  App host helper disabled.'));
  if (removed.length > 0) {
    console.log(`  Removed the agent halves of ${removed.join(', ')} (their data is kept).`);
    console.log(
      chalk.yellow(
        '  The panel still lists those plugins as hosted here; unhost or uninstall them.',
      ),
    );
  }
  console.log('');
}
