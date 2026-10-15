/**
 * Lifecycle hooks — the names, defaults and limits every part of Lamaste
 * agrees on: the manifest schema (root), the hook runner (this subpath, run
 * inside the relay's sandbox), the panel's pipelines (server subpath) and the
 * agent's sync (agent subpath).
 *
 * This subpath is self-contained on purpose: the hook runner loads it under
 * Node's permission model with read access to this directory only, so
 * nothing here may import from outside `src/hooks/` or from a package.
 */

/** Stages a relay hook may declare, by pipeline. */
export const RELAY_INSTALL_STAGES = ['pre-tunnel', 'post-tunnel'] as const;
export const RELAY_UNINSTALL_STAGES = ['pre-teardown', 'post-teardown'] as const;
export const REQUEST_STAGES = ['pre-forward', 'post-forward'] as const;
export const TUNNEL_STAGES = ['down', 'up'] as const;

export type InstallStage = (typeof RELAY_INSTALL_STAGES)[number];
export type UninstallStage = (typeof RELAY_UNINSTALL_STAGES)[number];
export type RequestStage = (typeof REQUEST_STAGES)[number];
export type TunnelStage = (typeof TUNNEL_STAGES)[number];

/**
 * The fully qualified stage names a hook module exports functions for, and
 * the agent half answers at `POST /admin/hooks/<stage>`.
 */
export const HOOK_STAGES = [
  'install:pre-tunnel',
  'install:post-tunnel',
  'uninstall:pre-teardown',
  'uninstall:post-teardown',
  'request:pre-forward',
  'request:post-forward',
  'tunnel:down',
  'tunnel:up',
] as const;

export type HookStage = (typeof HOOK_STAGES)[number];

/** Stages the agent half may declare: no request stages — the agent half *is* the handler. */
export const AGENT_HOOK_STAGES = [
  'install:pre-tunnel',
  'install:post-tunnel',
  'uninstall:pre-teardown',
  'uninstall:post-teardown',
  'tunnel:down',
  'tunnel:up',
] as const satisfies readonly HookStage[];

export type AgentHookStage = (typeof AGENT_HOOK_STAGES)[number];

export function isHookStage(value: unknown): value is HookStage {
  return typeof value === 'string' && (HOOK_STAGES as readonly string[]).includes(value);
}

export function isAgentHookStage(value: unknown): value is AgentHookStage {
  return typeof value === 'string' && (AGENT_HOOK_STAGES as readonly string[]).includes(value);
}

/** The agent half's route prefix for hook calls; the forwarder never reaches it. */
export const AGENT_HALF_HOOKS_PREFIX = '/admin/hooks';

/** `POST /admin/hooks/<stage>` on the agent half. */
export function agentHalfHookPath(stage: AgentHookStage): string {
  return `${AGENT_HALF_HOOKS_PREFIX}/${stage}`;
}

/**
 * Timeouts (milliseconds): the default when a declaration names none, and
 * the cap Lamaste enforces whatever it names.
 */
export const HOOK_TIMEOUTS = Object.freeze({
  /** install / uninstall stages on the relay. */
  lifecycle: Object.freeze({ default: 30_000, max: 120_000 }),
  /** request:pre-forward / request:post-forward. */
  request: Object.freeze({ default: 500, max: 2_000 }),
  /** tunnel:down / tunnel:up on the relay. */
  tunnel: Object.freeze({ default: 2_000, max: 10_000 }),
  /** install / uninstall / tunnel stages on the agent half. */
  agent: Object.freeze({ default: 60_000, max: 300_000 }),
});

/** Largest body a request hook may ask to see, before the tunnel's own body limit applies. */
export const REQUEST_HOOK_MAX_BODY_BYTES = 10 * 1024 * 1024;

/** At most this many request hook declarations per plugin, and route patterns per declaration. */
export const REQUEST_HOOKS_MAX = 20;
export const REQUEST_HOOK_ROUTES_MAX = 20;

/** What a request hook does when it fails or times out — fail closed by default. */
export const PRE_FORWARD_ON_ERROR = ['reject', 'continue'] as const;
export const POST_FORWARD_ON_ERROR = ['block', 'pass'] as const;

export type PreForwardOnError = (typeof PRE_FORWARD_ON_ERROR)[number];
export type PostForwardOnError = (typeof POST_FORWARD_ON_ERROR)[number];

/**
 * Effects a relay hook may return. Lamaste performs them with its own
 * credentials, rate-limited; a hook never performs them itself. New types are
 * added deliberately — never a generic "call this URL".
 */
export const HOOK_EFFECT_TYPES = ['audit', 'notify-admins', 'log'] as const;

export type HookEffectType = (typeof HOOK_EFFECT_TYPES)[number];

export const HOOK_EFFECT_LIMITS = Object.freeze({
  /** Effects in one decision. */
  perDecision: 10,
  /** Characters of a notification or log message. */
  messageMax: 500,
  /** Serialised bytes of an audit or log `data` object. */
  dataMaxBytes: 2_048,
  /** Per plugin and effect type, in a sliding minute. */
  perMinute: Object.freeze({ audit: 60, 'notify-admins': 6, log: 120 }),
});

/** An audit event name a hook may use: lower case, dots and hyphens. */
export const HOOK_AUDIT_EVENT_RE = /^[a-z][a-z0-9.-]{0,63}$/;

// ---------------------------------------------------------------------------
// Shared hooks shipped by Lamaste
// ---------------------------------------------------------------------------

/** The secret scanner, the first shared hook. */
export const SECRET_SCAN_HOOK = 'lamaste:secret-scan';

/** Shared hooks a manifest may enable with `use`. */
export const SHARED_HOOKS = [SECRET_SCAN_HOOK] as const;

export type SharedHookName = (typeof SHARED_HOOKS)[number];

export function isSharedHookName(value: unknown): value is SharedHookName {
  return typeof value === 'string' && (SHARED_HOOKS as readonly string[]).includes(value);
}

/**
 * Rule packs of the secret scanner, with the version of each. A pack only
 * gains rules within a Lamaste major; removing or loosening a rule waits for
 * a major. Lamaste records an audit entry for every plugin using a pack when
 * its version changes.
 */
export const SECRET_SCAN_PACKS = Object.freeze({
  credentials: 1,
  jwt: 1,
  assignments: 1,
});

export type SecretScanPack = keyof typeof SECRET_SCAN_PACKS;

export const SECRET_SCAN_PACK_NAMES = Object.keys(SECRET_SCAN_PACKS) as [
  SecretScanPack,
  ...SecretScanPack[],
];

export const SECRET_SCAN_ACTIONS = ['redact', 'block'] as const;
export type SecretScanAction = (typeof SECRET_SCAN_ACTIONS)[number];

export const SECRET_SCAN_ON_UNSCANNABLE = ['block', 'pass'] as const;
export type SecretScanOnUnscannable = (typeof SECRET_SCAN_ON_UNSCANNABLE)[number];

/** Settings of `lamaste:secret-scan` after defaults. */
export interface SecretScanSettings {
  readonly action: SecretScanAction;
  readonly packs: readonly SecretScanPack[];
  readonly onUnscannable: SecretScanOnUnscannable;
}

export const SECRET_SCAN_DEFAULTS: SecretScanSettings = Object.freeze({
  action: 'redact',
  packs: Object.freeze(['credentials']) as readonly SecretScanPack[],
  onUnscannable: 'block',
});

/** What a shared hook may return as effects, shown in the approval preview. */
export const SHARED_HOOK_EFFECTS: Readonly<Record<SharedHookName, readonly HookEffectType[]>> =
  Object.freeze({
    [SECRET_SCAN_HOOK]: Object.freeze(['audit'] as const),
  });

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

/** The protocol version spoken between Lamaste and the hook runner. */
export const HOOK_PROTOCOL_VERSION = 1 as const;

/** Largest JSON header of a frame (request or decision). */
export const HOOK_FRAME_HEADER_MAX_BYTES = 256 * 1024;

/** Largest body of a frame — a request hook's body cap. */
export const HOOK_FRAME_BODY_MAX_BYTES = REQUEST_HOOK_MAX_BODY_BYTES;

/** The runner exits after this long without a call; socket activation starts it again. */
export const HOOK_RUNNER_IDLE_EXIT_MS = 10 * 60_000;
