/**
 * The wire protocol between Lamaste (`lamaste-serverd`) and a plugin's hook
 * runner, over the runner's Unix socket. One call per connection: Lamaste
 * writes one request frame, the runner answers with one response frame and
 * closes.
 *
 * A frame is `u32 headerLength | header (UTF-8 JSON) | u32 bodyLength | body`,
 * lengths big-endian. The header carries everything structured; the body
 * carries the bytes of a request or response body a hook asked to see (or a
 * `replace` decision's new body) without the cost of encoding them in JSON.
 */

import type { Socket } from 'node:net';

import {
  HOOK_FRAME_BODY_MAX_BYTES,
  HOOK_FRAME_HEADER_MAX_BYTES,
  HOOK_PROTOCOL_VERSION,
} from './constants.js';
import type { HookStage, SecretScanSettings, SharedHookName } from './constants.js';

/** Which function the runner calls. */
export type HookCallTarget =
  | { readonly kind: 'app' }
  | {
      readonly kind: 'shared';
      readonly name: SharedHookName;
      readonly settings: SecretScanSettings;
    };

export interface HookCallRequest {
  readonly v: typeof HOOK_PROTOCOL_VERSION;
  readonly plugin: string;
  readonly stage: HookStage;
  readonly call: HookCallTarget;
  /** Milliseconds since the epoch. */
  readonly deadline: number;
  /** The stage's input, without its body. */
  readonly input: Readonly<Record<string, unknown>>;
  /** Present when the frame body is the input's body. */
  readonly body: { readonly contentType: string | null } | null;
}

export type HookCallResponse =
  | {
      readonly v: typeof HOOK_PROTOCOL_VERSION;
      readonly ok: true;
      /** The decision; a `replace` decision's body travels as the frame body. */
      readonly decision: Readonly<Record<string, unknown>>;
      readonly bodyIsText?: boolean;
    }
  | {
      readonly v: typeof HOOK_PROTOCOL_VERSION;
      readonly ok: false;
      readonly error: {
        /** `load` (the module failed to load), `missing` (no function for the stage), `threw`, `timeout`, `invalid`. */
        readonly kind: 'load' | 'missing' | 'threw' | 'timeout' | 'invalid';
        readonly name: string;
        readonly message: string;
      };
    };

export interface Frame {
  readonly header: unknown;
  readonly body: Buffer;
}

export interface FrameLimits {
  readonly headerMaxBytes: number;
  readonly bodyMaxBytes: number;
}

export const DEFAULT_FRAME_LIMITS: FrameLimits = Object.freeze({
  headerMaxBytes: HOOK_FRAME_HEADER_MAX_BYTES,
  bodyMaxBytes: HOOK_FRAME_BODY_MAX_BYTES,
});

export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameError';
  }
}

/** Encode one frame. */
export function encodeFrame(header: unknown, body: Uint8Array = new Uint8Array(0)): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf-8');
  const out = Buffer.allocUnsafe(8 + json.length + body.length);
  out.writeUInt32BE(json.length, 0);
  json.copy(out, 4);
  out.writeUInt32BE(body.length, 4 + json.length);
  out.set(body, 8 + json.length);
  return out;
}

/**
 * Accumulates chunks until one frame is complete. Throws a
 * {@link FrameError} as soon as a length exceeds its limit, so an oversized
 * frame is refused before it is buffered.
 */
export class FrameReader {
  readonly #limits: FrameLimits;
  #chunks: Buffer[] = [];
  #size = 0;
  #headerLength: number | null = null;
  #bodyLength: number | null = null;

  constructor(limits: FrameLimits = DEFAULT_FRAME_LIMITS) {
    this.#limits = limits;
  }

  /**
   * Join the chunks into one buffer. Called only once enough bytes arrived
   * for the next length field or the whole frame — at most three times per
   * frame — so a large body is not copied once per chunk.
   */
  #compact(): Buffer {
    if (this.#chunks.length !== 1) this.#chunks = [Buffer.concat(this.#chunks, this.#size)];
    return this.#chunks[0] as Buffer;
  }

  /** Add a chunk; returns the frame once complete, else null. */
  push(chunk: Buffer): Frame | null {
    this.#chunks.push(chunk);
    this.#size += chunk.length;

    if (this.#headerLength === null) {
      if (this.#size < 4) return null;
      this.#headerLength = this.#compact().readUInt32BE(0);
      if (this.#headerLength > this.#limits.headerMaxBytes) {
        throw new FrameError(`Frame header of ${this.#headerLength} bytes exceeds the limit`);
      }
    }
    const afterHeader = 4 + this.#headerLength;
    if (this.#bodyLength === null) {
      if (this.#size < afterHeader + 4) return null;
      this.#bodyLength = this.#compact().readUInt32BE(afterHeader);
      if (this.#bodyLength > this.#limits.bodyMaxBytes) {
        throw new FrameError(`Frame body of ${this.#bodyLength} bytes exceeds the limit`);
      }
    }
    const total = afterHeader + 4 + this.#bodyLength;
    if (this.#size < total) return null;
    if (this.#size > total) throw new FrameError('Unexpected bytes after the frame');
    const buf = this.#compact();
    let header: unknown;
    try {
      header = JSON.parse(buf.subarray(4, afterHeader).toString('utf-8'));
    } catch {
      throw new FrameError('Frame header is not JSON');
    }
    return { header, body: buf.subarray(afterHeader + 4, total) };
  }

  get bytesRead(): number {
    return this.#size;
  }
}

/** Read exactly one frame from a socket. Rejects on a limit, a closed socket or `timeoutMs`. */
export function readFrame(
  socket: Socket,
  opts: { readonly limits?: FrameLimits; readonly timeoutMs?: number } = {},
): Promise<Frame> {
  const reader = new FrameReader(opts.limits ?? DEFAULT_FRAME_LIMITS);
  return new Promise<Frame>((resolve, reject) => {
    let done = false;
    const timer =
      opts.timeoutMs === undefined
        ? null
        : setTimeout(() => finish(new FrameError('Timed out waiting for a frame')), opts.timeoutMs);
    const finish = (err: Error | null, frame?: Frame): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      socket.off('data', onData);
      socket.off('end', onEnd);
      socket.off('error', onError);
      socket.off('close', onEnd);
      if (err) reject(err);
      else resolve(frame as Frame);
    };
    const onData = (chunk: Buffer): void => {
      try {
        const frame = reader.push(chunk);
        if (frame) finish(null, frame);
      } catch (err: unknown) {
        finish(err instanceof Error ? err : new FrameError(String(err)));
      }
    };
    const onEnd = (): void => finish(new FrameError('Connection closed before a whole frame'));
    const onError = (err: Error): void => finish(err);
    socket.on('data', onData);
    socket.once('end', onEnd);
    socket.once('close', onEnd);
    socket.once('error', onError);
  });
}
