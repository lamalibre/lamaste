/**
 * lamaste-server chisel — manage chisel tunnel-server credentials.
 *
 * Subcommands:
 *   rotate-credential --label <label>   Mint a fresh chisel password for an
 *                                        existing agent and restart the
 *                                        chisel service. The agent must
 *                                        re-fetch via
 *                                        `lamaste-agent chisel refresh-credential`.
 */

import chalk from 'chalk';
import { panelRequest } from '../panel-api.js';
import { emit, emitError, emitComplete } from '../ndjson.js';

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
export async function runChisel(args, { json }) {
  const sub = args[0];

  switch (sub) {
    case 'rotate-credential':
      return rotateCredential(args.slice(1), { json });
    default:
      printChiselUsage();
      process.exit(sub ? 1 : 0);
  }
}

function printChiselUsage() {
  const b = chalk.bold;
  const c = chalk.cyan;
  console.log(`
${b('Usage:')} lamaste-server chisel <subcommand>

${b('Subcommands:')}
  ${c('rotate-credential')} --label <label>   Mint a new chisel credential for an agent

${b('Notes:')}
  After rotating, the affected agent must run
  ${c('lamaste-agent chisel refresh-credential --label <label>')} to pick up
  the new credential. Until then its tunnels will fail to authenticate.
`);
}

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
async function rotateCredential(args, { json }) {
  const label = getArg(args, 'label');
  if (!label) {
    const msg = 'Error: --label is required';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }

  if (!json) {
    process.stderr.write(`  Rotating chisel credential for ${chalk.cyan(label)}...`);
  }

  try {
    // The panel API does the heavy lifting: writes the new credential, regenerates
    // the chisel-users authfile, and restarts the chisel service.
    const result = await panelRequest(
      'POST',
      `/api/agents/${encodeURIComponent(label)}/chisel-credential/rotate`,
    );

    if (json) {
      emitComplete({
        label: result.label,
        user: result.user,
        password: result.password,
        restartOk: result.restartOk,
        restartError: result.restartError || null,
      });
      return;
    }

    console.log(` ${chalk.green('ok')}`);
    console.log('');
    console.log(`  ${chalk.bold('user:')}      ${chalk.cyan(result.user)}`);
    // SECURITY: the rotated chisel password is NEVER written to a log sink
    // (stdout/stderr/console). It is persisted server-side in the chisel
    // credentials store (mode 0600). Scripted consumers must use the
    // non-interactive JSON mode (`--json`), which emits the password in
    // the NDJSON `complete` event for direct programmatic capture.
    console.log(
      `  ${chalk.bold('password:')}  ${chalk.dim('*** (redacted — use --json to retrieve)')}`,
    );
    if (!result.restartOk) {
      console.log('');
      console.log(
        `  ${chalk.yellow('warning:')} chisel service restart failed: ${result.restartError}`,
      );
      console.log(
        `  ${chalk.dim('Run `sudo systemctl restart chisel` manually before any tunnels reconnect.')}`,
      );
    }
    console.log('');
    console.log(
      `  ${chalk.dim('On the agent host, run:')} ${chalk.cyan(`lamaste-agent chisel refresh-credential --label ${label}`)}`,
    );
    console.log('');
  } catch (err) {
    if (json) {
      emitError(err.message);
    } else {
      console.log(` ${chalk.red('failed')}`);
      console.error(`  ${chalk.red(err.message)}\n`);
    }
    process.exit(1);
  }

  // Silence linter for unused emit
  void emit;
}

/**
 * @param {string[]} args
 * @param {string} name
 * @returns {string | null}
 */
function getArg(args, name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}
