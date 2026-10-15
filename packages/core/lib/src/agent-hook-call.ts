/**
 * Calling an agent hook: `POST /admin/hooks/<stage>` on the agent half, with
 * a caller assertion naming Lamaste itself (`{ type: 'lamaste' }`). The
 * relay makes this call through the internal tunnel (its loopback end); the
 * agent's sync makes it on the agent's own loopback for the stages that run
 * while there is no tunnel (agent jobs). The forwarder never reaches
 * `/admin/hooks`, so no forwarded caller can.
 *
 * The agent half answers `{ ok: true, output? }` or `{ ok: false, reason }`
 * (see `AgentHookDecision` in `@lamalibre/lamaste/hooks`). Anything else —
 * a status other than 200, a body that is not that shape, a timeout — is a
 * failure of the stage.
 */

import http from 'node:http';

import { CALLER_ASSERTION_HEADER, signCallerAssertion } from './caller-assertion.js';
import {
  AGENT_HOOK_DECISION_MAX_BYTES,
  agentHalfHookPath,
  parseAgentHookDecision,
} from './hooks/index.js';
import type { AgentHookDecision, AgentHookStage } from './hooks/index.js';

export interface AgentHookCallOptions {
  readonly plugin: string;
  readonly port: number;
  readonly secret: string;
  readonly stage: AgentHookStage;
  readonly input: Readonly<Record<string, unknown>>;
  readonly timeoutMs: number;
  readonly host?: string | undefined;
}

export type AgentHookCallFailure =
  /** Nothing listens on the port: the tunnel is down (relay) or the agent half is not running (agent). */
  | 'refused'
  | 'timeout'
  /** An answer that is not a decision (status, body, size). */
  | 'invalid'
  | 'other';

export type AgentHookCallResult =
  | { readonly ok: true; readonly decision: AgentHookDecision }
  | { readonly ok: false; readonly code: AgentHookCallFailure; readonly error: string };

export function callAgentHalfHook(opts: AgentHookCallOptions): Promise<AgentHookCallResult> {
  const host = opts.host ?? '127.0.0.1';
  const path = agentHalfHookPath(opts.stage);
  const body = Buffer.from(JSON.stringify({ stage: opts.stage, input: opts.input }), 'utf-8');
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: AgentHookCallResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const invalid = (error: string): void => finish({ ok: false, code: 'invalid', error });
    const req = http.request(
      {
        host,
        port: opts.port,
        method: 'POST',
        path,
        headers: {
          [CALLER_ASSERTION_HEADER]: signCallerAssertion(
            { plugin: opts.plugin, caller: { type: 'lamaste' }, method: 'POST', path },
            opts.secret,
          ),
          'content-type': 'application/json',
          'content-length': String(body.length),
          accept: 'application/json',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > AGENT_HOOK_DECISION_MAX_BYTES) {
            req.destroy();
            invalid('The agent half answered with too large a body');
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            invalid(`The agent half answered ${res.statusCode ?? 'nothing'}`);
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          } catch {
            invalid('The agent half answered with something other than JSON');
            return;
          }
          const decision = parseAgentHookDecision(parsed);
          if (decision) finish({ ok: true, decision });
          else invalid('The agent half answered with an invalid decision');
        });
        res.on('error', (err) => finish({ ok: false, code: 'other', error: err.message }));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish({ ok: false, code: 'timeout', error: `No answer within ${opts.timeoutMs} ms` });
    }, opts.timeoutMs);
    req.on('error', (err: NodeJS.ErrnoException) =>
      finish(
        err.code === 'ECONNREFUSED'
          ? {
              ok: false,
              code: 'refused',
              error: 'Nothing answers on the port (connection refused)',
            }
          : { ok: false, code: 'other', error: err.message },
      ),
    );
    req.end(body);
  });
}
