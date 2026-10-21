/**
 * Hook sets — a plugin's lifecycle hooks with every default applied, in the
 * one shape the panel's pipelines, the approval preview and the digest work
 * from.
 *
 * **Approval binds bytes.** An admin approves what Lamaste itself will run
 * or install for a plugin, and the approval names its digest
 * ({@link approvalDigest}): SHA-256 over the canonical JSON of
 *
 * - the plugin's *relay* hook set — the normalised relay declarations and
 *   the SHA-256 of the relay entry file (code Lamaste runs on the relay);
 * - its *agent half* when Lamaste installs it — the package, its version
 *   and tarball integrity, the service spec and the system packages (code
 *   and packages Lamaste installs on the hosting agent, as root);
 * - its *identity* block when it declares one — the roles its users hold
 *   and the attributes Lamaste gives it about them (`identity.ts`).
 *
 * A new plugin version that differs in any of them by one byte has another
 * digest and waits for approval again (or the plugin's auto-approve — which
 * never covers an identity change that adds or removes a role or widens the
 * attributes, `identityChangeNeedsApproval`). Agent hooks are calls into
 * the agent half, which the agent half's own part of the approval already
 * covers (or which the operator installed by hand).
 */

import crypto from 'node:crypto';

import { AgentHalfSpecSchema } from './agent-half.js';
import type { AgentHalfSpec } from './agent-half.js';
import { normalizeIdentityBlock } from './identity.js';
import type { IdentityBlockInput } from './identity.js';

import {
  HOOK_TIMEOUTS,
  SECRET_SCAN_DEFAULTS,
  SECRET_SCAN_HOOK,
  SECRET_SCAN_PACKS,
  SHARED_HOOK_EFFECTS,
} from './hooks/index.js';
import type {
  AgentHookStage,
  HookEffectType,
  HookStage,
  PostForwardOnError,
  PreForwardOnError,
  RequestStage,
  SecretScanSettings,
  SharedHookName,
} from './hooks/index.js';
import type { ParsedManifest } from './schemas.js';

/** A relay lifecycle or tunnel stage the plugin's module implements. */
export interface RelayStageHook {
  readonly stage: Exclude<HookStage, 'request:pre-forward' | 'request:post-forward'>;
  readonly timeoutMs: number;
}

export interface RequestHook {
  /** Position in the manifest's `request` list — hooks on one route run in this order. */
  readonly index: number;
  readonly stage: RequestStage;
  readonly routes: readonly string[];
  /** Bytes of body the hook sees; null — it sees none. */
  readonly bodyMaxBytes: number | null;
  readonly timeoutMs: number;
  readonly onError: PreForwardOnError | PostForwardOnError;
  readonly onOversize: PreForwardOnError | PostForwardOnError;
  /** A shared hook (Lamaste's code), or null for the plugin's own module. */
  readonly use: SharedHookName | null;
  /** The shared hook's settings with defaults (secret-scan). */
  readonly settings: SecretScanSettings | null;
}

export interface RelayHookSet {
  /** The module's path inside the relay package, or null when only shared hooks are used. */
  readonly entry: string | null;
  /** Effect types the plugin's own hooks may return. */
  readonly effects: readonly HookEffectType[];
  readonly stages: readonly RelayStageHook[];
  readonly request: readonly RequestHook[];
}

export interface AgentStageHook {
  readonly stage: AgentHookStage;
  readonly timeoutMs: number;
}

export interface AgentHookSet {
  readonly stages: readonly AgentStageHook[];
}

const STAGE_ORDER: readonly RelayStageHook['stage'][] = [
  'install:pre-tunnel',
  'install:post-tunnel',
  'uninstall:pre-teardown',
  'uninstall:post-teardown',
  'tunnel:down',
  'tunnel:up',
];

/** The relay hook set of a manifest, or null when it declares no relay hook. */
export function relayHookSetOf(manifest: Pick<ParsedManifest, 'hooks'>): RelayHookSet | null {
  const relay = manifest.hooks?.relay;
  if (!relay) return null;
  const stages: RelayStageHook[] = [];
  const add = (
    stage: RelayStageHook['stage'],
    decl: { timeoutMs?: number | undefined } | undefined,
    fallback: number,
  ) => {
    if (decl !== undefined) stages.push({ stage, timeoutMs: decl.timeoutMs ?? fallback });
  };
  add('install:pre-tunnel', relay.install?.['pre-tunnel'], HOOK_TIMEOUTS.lifecycle.default);
  add('install:post-tunnel', relay.install?.['post-tunnel'], HOOK_TIMEOUTS.lifecycle.default);
  add('uninstall:pre-teardown', relay.uninstall?.['pre-teardown'], HOOK_TIMEOUTS.lifecycle.default);
  add(
    'uninstall:post-teardown',
    relay.uninstall?.['post-teardown'],
    HOOK_TIMEOUTS.lifecycle.default,
  );
  add('tunnel:down', relay.tunnel?.down, HOOK_TIMEOUTS.tunnel.default);
  add('tunnel:up', relay.tunnel?.up, HOOK_TIMEOUTS.tunnel.default);
  stages.sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));

  const request: RequestHook[] = (relay.request ?? []).map((decl, index) => {
    const closed = decl.stage === 'pre-forward' ? 'reject' : 'block';
    return {
      index,
      stage: decl.stage,
      routes: [...decl.routes],
      bodyMaxBytes: decl.body?.maxBytes ?? null,
      timeoutMs: decl.timeoutMs ?? HOOK_TIMEOUTS.request.default,
      onError: decl.onError ?? closed,
      onOversize: decl.onOversize ?? closed,
      use: decl.use ?? null,
      settings:
        decl.use === SECRET_SCAN_HOOK
          ? {
              action:
                (decl.with?.['action'] as SecretScanSettings['action'] | undefined) ??
                SECRET_SCAN_DEFAULTS.action,
              packs:
                (decl.with?.['packs'] as SecretScanSettings['packs'] | undefined) ??
                SECRET_SCAN_DEFAULTS.packs,
              onUnscannable:
                (decl.with?.['onUnscannable'] as SecretScanSettings['onUnscannable'] | undefined) ??
                SECRET_SCAN_DEFAULTS.onUnscannable,
            }
          : null,
    };
  });

  if (stages.length === 0 && request.length === 0) return null;
  return { entry: relay.entry ?? null, effects: [...(relay.effects ?? [])], stages, request };
}

/** The agent hook set of a manifest, or null when it declares no agent hook. */
export function agentHookSetOf(manifest: Pick<ParsedManifest, 'hooks'>): AgentHookSet | null {
  const agent = manifest.hooks?.agent;
  if (!agent) return null;
  const stages: AgentStageHook[] = [];
  const add = (stage: AgentHookStage, decl: { timeoutMs?: number | undefined } | undefined) => {
    if (decl !== undefined) {
      stages.push({ stage, timeoutMs: decl.timeoutMs ?? HOOK_TIMEOUTS.agent.default });
    }
  };
  add('install:pre-tunnel', agent.install?.['pre-tunnel']);
  add('install:post-tunnel', agent.install?.['post-tunnel']);
  add('uninstall:pre-teardown', agent.uninstall?.['pre-teardown']);
  add('uninstall:post-teardown', agent.uninstall?.['post-teardown']);
  add('tunnel:down', agent.tunnel?.down);
  add('tunnel:up', agent.tunnel?.up);
  return stages.length > 0 ? { stages } : null;
}

/** Whether a relay hook set needs the plugin's own module (it does unless only shared hooks are used). */
export function relayHookSetNeedsEntry(set: RelayHookSet): boolean {
  return set.stages.length > 0 || set.request.some((h) => h.use === null);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** The version of the approval digest's canonical form (2: relay hooks and the agent half). */
export const HOOK_SET_DIGEST_VERSION = 2;

/** What one approval covers; an approval is needed when any part is non-null. */
export interface ApprovalSubject {
  /**
   * The relay hook set and the SHA-256 (hex) of its entry file — null when
   * the set uses shared hooks only; the part is null when the plugin
   * declares no relay hook.
   */
  readonly relay: { readonly set: RelayHookSet; readonly entrySha256: string | null } | null;
  /** The agent half Lamaste installs, or null when it installs none. */
  readonly agentHalf: AgentHalfSpec | null;
  /** The plugin's identity block; null or omitted when it declares none. */
  readonly identity?: IdentityBlockInput | null | undefined;
}

/**
 * The digest an approval names: SHA-256 (hex) of the canonical JSON (keys
 * sorted at every level) of
 * `{ v: 2, relay: { set, entrySha256 } | null, agentHalf: { package, version, integrity, service: { entry, memoryMax }, systemPackages } | null, identity?: { roles, attributes } }`,
 * with the agent half's system packages sorted and without repeats, and
 * `identity` — the block as {@link normalizeIdentityBlock} returns it —
 * only when the plugin declares one: a digest without it is the digest of
 * the same subject before identity existed, byte for byte. Throws on an
 * entry digest that is not SHA-256 hex, an agent half that is not a valid
 * {@link AgentHalfSpec} (`AgentHalfSpecSchema`, which refuses unknown keys)
 * or an identity block that is not valid — none can be approved.
 */
export function approvalDigest(subject: ApprovalSubject): string {
  const { relay } = subject;
  if (relay && relay.entrySha256 !== null && !/^[a-f0-9]{64}$/.test(relay.entrySha256)) {
    throw new Error('entrySha256 must be a SHA-256 hex digest');
  }
  let agentHalf: AgentHalfSpec | null = null;
  if (subject.agentHalf) {
    const parsed = AgentHalfSpecSchema.safeParse(subject.agentHalf);
    if (!parsed.success) {
      throw new Error(
        `agentHalf is not a valid agent half spec (${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')})`,
      );
    }
    const spec = parsed.data;
    agentHalf = {
      package: spec.package,
      version: spec.version,
      integrity: spec.integrity,
      service: { entry: spec.service.entry, memoryMax: spec.service.memoryMax },
      systemPackages: [...new Set(spec.systemPackages)].sort(),
    };
  }
  const identity =
    subject.identity === null || subject.identity === undefined
      ? null
      : normalizeIdentityBlock(subject.identity);
  const doc = canonical({
    v: HOOK_SET_DIGEST_VERSION,
    relay: relay ? { set: relay.set, entrySha256: relay.entrySha256 } : null,
    agentHalf,
    ...(identity ? { identity } : {}),
  });
  return crypto.createHash('sha256').update(JSON.stringify(doc)).digest('hex');
}

/**
 * The approval digest of a plugin whose agent half Lamaste does not install
 * and that declares no identity:
 * `approvalDigest({ relay: { set, entrySha256 }, agentHalf: null })`.
 */
export function relayHookSetDigest(set: RelayHookSet, entrySha256: string | null): string {
  return approvalDigest({ relay: { set, entrySha256 }, agentHalf: null });
}

/** SHA-256 (hex) of a relay entry file's bytes. */
export function hookEntrySha256(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** What the approval preview shows about a relay hook set. */
export interface RelayHookSetPreview {
  /**
   * {@link relayHookSetDigest} — the approval digest when Lamaste installs no
   * agent half and the plugin declares no identity.
   */
  readonly digest: string;
  readonly entry: string | null;
  readonly entrySha256: string | null;
  readonly stages: readonly RelayStageHook[];
  readonly request: readonly (RequestHook & {
    /** This hook lets traffic through when it fails, times out, or the body is too large. */
    readonly failOpen: readonly ('onError' | 'onOversize' | 'onUnscannable')[];
    /**
     * Routes under `/app`: they run for requests on the plugin's user
     * surface, which only a plugin that declares `identity` has.
     */
    readonly userSurfaceRoutes: readonly string[];
  })[];
  /** Every effect type the set may produce: the plugin's declared ones and the shared hooks'. */
  readonly effects: readonly HookEffectType[];
  /** Rule packs of shared hooks, with their versions (`credentials@1`). */
  readonly packs: readonly string[];
  readonly failOpenCount: number;
}

export function relayHookSetPreview(
  set: RelayHookSet,
  entrySha256: string | null,
): RelayHookSetPreview {
  const effects = new Set<HookEffectType>(set.effects);
  const packs = new Set<string>();
  let failOpenCount = 0;
  const request = set.request.map((hook) => {
    const failOpen: ('onError' | 'onOversize' | 'onUnscannable')[] = [];
    if (hook.onError === 'continue' || hook.onError === 'pass') failOpen.push('onError');
    if (
      hook.bodyMaxBytes !== null &&
      (hook.onOversize === 'continue' || hook.onOversize === 'pass')
    ) {
      failOpen.push('onOversize');
    }
    if (hook.settings?.onUnscannable === 'pass') failOpen.push('onUnscannable');
    if (hook.use !== null) {
      for (const e of SHARED_HOOK_EFFECTS[hook.use]) effects.add(e);
    }
    for (const pack of hook.settings?.packs ?? []) packs.add(`${pack}@${SECRET_SCAN_PACKS[pack]}`);
    failOpenCount += failOpen.length;
    return {
      ...hook,
      failOpen,
      userSurfaceRoutes: hook.routes.filter((r) => /(?:^| )\/app(?:\/|$)/.test(r)),
    };
  });
  return {
    digest: relayHookSetDigest(set, entrySha256),
    entry: set.entry,
    entrySha256,
    stages: set.stages,
    request,
    effects: [...effects].sort(),
    packs: [...packs].sort(),
    failOpenCount,
  };
}

/** The pack versions a relay hook set uses, `{ credentials: 1 }` — recorded to notice rule updates. */
export function relayHookSetPackVersions(set: RelayHookSet): Record<string, number> {
  const out: Record<string, number> = {};
  for (const hook of set.request) {
    for (const pack of hook.settings?.packs ?? []) out[pack] = SECRET_SCAN_PACKS[pack];
  }
  return out;
}
