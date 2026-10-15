/**
 * The panel's side of the relay hook runner protocol (see
 * `../hooks/protocol.ts`): one connection per call to the plugin's runner
 * socket, one request frame out, one response frame back, within the hook's
 * timeout.
 *
 * The runner is sandboxed plugin code: everything that comes back is
 * untrusted. This module only frames and times the call; the decision is
 * validated by `hook-decisions.ts` before anything acts on it.
 */

import net from 'node:net';
import path from 'node:path';

import {
  DEFAULT_FRAME_LIMITS,
  HOOK_PROTOCOL_VERSION,
  encodeFrame,
  readFrame,
} from '../hooks/index.js';
import type { HookCallRequest, HookCallTarget, HookStage } from '../hooks/index.js';

/** Where systemd creates each plugin's runner socket (`<route>.sock`). */
export const HOOK_RUNNER_SOCKET_DIR = '/run/lamalibre-lamaste-hooks';

/** Extra time for the round trip itself, on top of the hook's own timeout. */
export const HOOK_CALL_GRACE_MS = 250;

const ROUTE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function hookRunnerSocketPath(socketDir: string, plugin: string): string {
  if (!ROUTE_RE.test(plugin)) throw new Error(`Invalid plugin route "${plugin}"`);
  return path.join(socketDir, `${plugin}.sock`);
}

export interface RelayHookCall {
  readonly plugin: string;
  readonly stage: HookStage;
  readonly call: HookCallTarget;
  readonly input: Readonly<Record<string, unknown>>;
  readonly body?: { readonly bytes: Buffer; readonly contentType: string | null } | null;
  readonly timeoutMs: number;
}

export type RelayHookFailureKind =
  /** Nothing answers on the socket: the runner is not installed or failed to start. */
  | 'unavailable'
  /** No decision within the timeout. The runner may be stuck; restart it. */
  | 'timeout'
  /** The runner answered, but not with a frame of this protocol. */
  | 'protocol'
  /** The runner reported a failure (`load`, `missing`, `threw`, `timeout`, `invalid`). */
  | 'load'
  | 'missing'
  | 'threw'
  | 'invalid';

export type RelayHookOutcome =
  | {
      readonly ok: true;
      readonly decision: unknown;
      /** A `replace` decision's body. */
      readonly body: Buffer | null;
      readonly bodyIsText: boolean;
      readonly durationMs: number;
    }
  | {
      readonly ok: false;
      readonly kind: RelayHookFailureKind;
      /** The error's class name, when the runner reported one. */
      readonly name?: string;
      /** Hook-supplied text: never log it for request stages (it may quote application data). */
      readonly message: string;
      readonly durationMs: number;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Call one hook. Never throws: every failure is an outcome. */
export async function callRelayHook(
  socketPath: string,
  call: RelayHookCall,
): Promise<RelayHookOutcome> {
  const started = Date.now();
  const elapsed = (): number => Date.now() - started;
  const deadline = started + call.timeoutMs;
  const request: HookCallRequest = {
    v: HOOK_PROTOCOL_VERSION,
    plugin: call.plugin,
    stage: call.stage,
    call: call.call,
    deadline,
    input: call.input,
    body: call.body ? { contentType: call.body.contentType } : null,
  };

  let frame: Buffer;
  try {
    frame = encodeFrame(request, call.body?.bytes);
  } catch (err: unknown) {
    return {
      ok: false,
      kind: 'protocol',
      message: `Could not encode the hook call: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: elapsed(),
    };
  }

  const socket = net.connect(socketPath);
  const budget = call.timeoutMs + HOOK_CALL_GRACE_MS;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timed out')), budget);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  } catch (err: unknown) {
    socket.destroy();
    return {
      ok: false,
      kind: 'unavailable',
      message: err instanceof Error ? err.message : String(err),
      durationMs: elapsed(),
    };
  }

  try {
    socket.write(frame);
    const remaining = Math.max(1, budget - elapsed());
    const response = await readFrame(socket, {
      limits: DEFAULT_FRAME_LIMITS,
      timeoutMs: remaining,
    });
    const header = response.header;
    if (!isRecord(header) || header['v'] !== HOOK_PROTOCOL_VERSION) {
      return {
        ok: false,
        kind: 'protocol',
        message: 'Malformed runner response',
        durationMs: elapsed(),
      };
    }
    if (header['ok'] === true) {
      return {
        ok: true,
        decision: header['decision'],
        body: response.body.length > 0 ? response.body : null,
        bodyIsText: header['bodyIsText'] === true,
        durationMs: elapsed(),
      };
    }
    const error = isRecord(header['error']) ? header['error'] : {};
    const kind = error['kind'];
    return {
      ok: false,
      kind:
        kind === 'load' ||
        kind === 'missing' ||
        kind === 'threw' ||
        kind === 'invalid' ||
        kind === 'timeout'
          ? kind
          : 'protocol',
      ...(typeof error['name'] === 'string' ? { name: error['name'].slice(0, 100) } : {}),
      message: typeof error['message'] === 'string' ? error['message'].slice(0, 500) : '',
      durationMs: elapsed(),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: /timed out/i.test(message) ? 'timeout' : 'protocol',
      message,
      durationMs: elapsed(),
    };
  } finally {
    socket.destroy();
  }
}
