/**
 * The relay hook runner: runs one plugin's relay hooks — its own module and
 * the shared hooks it enabled — for `lamaste-serverd`, which never imports
 * plugin code itself.
 *
 * systemd starts it on the first connection to the plugin's socket
 * (`lamalibre-lamaste-hooks@<route>.socket`, socket activation, the listening
 * socket arrives as fd 3) inside a sandbox: a dynamic user, a read-only file
 * system, no network, and Node's permission model allowing reads of this
 * directory and the plugin's approved hook file only. The runner answers one
 * call per connection (see `protocol.ts`) and keeps no state that a call
 * may rely on: it exits after {@link HOOK_RUNNER_IDLE_EXIT_MS} without a call,
 * and Lamaste restarts it whenever a hook overruns its deadline (a hook in a
 * busy loop cannot be interrupted from inside the process).
 *
 * Nothing a hook prints is kept: `console` is silenced here and the unit
 * discards standard output and error, so application data a hook sees cannot
 * end up in the journal.
 *
 * Usage: runner.js --plugin <route> [--entry <file.mjs>] (--listen-fd <n> | --listen <socket path>) [--idle-exit-ms <n>]
 */

import net from 'node:net';
import { pathToFileURL } from 'node:url';

import {
  HOOK_PROTOCOL_VERSION,
  HOOK_RUNNER_IDLE_EXIT_MS,
  SECRET_SCAN_DEFAULTS,
  SECRET_SCAN_HOOK,
  isHookStage,
  isSharedHookName,
} from './constants.js';
import type { SecretScanSettings } from './constants.js';
import { encodeFrame, readFrame } from './protocol.js';
import type { HookCallRequest, HookCallResponse } from './protocol.js';
import { secretScanHook } from './shared/secret-scan.js';
import type { HookBody, HookContext, ResponseHookInput } from './types.js';

interface RunnerArgs {
  readonly plugin: string;
  readonly entry: string | null;
  readonly listenFd: number | null;
  readonly listenPath: string | null;
  readonly idleExitMs: number;
}

const ROUTE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** A request that sends no frame within this time is dropped. */
const READ_TIMEOUT_MS = 10_000;

function parseArgs(argv: readonly string[]): RunnerArgs {
  let plugin: string | null = null;
  let entry: string | null = null;
  let listenFd: number | null = null;
  let listenPath: string | null = null;
  let idleExitMs = HOOK_RUNNER_IDLE_EXIT_MS;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    i++;
    switch (flag) {
      case '--plugin':
        plugin = value;
        break;
      case '--entry':
        entry = value;
        break;
      case '--listen-fd':
        listenFd = Number(value);
        break;
      case '--listen':
        listenPath = value;
        break;
      case '--idle-exit-ms':
        idleExitMs = Number(value);
        break;
      default:
        throw new Error(`Unknown argument ${flag}`);
    }
  }
  if (plugin === null || !ROUTE_RE.test(plugin)) throw new Error('--plugin <route> is required');
  if ((listenFd === null) === (listenPath === null)) {
    throw new Error('Exactly one of --listen-fd and --listen is required');
  }
  if (listenFd !== null && (!Number.isInteger(listenFd) || listenFd < 3)) {
    throw new Error('--listen-fd must be an inherited descriptor (3 or above)');
  }
  if (!Number.isInteger(idleExitMs) || idleExitMs < 1_000) {
    throw new Error('--idle-exit-ms must be at least 1000');
  }
  return { plugin, entry, listenFd, listenPath, idleExitMs };
}

function silenceConsole(): void {
  const noop = (): void => undefined;
  for (const method of [
    'log',
    'info',
    'warn',
    'error',
    'debug',
    'trace',
    'dir',
    'dirxml',
    'table',
    'group',
    'groupCollapsed',
    'time',
    'timeLog',
    'timeEnd',
    'count',
    'assert',
  ] as const) {
    (console as unknown as Record<string, unknown>)[method] = noop;
  }
}

type HookFunction = (input: unknown, ctx: HookContext) => unknown;

interface LoadedModule {
  readonly hooks: Readonly<Record<string, HookFunction>> | null;
  readonly error: { readonly name: string; readonly message: string } | null;
}

async function loadModule(entry: string | null): Promise<LoadedModule> {
  if (entry === null) return { hooks: null, error: null };
  try {
    const mod = (await import(pathToFileURL(entry).href)) as { default?: unknown };
    const exported = mod.default;
    if (!exported || typeof exported !== 'object') {
      return {
        hooks: null,
        error: { name: 'TypeError', message: 'The hook module has no default export object' },
      };
    }
    const hooks: Record<string, HookFunction> = {};
    for (const [stage, fn] of Object.entries(exported as Record<string, unknown>)) {
      if (isHookStage(stage) && typeof fn === 'function') hooks[stage] = fn as HookFunction;
    }
    return { hooks, error: null };
  } catch (err: unknown) {
    return { hooks: null, error: describeError(err) };
  }
}

function describeError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) {
    return { name: err.name.slice(0, 100), message: err.message.slice(0, 500) };
  }
  return { name: 'Error', message: String(err).slice(0, 500) };
}

function makeBody(bytes: Buffer, contentType: string | null): HookBody {
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let text: string | null = null;
  return {
    contentType,
    bytes: view,
    text(): string {
      text ??= bytes.toString('utf-8');
      return text;
    },
    json(): unknown {
      return JSON.parse(this.text());
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseRequest(header: unknown, plugin: string): HookCallRequest | null {
  if (!isRecord(header)) return null;
  const call = header['call'];
  const body = header['body'];
  if (
    header['v'] !== HOOK_PROTOCOL_VERSION ||
    header['plugin'] !== plugin ||
    !isHookStage(header['stage']) ||
    typeof header['deadline'] !== 'number' ||
    !isRecord(header['input']) ||
    !isRecord(call) ||
    (body !== null && !isRecord(body))
  ) {
    return null;
  }
  if (call['kind'] !== 'app' && !(call['kind'] === 'shared' && isSharedHookName(call['name']))) {
    return null;
  }
  return header as unknown as HookCallRequest;
}

class DeadlineExceeded extends Error {
  constructor() {
    super('The hook did not decide before its deadline');
    this.name = 'DeadlineExceeded';
  }
}

function withDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new DeadlineExceeded());
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new DeadlineExceeded()), remaining);
    }),
  ]).finally(() => clearTimeout(timer));
}

function failure(
  kind: Extract<HookCallResponse, { ok: false }>['error']['kind'],
  error: { name: string; message: string },
): Buffer {
  const response: HookCallResponse = {
    v: HOOK_PROTOCOL_VERSION,
    ok: false,
    error: { kind, name: error.name, message: error.message },
  };
  return encodeFrame(response);
}

/** Turn a hook's decision into a response frame; a `replace` body travels as the frame body. */
function success(decision: unknown): Buffer {
  if (!isRecord(decision)) {
    return failure('invalid', { name: 'TypeError', message: 'A hook must return an object' });
  }
  if (decision['action'] === 'replace') {
    const body = decision['body'];
    const { body: _body, ...rest } = decision;
    if (typeof body === 'string') {
      return encodeFrame(
        { v: HOOK_PROTOCOL_VERSION, ok: true, decision: rest, bodyIsText: true },
        Buffer.from(body, 'utf-8'),
      );
    }
    if (body instanceof Uint8Array) {
      return encodeFrame({ v: HOOK_PROTOCOL_VERSION, ok: true, decision: rest }, body);
    }
    return failure('invalid', {
      name: 'TypeError',
      message: 'A replace decision needs a string or Uint8Array body',
    });
  }
  try {
    return encodeFrame({ v: HOOK_PROTOCOL_VERSION, ok: true, decision });
  } catch (err: unknown) {
    return failure('invalid', describeError(err));
  }
}

async function runCall(
  request: HookCallRequest,
  bodyBytes: Buffer,
  loaded: LoadedModule,
): Promise<Buffer> {
  const input: Record<string, unknown> = { ...request.input };
  if (request.body !== null) input['body'] = makeBody(bodyBytes, request.body.contentType);
  const ctx: HookContext = {
    plugin: request.plugin,
    stage: request.stage,
    deadline: request.deadline,
  };

  let work: () => unknown;
  if (request.call.kind === 'shared') {
    if (request.call.name !== SECRET_SCAN_HOOK || request.stage !== 'request:post-forward') {
      return failure('missing', {
        name: 'Error',
        message: `${request.call.name} has no ${request.stage} hook`,
      });
    }
    const settings: SecretScanSettings = { ...SECRET_SCAN_DEFAULTS, ...request.call.settings };
    work = () => secretScanHook(input as unknown as ResponseHookInput, settings);
  } else {
    if (loaded.error) return failure('load', loaded.error);
    const fn = loaded.hooks?.[request.stage];
    if (!fn) {
      return failure('missing', {
        name: 'Error',
        message: `The hook module exports no "${request.stage}"`,
      });
    }
    work = () => fn(input, ctx);
  }

  try {
    const decision = await withDeadline(Promise.resolve().then(work), request.deadline);
    return success(decision);
  } catch (err: unknown) {
    if (err instanceof DeadlineExceeded) return failure('timeout', describeError(err));
    return failure('threw', describeError(err));
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  const listenPid = process.env['LISTEN_PID'];
  // Hooks need nothing from the environment; whatever is in it (systemd's
  // socket-activation variables, anything a unit adds) is not theirs.
  for (const key of Object.keys(process.env)) delete process.env[key];
  silenceConsole();
  // A hook's stray asynchronous error must not leave a half-working runner
  // behind; socket activation starts a fresh one on the next call.
  process.on('uncaughtException', () => process.exit(70));
  process.on('unhandledRejection', () => process.exit(70));

  const loaded = await loadModule(args.entry);
  let active = 0;
  let idleTimer: NodeJS.Timeout | null = null;
  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (active === 0) process.exit(0);
      armIdle();
    }, args.idleExitMs);
  };

  const server = net.createServer((socket) => {
    active++;
    if (idleTimer) clearTimeout(idleTimer);
    socket.once('close', () => {
      active--;
      if (active === 0) armIdle();
    });
    socket.on('error', () => socket.destroy());
    void (async () => {
      let response: Buffer;
      try {
        const frame = await readFrame(socket, { timeoutMs: READ_TIMEOUT_MS });
        const request = parseRequest(frame.header, args.plugin);
        response = request
          ? await runCall(request, frame.body, loaded)
          : failure('invalid', { name: 'Error', message: 'Malformed hook call' });
      } catch (err: unknown) {
        response = failure('invalid', describeError(err));
      }
      socket.end(response);
    })();
  });

  if (args.listenFd !== null) {
    if (listenPid !== undefined && listenPid !== String(process.pid)) {
      throw new Error('The inherited socket was passed to another process');
    }
    server.listen({ fd: args.listenFd });
  } else {
    server.listen(args.listenPath as string);
  }
  armIdle();
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    // Startup failures only (arguments, the socket) — never hook data.
    process.stderr.write(`lamaste hook runner: ${describeError(err).message}\n`);
    process.exit(78);
  });
}
