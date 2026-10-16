/**
 * lamaste-server plugins settings|configure — the settings of an
 * agent-hosted plugin. Its agent half keeps them (the system of record);
 * the panel reads and changes them through the internal tunnel and keeps a
 * copy without any secret value.
 *
 *   settings <name>      Each field with its effective value (a secret only as
 *                        set or not set), whether the plugin still needs
 *                        configuration, where the values come from, the hosting
 *   configure <name> [--set key=value]... [--clear key]... [--secrets-stdin]
 *                        A partial change (`PUT /api/plugins/:name/settings`):
 *                        --set parses the value by the field's type, --clear puts a
 *                        field back to its default (clears a secret), --secrets-stdin
 *                        reads `{ "key": "value" | null }` from stdin
 *   configure <name>     In a terminal, without flags: asked field by field
 *
 * A secret never travels on a command line: --set refuses one; it is typed
 * into a password prompt or piped in with --secrets-stdin, and reaches the
 * panel only in the request body, which curl reads on stdin. It is never
 * printed, echoed or put into an error.
 */

import chalk from 'chalk';
import * as prompts from '@clack/prompts';
import { panelRequest } from '../panel-api.js';
import { emit, emitComplete, emitError } from '../ndjson.js';
import {
  SECRETS_STDIN_MAX_BYTES,
  answerError,
  buildSettingsUpdate,
  canClear,
  describeChanges,
  fieldNote,
  fieldValueText,
  hostingText,
  parseConfigureArgs,
  parseSecretsJson,
  parseTextAnswer,
  secretIsSet,
  settingsReadOnlyReason,
  settingsRefusal,
  settingsSourceText,
  updateBody,
  updateChangesSomething,
  updateSummary,
} from '../plugin-settings.js';

/** `/api/plugins/<name>/settings`. */
function settingsPath(name) {
  return `/api/plugins/${encodeURIComponent(name)}/settings`;
}

/**
 * Exit with a usage or local error, as text or NDJSON.
 *
 * @param {string} message
 * @param {boolean} json
 * @param {Record<string, unknown>} [details]  NDJSON fields beyond the message
 * @returns {never}
 */
function fail(message, json, details = {}) {
  if (json) emitError(message, false, details);
  else console.error(`\n  ${chalk.red(message)}\n`);
  process.exit(1);
}

/**
 * Exit with a refused settings read or change: the panel's message and
 * what to do about it (each field's message, a stale revision, an offline
 * hosting in the panel's words). NDJSON carries `code`, `errors`,
 * `revision`, `operationId` and `hosting`.
 *
 * @param {Error & { code?: string, errors?: Record<string, string>, revision?: number, operationId?: string, hosting?: object | null }} err
 * @param {string} name
 * @param {boolean} json
 * @returns {never}
 */
function failRefused(err, name, json) {
  if (json) {
    emitError(err.message, false, {
      ...(err.code ? { code: err.code } : {}),
      ...(err.errors ? { errors: err.errors } : {}),
      ...(err.revision !== undefined ? { revision: err.revision } : {}),
      ...(err.operationId ? { operationId: err.operationId } : {}),
      ...(err.hosting !== undefined ? { hosting: err.hosting } : {}),
    });
    process.exit(1);
  }
  const { message, details } = settingsRefusal(err, name, Date.now());
  console.error(`\n  ${chalk.red(message)}`);
  for (const line of details) console.error(`    ${line}`);
  console.error('');
  process.exit(1);
}

/**
 * Print a settings view: each field, its type, its value and what it is;
 * whether the plugin still needs configuration; where the values come
 * from; the hosting.
 *
 * @param {string} name
 * @param {object} view
 * @param {number} now
 */
function printSettingsView(name, view, now) {
  const d = chalk.dim;
  const revision = Number.isSafeInteger(view.revision) ? `, revision ${view.revision}` : '';
  console.log('');
  console.log(
    chalk.bold(`  Settings of ${name}`) + d(`  (schema ${view.schemaVersion}${revision})`),
  );
  console.log(d('  ' + '─'.repeat(40)));
  const rows = view.fields.map((field) => ({
    field,
    value: fieldValueText(field, view.values?.[field.key]),
  }));
  const keyWidth = Math.max(0, ...rows.map((r) => r.field.key.length));
  const typeWidth = Math.max(0, ...rows.map((r) => r.field.type.length));
  const valueWidth = Math.min(40, Math.max(0, ...rows.map((r) => r.value.length)));
  for (const { field, value } of rows) {
    const missing = view.missing.includes(field.key);
    const shown = value.padEnd(valueWidth);
    const coloured = missing ? chalk.yellow(shown) : value === 'not set' ? d(shown) : shown;
    console.log(
      `  ${chalk.cyan(field.key.padEnd(keyWidth))}  ${d(field.type.padEnd(typeWidth))}  ${coloured}  ${d(fieldNote(field))}`,
    );
  }
  console.log('');
  console.log(
    view.configured
      ? `  ${chalk.green('Configured')}`
      : `  ${chalk.yellow('Needs configuration')} — missing: ${view.missing.join(', ')}`,
  );
  console.log(`  ${d(settingsSourceText(view, now))}`);
  const hosting = hostingText(view.hosting, now);
  console.log(`  ${hosting.offline ? chalk.red(hosting.text) : hosting.text}`);
  console.log('');
}

/**
 * `settings <name>`: the settings view, read from the agent half when its
 * hosting is up (else the relay's copy).
 *
 * @param {string[]} args  what follows `settings`
 * @param {{ json: boolean }} options
 */
export async function settingsCmd(args, { json }) {
  if (args.length !== 1 || args[0].startsWith('-')) {
    fail('Usage: lamaste-server plugins settings <name>', json);
  }
  const name = args[0];
  let view;
  try {
    view = await panelRequest('GET', settingsPath(name));
  } catch (err) {
    failRefused(err, name, json);
  }
  if (json) {
    emit(view);
    return;
  }
  const now = Date.now();
  printSettingsView(name, view, now);
  if (settingsReadOnlyReason(view, now) === null) {
    console.log(chalk.dim(`  Change them with: lamaste-server plugins configure ${name}\n`));
  }
}

/**
 * Read stdin in full — at most `maxBytes`, refused beyond that without
 * repeating anything it holds. The chunks are zeroed once decoded.
 *
 * @param {AsyncIterable<Buffer | string>} stream
 * @param {number} maxBytes
 * @returns {Promise<string>}
 */
export async function readStdinText(stream, maxBytes) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk;
      chunks.push(buffer);
      size += buffer.length;
      if (size > maxBytes) {
        throw new Error(`stdin holds more than ${Math.floor(maxBytes / 1024)} KiB`);
      }
    }
    return Buffer.concat(chunks).toString('utf-8');
  } finally {
    for (const buffer of chunks) buffer.fill(0);
  }
}

/**
 * Change plugin `name`'s settings with the flags of `configure`: read the
 * settings (for the schema and the revision to base the change on), build
 * the partial update and send it. Resolves with what happened —
 * `{ state: 'saved', before, body, after }`, `{ state: 'unchanged', before }`
 * (the flags change nothing), `{ state: 'invalid', errors }` (refused here,
 * before anything is sent) or `{ state: 'read-only', code, message, hosting }`
 * (the settings cannot be changed now); rejects with the panel's refusal
 * (from `request`). `request` is `panelRequest` or a stand-in.
 *
 * @param {string} name
 * @param {{ sets: Array<{ key: string, raw: string }>, clears: string[], secrets: Record<string, unknown> }} flags
 * @param {{ request?: typeof panelRequest, now?: () => number }} [deps]
 */
export async function configureWithFlags(
  name,
  flags,
  { request = panelRequest, now = Date.now } = {},
) {
  const before = await request('GET', settingsPath(name));
  const readOnly = settingsReadOnlyReason(before, now());
  if (readOnly) return { state: 'read-only', ...readOnly, hosting: before.hosting };
  const built = buildSettingsUpdate(before, flags);
  if (!built.ok) return { state: 'invalid', errors: built.errors };
  if (!updateChangesSomething(built.body)) return { state: 'unchanged', before };
  const after = await request('PUT', settingsPath(name), built.body);
  return { state: 'saved', before, body: built.body, after };
}

/** "set retries, schedule; cleared region; secret apiKey set" — key names only. */
function summaryText(body) {
  const { changed, cleared, secretsSet, secretsCleared } = updateSummary(body);
  return [
    changed.length > 0 ? `set ${changed.join(', ')}` : null,
    cleared.length > 0 ? `back to the default: ${cleared.join(', ')}` : null,
    secretsSet.length > 0 ? `secret set: ${secretsSet.join(', ')}` : null,
    secretsCleared.length > 0 ? `secret cleared: ${secretsCleared.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * `configure <name> [--set key=value]... [--clear key]... [--secrets-stdin]`,
 * or — in a terminal, without flags — field by field.
 *
 * @param {string[]} args  what follows `configure`
 * @param {{ json: boolean }} options
 */
export async function configureCmd(args, { json }) {
  const parsed = parseConfigureArgs(args);
  if (!parsed.ok) fail(parsed.error, json);
  const { name, sets, clears, secretsStdin } = parsed;

  if (sets.length === 0 && clears.length === 0 && !secretsStdin) {
    if (json) {
      fail(
        'Nothing to change: give --set key=value, --clear key or --secrets-stdin (the interactive mode does not run with --json)',
        json,
      );
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      fail(
        'Nothing to change: give --set key=value, --clear key or --secrets-stdin, or run it in a terminal to be asked for each setting',
        json,
      );
    }
    return configureInteractively(name);
  }

  let secrets = {};
  if (secretsStdin) {
    if (process.stdin.isTTY) {
      fail(
        `--secrets-stdin reads a JSON object piped in or redirected from a file ` +
          `(lamaste-server plugins configure ${name} --secrets-stdin < secrets.json), not from the terminal — ` +
          `to type a secret, run configure without flags`,
        json,
      );
    }
    let read;
    try {
      read = parseSecretsJson(await readStdinText(process.stdin, SECRETS_STDIN_MAX_BYTES));
    } catch (err) {
      fail(err.message, json);
    }
    if (!read.ok) fail(read.error, json);
    secrets = read.secrets;
  }

  let result;
  try {
    result = await configureWithFlags(name, { sets, clears, secrets });
  } catch (err) {
    failRefused(err, name, json);
  } finally {
    // Nothing keeps the secrets once the request is sent.
    secrets = null;
  }

  switch (result.state) {
    case 'read-only':
      fail(result.message, json, { code: result.code, hosting: result.hosting });
      break;
    case 'invalid':
      failRefused(
        Object.assign(new Error('Invalid settings — nothing was sent'), { errors: result.errors }),
        name,
        json,
      );
      break;
    case 'unchanged':
      if (json) emitComplete({ name, ...updateSummary({}), settings: result.before });
      else
        console.log(
          `\n  Nothing to change — the settings of ${chalk.cyan(name)} stay as they are.\n`,
        );
      break;
    default:
      if (json) {
        emitComplete({ name, ...updateSummary(result.body), settings: result.after });
        break;
      }
      console.log(
        `\n  ${chalk.green('Saved')} the settings of ${chalk.cyan(name)} (revision ${result.after.revision}): ${summaryText(result.body)}`,
      );
      printSettingsView(name, result.after, Date.now());
  }
}

// ---------------------------------------------------------------------------
// Interactive mode
// ---------------------------------------------------------------------------

/** The answer that leaves a field as it is. */
const UNCHANGED = Object.freeze({ change: false });

/** The select option that puts an enum field back to its default (or unsets it). */
const CLEAR_CHOICE = Symbol('clear');

/** A prompt's answer, or — when the administrator cancelled (Ctrl-C, Escape) — the end. */
function answerOf(result) {
  if (prompts.isCancel(result)) {
    prompts.cancel('Nothing was saved.');
    process.exit(1);
  }
  return result;
}

/** A field's prompt: its label and key, and its description below. */
function promptMessage(field) {
  const title = `${field.label} ${chalk.dim(`(${field.key})`)}`;
  return field.description ? `${title}\n${chalk.dim(field.description)}` : title;
}

/**
 * Ask for one field: a secret is kept, replaced (typed into a password
 * prompt, never shown) or cleared; a boolean is a yes/no; an enum a choice
 * among its options; anything else a text prefilled with the current value
 * (empty puts it back to its default). Resolves with whether it changes and
 * to what (`null` clears it).
 *
 * @param {object} view
 * @param {object} field
 * @returns {Promise<{ change: false } | { change: true, value: string | number | boolean | null }>}
 */
async function askField(view, field) {
  const message = promptMessage(field);
  const current = view.values?.[field.key];

  switch (field.type) {
    case 'secret': {
      const set = secretIsSet(current);
      const options = set
        ? [
            { value: 'keep', label: 'Keep it', hint: fieldValueText(field, current) },
            { value: 'replace', label: 'Replace it' },
            ...(canClear(field) ? [{ value: 'clear', label: 'Clear it' }] : []),
          ]
        : [
            { value: 'replace', label: 'Set it' },
            {
              value: 'keep',
              label: 'Leave it unset',
              ...(field.required === true
                ? { hint: 'required — the plugin needs configuration until it is set' }
                : {}),
            },
          ];
      const action = answerOf(
        await prompts.select({ message, options, initialValue: set ? 'keep' : 'replace' }),
      );
      if (action === 'keep') return UNCHANGED;
      if (action === 'clear') return { change: true, value: null };
      const secret = answerOf(
        await prompts.password({
          message: `${field.label} — the new value`,
          clearOnError: true,
          validate: (value) => answerError(view, field, value ?? '') ?? undefined,
        }),
      );
      return { change: true, value: secret };
    }

    case 'boolean': {
      const answer = answerOf(
        await prompts.confirm({
          message,
          initialValue: typeof current === 'boolean' ? current : false,
        }),
      );
      return answer === current ? UNCHANGED : { change: true, value: answer };
    }

    case 'enum': {
      const options = (field.options ?? []).map((o) => ({
        value: o.value,
        label: o.label,
        ...(o.label !== o.value ? { hint: o.value } : {}),
      }));
      if (canClear(field) && current !== undefined && current !== field.default) {
        options.push({
          value: CLEAR_CHOICE,
          label:
            field.default !== undefined ? `Back to the default (${field.default})` : 'Unset it',
        });
      }
      const answer = answerOf(
        await prompts.select({
          message,
          options,
          ...(current !== undefined ? { initialValue: current } : {}),
        }),
      );
      if (answer === CLEAR_CHOICE) return { change: true, value: null };
      return answer === current ? UNCHANGED : { change: true, value: answer };
    }

    default: {
      // string, integer, number
      const placeholder = canClear(field)
        ? field.default !== undefined
          ? `empty: back to the default, ${field.default}`
          : 'empty: not set'
        : undefined;
      const text = answerOf(
        await prompts.text({
          message,
          initialValue: current === undefined ? '' : String(current),
          ...(placeholder ? { placeholder } : {}),
          validate: (value) => {
            const parsed = parseTextAnswer(view, field, value ?? '');
            return parsed.ok ? undefined : parsed.message;
          },
        }),
      );
      const parsed = parseTextAnswer(view, field, text ?? '');
      // The prompt accepted only an answer that parses.
      if (!parsed.ok) return UNCHANGED;
      if (parsed.value === null) {
        return current === undefined || current === field.default
          ? UNCHANGED
          : { change: true, value: null };
      }
      return parsed.value === current ? UNCHANGED : { change: true, value: parsed.value };
    }
  }
}

/**
 * `configure <name>` in a terminal without flags: each field in turn, then
 * which settings change (a secret only as set, replaced or cleared) and a
 * confirmation before anything is sent.
 *
 * @param {string} name
 */
async function configureInteractively(name) {
  let view;
  try {
    view = await panelRequest('GET', settingsPath(name));
  } catch (err) {
    failRefused(err, name, false);
  }
  const readOnly = settingsReadOnlyReason(view, Date.now());
  if (readOnly) fail(readOnly.message, false);

  prompts.intro(`Settings of ${name}`);
  let values = {};
  let secrets = {};
  for (const field of view.fields) {
    const answer = await askField(view, field);
    if (answer.change) (field.type === 'secret' ? secrets : values)[field.key] = answer.value;
  }
  let body = updateBody(view.revision, values, secrets);
  values = null;
  secrets = null;
  if (!updateChangesSomething(body)) {
    prompts.outro('Nothing changed.');
    return;
  }

  prompts.note(describeChanges(view, body).join('\n'), 'Changes');
  const save = answerOf(await prompts.confirm({ message: 'Save these changes?' }));
  if (!save) {
    body = null;
    prompts.outro('Nothing was saved.');
    return;
  }

  let after;
  try {
    after = await panelRequest('PUT', settingsPath(name), body);
  } catch (err) {
    prompts.cancel('Not saved.');
    failRefused(err, name, false);
  } finally {
    body = null;
  }
  prompts.outro(`Saved (revision ${after.revision})`);
  printSettingsView(name, after, Date.now());
}
