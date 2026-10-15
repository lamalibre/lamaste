/**
 * Validation of what a relay hook returns. A hook is plugin code: its
 * decision is accepted only in the shape the contract allows
 * (`../hooks/types.ts`), with bounded sizes, and header edits that cannot
 * touch credentials, Lamaste's own headers or framing. A decision that does
 * not validate is a hook failure, handled by the hook's `onError`.
 */

import { z } from 'zod';

import { HOOK_AUDIT_EVENT_RE, HOOK_EFFECT_LIMITS } from '../hooks/index.js';
import type {
  HookEffect,
  HookStage,
  LifecycleHookDecision,
  PostForwardDecision,
  PreForwardDecision,
  TunnelDownDecision,
  TunnelUpDecision,
} from '../hooks/index.js';

/** Largest JSON body a `reject` decision or a tunnel fallback may carry. */
export const HOOK_JSON_BODY_MAX_BYTES = 16 * 1024;
/** Largest lifecycle `output`. */
export const HOOK_OUTPUT_MAX_BYTES = 16 * 1024;

const HEADER_NAME_RE = /^[a-z0-9!#$%&'*+.^_`|~-]{1,100}$/;
// No CR, LF or NUL: one header line, never two.
// eslint-disable-next-line no-control-regex
const HEADER_VALUE_RE = /^[^\r\n\u0000]{0,8192}$/;

/** Headers a hook may never set or remove, on a request or a response. */
const PROTECTED_HEADERS = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'content-encoding',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'cookie',
  'set-cookie',
  'set-cookie2',
  'authorization',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'x-accel-buffering',
  'x-accel-redirect',
]);

/** Whether a hook may set or remove header `name` (lower case). */
export function isHookEditableHeader(name: string): boolean {
  return (
    HEADER_NAME_RE.test(name) &&
    !PROTECTED_HEADERS.has(name) &&
    !name.startsWith('x-lamalibre-') &&
    !name.startsWith('x-ssl-client-') &&
    !name.startsWith('remote-') &&
    !name.startsWith('x-accel-')
  );
}

function jsonSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const jsonValue = (maxBytes: number) =>
  z
    .unknown()
    .refine(
      (v) => v !== undefined && jsonSize(v) <= maxBytes,
      `must be JSON of at most ${maxBytes} bytes`,
    );

const HeaderEditsSchema = z
  .record(z.string())
  .refine(
    (headers) =>
      Object.entries(headers).every(
        ([name, value]) => isHookEditableHeader(name.toLowerCase()) && HEADER_VALUE_RE.test(value),
      ),
    'Header edits may not touch credentials, framing or Lamaste headers',
  )
  .refine((headers) => Object.keys(headers).length <= 20, 'At most 20 header edits');

const EffectDataSchema = z
  .record(z.union([z.string().max(300), z.number().finite(), z.boolean(), z.null()]))
  .refine((d) => jsonSize(d) <= HOOK_EFFECT_LIMITS.dataMaxBytes, 'effect data is too large');

const EffectSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('audit'),
      event: z.string().regex(HOOK_AUDIT_EVENT_RE),
      data: EffectDataSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('notify-admins'),
      message: z.string().min(1).max(HOOK_EFFECT_LIMITS.messageMax),
      level: z.enum(['info', 'warning', 'critical']).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('log'),
      message: z.string().min(1).max(HOOK_EFFECT_LIMITS.messageMax),
      level: z.enum(['info', 'warn']).optional(),
      data: EffectDataSchema.optional(),
    })
    .strict(),
]);

const EffectsSchema = z.array(EffectSchema).max(HOOK_EFFECT_LIMITS.perDecision).optional();

const LifecycleDecisionSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      output: jsonValue(HOOK_OUTPUT_MAX_BYTES).optional(),
      effects: EffectsSchema,
    })
    .strict(),
  z
    .object({ ok: z.literal(false), reason: z.string().min(1).max(500), effects: EffectsSchema })
    .strict(),
]);

const PreForwardDecisionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('continue'),
      setHeaders: HeaderEditsSchema.optional(),
      removeHeaders: z
        .array(z.string())
        .max(20)
        .refine((names) => names.every((n) => isHookEditableHeader(n.toLowerCase())))
        .optional(),
      effects: EffectsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('reject'),
      status: z.number().int().min(400).max(499),
      body: jsonValue(HOOK_JSON_BODY_MAX_BYTES).optional(),
      effects: EffectsSchema,
    })
    .strict(),
]);

/** A `replace` decision's body travels outside the JSON header (see the protocol). */
const PostForwardDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pass'), effects: EffectsSchema }).strict(),
  z
    .object({
      action: z.literal('replace'),
      contentType: z.string().min(1).max(200).regex(HEADER_VALUE_RE).optional(),
      setHeaders: HeaderEditsSchema.optional(),
      effects: EffectsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('block'),
      status: z.number().int().min(500).max(599).optional(),
      reasonId: z.string().regex(HOOK_AUDIT_EVENT_RE),
      effects: EffectsSchema,
    })
    .strict(),
]);

const TunnelFallbackSchema = z
  .object({
    status: z.number().int().min(400).max(599),
    retryAfter: z.number().int().min(0).max(86_400).optional(),
    contentType: z.string().min(1).max(200).regex(HEADER_VALUE_RE).optional(),
    body: jsonValue(HOOK_JSON_BODY_MAX_BYTES).optional(),
  })
  .strict();

const TunnelDownDecisionSchema = z
  .object({ fallback: TunnelFallbackSchema.optional(), effects: EffectsSchema })
  .strict();
const TunnelUpDecisionSchema = z.object({ effects: EffectsSchema }).strict();

export type ValidatedDecision<S extends HookStage> = S extends
  | 'install:pre-tunnel'
  | 'install:post-tunnel'
  | 'uninstall:pre-teardown'
  | 'uninstall:post-teardown'
  ? LifecycleHookDecision
  : S extends 'request:pre-forward'
    ? PreForwardDecision
    : S extends 'request:post-forward'
      ?
          | Exclude<PostForwardDecision, { action: 'replace' }>
          | {
              action: 'replace';
              contentType?: string;
              setHeaders?: Readonly<Record<string, string>>;
              effects?: readonly HookEffect[];
            }
      : S extends 'tunnel:down'
        ? TunnelDownDecision
        : TunnelUpDecision;

const SCHEMAS: Record<HookStage, z.ZodTypeAny> = {
  'install:pre-tunnel': LifecycleDecisionSchema,
  'install:post-tunnel': LifecycleDecisionSchema,
  'uninstall:pre-teardown': LifecycleDecisionSchema,
  'uninstall:post-teardown': LifecycleDecisionSchema,
  'request:pre-forward': PreForwardDecisionSchema,
  'request:post-forward': PostForwardDecisionSchema,
  'tunnel:down': TunnelDownDecisionSchema,
  'tunnel:up': TunnelUpDecisionSchema,
};

/**
 * Validate a hook's decision for `stage`. Returns the decision, or the
 * first problem (no hook-supplied values in it — safe to log).
 */
export function validateHookDecision<S extends HookStage>(
  stage: S,
  decision: unknown,
):
  | { readonly ok: true; readonly decision: ValidatedDecision<S> }
  | { readonly ok: false; readonly error: string } {
  const parsed = SCHEMAS[stage].safeParse(decision);
  if (parsed.success) return { ok: true, decision: parsed.data as ValidatedDecision<S> };
  const issue = parsed.error.issues[0];
  const where = issue && issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
  return { ok: false, error: `Invalid ${stage} decision${where}: ${issue?.message ?? 'invalid'}` };
}

/** The effects a decision carries (an empty list when none). */
export function decisionEffects(decision: unknown): readonly HookEffect[] {
  if (decision && typeof decision === 'object' && 'effects' in decision) {
    const effects = decision.effects;
    if (Array.isArray(effects)) return effects as HookEffect[];
  }
  return [];
}
