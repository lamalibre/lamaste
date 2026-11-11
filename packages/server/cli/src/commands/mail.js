/**
 * lamaste-server mail — how the relay sends mail (invitations, password
 * reset links, Authelia's codes), and `domains mail <name>` for a domain's
 * override (packages/core/docs/mail-design.md §3).
 *
 *   show                                The transport, its sender, last check and sending budget
 *   set-smtp --host <h> [--port 587] [--security starttls|tls] [--username <u>]
 *            [--password-stdin] [--ca-file <ca.pem> | --no-ca] --sender <address>
 *            [--sender-name <name>] [--daily-limit <n>]
 *                                       An SMTP server, checked before it is stored
 *   google --client-id <id> [--client-secret-stdin] --sender <address>
 *          [--sender-name <name>] [--daily-limit <n>] [--no-wait]
 *                                       A Google account (Gmail API): prints the consent URL
 *                                       and waits for Google to come back
 *   sender [--address <a>] [--name <n> | --no-name]
 *                                       The sender (a domain: a sender over the relay's transport)
 *   limit <n>                           The sending account's daily limit
 *   test <to>                           Send a test mail
 *   resume                              End a provider's limit refusal early
 *   clear                               Remove it
 *
 * Secrets — an SMTP password, a Google client secret — are read from stdin
 * (`--password-stdin`, `--client-secret-stdin`) or asked for in a terminal,
 * never taken as arguments, and reach the panel only in the request body,
 * which curl reads on stdin. Nothing prints them.
 */

import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import * as prompts from '@clack/prompts';
import { panelRequest } from '../panel-api.js';
import { emit, emitComplete } from '../ndjson.js';
import { fail } from '../fail.js';
import { terminalText } from '../plugin-settings.js';
import { readStdinText } from './plugin-settings.js';
import { warningLine } from '../branding.js';
import {
  GOOGLE_FLAGS,
  SENDER_FLAGS,
  SMTP_FLAGS,
  consentStored,
  googleFields,
  googleRequest,
  mailPath,
  parseDailyLimitFlag,
  parseMailFlags,
  senderRequest,
  smtpRequest,
  transportLines,
} from '../mail.js';

/** A secret on stdin is at most this long. */
const SECRET_STDIN_MAX_BYTES = 4096;
/** A CA bundle file is at most this long (the panel refuses more than 16 KiB). */
const CA_FILE_MAX_BYTES = 64 * 1024;
/** How often the transport is read while Google's consent is under way. */
const CONSENT_POLL_MS = 3000;

/** A panel request, or exit with its refusal. */
const call = (json, ...args) => panelRequest(...args).catch((err) => fail(err.message, json, err));

/**
 * @param {string[]} args
 * @param {{ json: boolean, domain?: string | null }} options `domain` null: the relay's
 */
export async function runMail(args, { json, domain = null }) {
  const [sub, ...rest] = args;
  try {
    switch (sub) {
      case 'show':
        return await showCmd(domain, { json });
      case 'set-smtp':
        return await setSmtpCmd(domain, rest, { json });
      case 'google':
        return await googleCmd(domain, rest, { json });
      case 'sender':
        return await senderCmd(domain, rest, { json });
      case 'limit':
        if (rest.length !== 1) return usage(domain, 1);
        return await changed(
          domain,
          'PATCH',
          mailPath(domain),
          { dailyLimit: parseDailyLimitFlag(rest[0]) },
          { json },
          'Daily limit saved',
        );
      case 'test':
        if (rest.length !== 1) return usage(domain, 1);
        return await testCmd(domain, rest[0], { json });
      case 'resume':
        return await changed(
          domain,
          'POST',
          mailPath(domain, '/resume'),
          null,
          { json },
          'Sending resumed',
        );
      case 'clear':
        return await clearCmd(domain, { json });
      default:
        return usage(domain, sub ? 1 : 0);
    }
  } catch (err) {
    // A usage error of the flags (never a secret: those are refused before they are read).
    return fail(err instanceof Error ? err.message : String(err), json);
  }
}

function usage(domain, code) {
  const b = chalk.bold;
  const c = chalk.cyan;
  const prefix =
    domain === null ? 'lamaste-server mail' : `lamaste-server domains mail ${terminalText(domain)}`;
  console.log(`
${b('Usage:')} ${prefix} <subcommand>

${b('Subcommands:')}
  ${c('show')}                              The transport, sender, last check and sending budget
  ${c('set-smtp --host <h> [--port 587] [--security starttls|tls] [--username <u>]')}
  ${c('         [--password-stdin] [--ca-file <ca.pem> | --no-ca] --sender <address>')}
  ${c('         [--sender-name <name>] [--daily-limit <n>]')}
                                    An SMTP server — checked before it is stored. Without a
                                    password the stored one is kept (same host and username),
                                    without --ca-file the stored CA bundle (same host)
  ${c('google --client-id <id> [--client-secret-stdin] --sender <address>')}
  ${c('       [--sender-name <name>] [--daily-limit <n>] [--no-wait]')}
                                    A Google account over the Gmail API: open the URL printed,
                                    sign in as the sending Workspace user and consent
  ${c('sender [--address <a>] [--name <n> | --no-name]')}
                                    ${domain === null ? 'The sender' : 'The domain’s sender, over the relay’s transport unless it has its own'}
  ${c('limit <n>')}                         The sending account's daily limit (Google Workspace: 500 on
                                    a trial, 2000 once paid — Lamaste sends at most 90% of it)
  ${c('test <to>')}                         Send a test mail
  ${c('resume')}                            End a provider's limit refusal early, once its console shows
                                    the account sending again
  ${c('clear')}                             Remove it${domain === null ? ' (Authelia writes its mail to a file again)' : ''}

  Secrets are never arguments: pipe them in (--password-stdin, --client-secret-stdin)
  or type them at the prompt.
`);
  process.exit(code);
}

/** Print a transport, or say there is none. */
function printTransport(domain, transport) {
  if (!transport) {
    console.log(
      chalk.dim(
        domain === null
          ? 'No mail is set up: invitations show their link only, and password reset is off.'
          : 'No override: the domain sends through the relay’s transport and sender.',
      ),
    );
    return;
  }
  for (const [label, value] of transportLines(transport, Date.now())) {
    console.log(`${chalk.bold(`${label}:`.padEnd(11))} ${value}`);
  }
}

function printWarnings(result) {
  for (const warning of result?.warnings ?? [])
    console.log(chalk.yellow(`! ${warningLine(warning)}`));
}

async function showCmd(domain, { json }) {
  const result = await call(json, 'GET', mailPath(domain));
  if (json) return emit(result);
  printTransport(domain, result.transport);
}

/** A change answered with the transport (and maybe warnings). */
async function changed(domain, method, path, body, { json }, message) {
  const result = await call(json, method, path, body);
  if (json) return emitComplete(result);
  console.log(`${chalk.green('✓')} ${message}`);
  printWarnings(result);
  if (result.transport) printTransport(domain, result.transport);
}

/**
 * A secret: from stdin with `fromStdin` (piped or redirected, never the
 * terminal), else asked for in a terminal, else none (`required` refuses
 * that). One trailing newline is dropped.
 */
async function readSecret({ fromStdin, flag, label, required, json }) {
  if (fromStdin) {
    if (process.stdin.isTTY) {
      throw new Error(
        `${flag} reads a secret piped in or redirected from a file, not from the terminal`,
      );
    }
    const text = (await readStdinText(process.stdin, SECRET_STDIN_MAX_BYTES)).replace(/\r?\n$/, '');
    if (text === '') throw new Error(`${flag}: stdin is empty`);
    return text;
  }
  if (!json && process.stdin.isTTY && process.stdout.isTTY) {
    const answer = await prompts.password({ message: label });
    if (prompts.isCancel(answer)) throw new Error('Cancelled');
    if (answer !== '') return answer;
  }
  if (required) throw new Error(`${label} is required: pipe it in with ${flag}`);
  return null;
}

async function setSmtpCmd(domain, rest, { json }) {
  const flags = parseMailFlags(rest, SMTP_FLAGS);
  let caPem = null;
  if (typeof flags['ca-file'] === 'string') {
    const text = await readFile(flags['ca-file'], 'utf-8');
    if (Buffer.byteLength(text) > CA_FILE_MAX_BYTES) throw new Error('The CA file is too large');
    caPem = text;
  }
  // Checked before a secret is read: a mistake in the flags never costs a typed password.
  smtpRequest(flags, { caPem });
  const password =
    typeof flags.username === 'string' || flags['password-stdin']
      ? await readSecret({
          fromStdin: flags['password-stdin'] === true,
          flag: '--password-stdin',
          label: 'SMTP password (empty: keep the stored one)',
          required: false,
          json,
        })
      : null;
  const body = smtpRequest(flags, { password, caPem });
  return changed(domain, 'PUT', mailPath(domain), body, { json }, 'SMTP server checked and saved');
}

async function googleCmd(domain, rest, { json }) {
  const flags = parseMailFlags(rest, GOOGLE_FLAGS);
  googleFields(flags);
  const clientSecret = await readSecret({
    fromStdin: flags['client-secret-stdin'] === true,
    flag: '--client-secret-stdin',
    label: 'OAuth client secret',
    required: true,
    json,
  });
  const before = (await call(json, 'GET', mailPath(domain))).transport?.updatedAt ?? null;
  const started = await call(
    json,
    'POST',
    mailPath(domain, '/google/start'),
    googleRequest(flags, clientSecret),
  );
  if (json)
    emit({ event: 'consent', authorizeUrl: started.authorizeUrl, expiresAt: started.expiresAt });
  else {
    console.log(
      `\n${chalk.bold('Open this URL, sign in as the sending Workspace user and consent:')}\n`,
    );
    console.log(`  ${chalk.cyan(terminalText(started.authorizeUrl))}\n`);
    console.log(chalk.dim(`It works until ${terminalText(started.expiresAt)}.`));
  }
  if (flags['no-wait']) return;
  if (!json)
    console.log(
      chalk.dim('Waiting for Google to come back… (Ctrl-C stops waiting; the URL keeps working)'),
    );
  const deadline = Date.parse(started.expiresAt);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, CONSENT_POLL_MS));
    const now = await panelRequest('GET', mailPath(domain)).catch(() => null);
    if (consentStored(now?.transport, before)) {
      if (json) return emitComplete(now);
      console.log(`${chalk.green('✓')} Google connected`);
      return printTransport(domain, now.transport);
    }
  }
  return fail('Google’s consent was not completed in time — run `google` again', json);
}

async function senderCmd(domain, rest, { json }) {
  const flags = parseMailFlags(rest, SENDER_FLAGS);
  if (domain === null) {
    return changed(
      domain,
      'PATCH',
      mailPath(domain),
      senderRequest(flags, { senderOnly: false }),
      { json },
      'Sender saved',
    );
  }
  return changed(
    domain,
    'PUT',
    mailPath(domain, '/sender'),
    senderRequest(flags, { senderOnly: true }),
    { json },
    'Sender saved',
  );
}

async function testCmd(domain, to, { json }) {
  const result = await call(json, 'POST', mailPath(domain, '/test'), { to });
  if (json) return emitComplete(result);
  const status = result.mail?.status;
  if (status === 'sent') {
    console.log(`${chalk.green('✓')} Test mail sent to ${terminalText(to)}`);
    return;
  }
  fail(
    `Test mail not sent: ${status ?? 'unknown'}${result.mail?.error ? ` (${result.mail.error})` : ''}`,
    json,
  );
}

async function clearCmd(domain, { json }) {
  const result = await call(json, 'DELETE', mailPath(domain));
  if (json) return emitComplete(result);
  console.log(
    result.removed ? `${chalk.green('✓')} Mail removed` : chalk.dim('Nothing to remove.'),
  );
  printWarnings(result);
}
