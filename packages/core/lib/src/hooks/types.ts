/**
 * The hook contract as a plugin author sees it: what each stage receives and
 * what it may decide. Relay hooks are written with {@link defineRelayHooks}
 * and run in Lamaste's sandboxed hook runner; agent hooks are answered by the
 * agent half at `POST /admin/hooks/<stage>` (helpers in
 * `@lamalibre/lamaste/agent`).
 *
 * Everything a hook does outside its return value goes through an
 * {@link HookEffect}, which Lamaste performs; a hook never sees the
 * installation secret, a caller's credentials or the network.
 */

import type { HookStage } from './constants.js';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * Who the panel admitted for a forwarded request: an admin or an agent on
 * `/admin/*`, a user on the user surface (`/app/*`) — named by the
 * directory's stable id and the user's roles in this plugin, never by
 * username or any other attribute.
 */
export type HookCaller =
  | { readonly type: 'admin' }
  | { readonly type: 'agent'; readonly label: string }
  | { readonly type: 'user'; readonly userId: string; readonly roles: readonly string[] };

/** A request or response body a hook asked to see (`body.maxBytes`). */
export interface HookBody {
  readonly contentType: string | null;
  readonly bytes: Uint8Array;
  /** The body as UTF-8 text (invalid sequences replaced). */
  text(): string;
  /** `JSON.parse(text())`; throws on invalid JSON. */
  json(): unknown;
}

export interface HookContext {
  readonly plugin: string;
  readonly stage: HookStage;
  /** When Lamaste stops waiting for the decision (milliseconds since the epoch). */
  readonly deadline: number;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export type HookEffectData = Readonly<Record<string, string | number | boolean | null>>;

/** Something Lamaste does on a hook's behalf, rate-limited. A plugin declares which types it uses. */
export type HookEffect =
  | {
      readonly type: 'audit';
      /** Lower case, dots and hyphens: `secret-redacted`, `import.rejected`. */
      readonly event: string;
      /** Metadata only — never a body, a secret or personal data. */
      readonly data?: HookEffectData;
    }
  | {
      readonly type: 'notify-admins';
      readonly message: string;
      readonly level?: 'info' | 'warning' | 'critical';
    }
  | {
      readonly type: 'log';
      readonly message: string;
      readonly level?: 'info' | 'warn';
      readonly data?: HookEffectData;
    };

interface WithEffects {
  readonly effects?: readonly HookEffect[];
}

// ---------------------------------------------------------------------------
// Install / uninstall
// ---------------------------------------------------------------------------

/** `install` and `upgrade` run the install pipeline; `uninstall` and `rollback` the uninstall pipeline. */
export type LifecyclePhase = 'install' | 'upgrade' | 'uninstall' | 'rollback';

export interface HostingAgentInfo {
  readonly label: string;
}

export interface LifecycleHookInput {
  readonly plugin: string;
  /** The plugin version the pipeline installs (or, for uninstall, the installed one). */
  readonly version: string;
  /** For an upgrade: the version being replaced. */
  readonly previousVersion?: string;
  readonly phase: LifecyclePhase;
  readonly agent: HostingAgentInfo;
  /**
   * The plugin's settings without its secrets. A relay hook receives the
   * effective non-secret values — each field's stored value or its default
   * (`SettingsValues` in the root, spelled out here because this subpath
   * imports nothing from outside it); an agent hook receives `{}`, since
   * the agent half holds the settings itself. Never a secret.
   */
  readonly settings: { readonly [key: string]: string | number | boolean };
  /** Outputs of the stages that ran before this one, keyed `relay:install:pre-tunnel`, `agent:install:pre-tunnel`, … */
  readonly outputs: { readonly [stage: string]: JsonValue };
  /** The relay-loopback port of the internal tunnel, once it is assigned. */
  readonly port?: number;
}

export type LifecycleHookDecision =
  | ({ readonly ok: true; readonly output?: JsonValue } & WithEffects)
  | ({ readonly ok: false; readonly reason: string } & WithEffects);

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface HookRequestInfo {
  readonly method: string;
  /** The path on the agent half, without the query string (`/admin/import/x`). */
  readonly path: string;
  /** The query string without `?` (empty when none). */
  readonly query: string;
  readonly caller: HookCaller;
}

export interface RequestHookInput extends HookRequestInfo {
  /** Request headers, lower case. `Authorization`, `Cookie` and Lamaste's own headers are removed. */
  readonly headers: Readonly<Record<string, string>>;
  /** The route pattern of the declaration that matched. */
  readonly route: string;
  /** Present when the declaration asked for the body. */
  readonly body?: HookBody;
}

export type PreForwardDecision =
  | ({
      readonly action: 'continue';
      /** Headers to add or replace on the forwarded request (not Lamaste's, credentials or hop-by-hop). */
      readonly setHeaders?: Readonly<Record<string, string>>;
      readonly removeHeaders?: readonly string[];
    } & WithEffects)
  | ({
      readonly action: 'reject';
      /** 400–499. */
      readonly status: number;
      readonly body?: JsonValue;
    } & WithEffects);

export interface ResponseHookInput {
  readonly status: number;
  /** Response headers, lower case. `Set-Cookie` is removed. */
  readonly headers: Readonly<Record<string, string>>;
  readonly request: HookRequestInfo;
  readonly route: string;
  readonly body?: HookBody;
}

export type PostForwardDecision =
  | ({ readonly action: 'pass' } & WithEffects)
  | ({
      readonly action: 'replace';
      readonly body: string | Uint8Array;
      /** Defaults to the response's own content type. */
      readonly contentType?: string;
      readonly setHeaders?: Readonly<Record<string, string>>;
    } & WithEffects)
  | ({
      readonly action: 'block';
      /** 500–599, default 502. */
      readonly status?: number;
      /** What the client is told (`{ error, reasonId }`); lower case, dots and hyphens. */
      readonly reasonId: string;
    } & WithEffects);

// ---------------------------------------------------------------------------
// Tunnel state
// ---------------------------------------------------------------------------

export interface TunnelHookInput {
  readonly state: 'down' | 'up';
  /** `tunnel`: the agent is not connected; `app`: the tunnel is up and the agent half does not answer. */
  readonly reason?: 'tunnel' | 'app';
  /** When the state changed (ISO 8601). */
  readonly since: string;
  readonly lastError?: string;
}

/** What the forwarder answers while the plugin is down, instead of a bare 502. */
export interface TunnelFallback {
  /** 400–599. */
  readonly status: number;
  /** Seconds, sent as `Retry-After`. */
  readonly retryAfter?: number;
  /** Default `application/json`. */
  readonly contentType?: string;
  readonly body?: JsonValue;
}

export type TunnelDownDecision = { readonly fallback?: TunnelFallback } & WithEffects;
export type TunnelUpDecision = WithEffects;

// ---------------------------------------------------------------------------
// The relay hook module
// ---------------------------------------------------------------------------

type MaybePromise<T> = T | Promise<T>;

/** A relay hook module's default export: one function per stage it declares. */
export interface RelayHooks {
  'install:pre-tunnel'?: (
    i: LifecycleHookInput,
    c: HookContext,
  ) => MaybePromise<LifecycleHookDecision>;
  'install:post-tunnel'?: (
    i: LifecycleHookInput,
    c: HookContext,
  ) => MaybePromise<LifecycleHookDecision>;
  'uninstall:pre-teardown'?: (
    i: LifecycleHookInput,
    c: HookContext,
  ) => MaybePromise<LifecycleHookDecision>;
  'uninstall:post-teardown'?: (
    i: LifecycleHookInput,
    c: HookContext,
  ) => MaybePromise<LifecycleHookDecision>;
  'request:pre-forward'?: (i: RequestHookInput, c: HookContext) => MaybePromise<PreForwardDecision>;
  'request:post-forward'?: (
    i: ResponseHookInput,
    c: HookContext,
  ) => MaybePromise<PostForwardDecision>;
  'tunnel:down'?: (i: TunnelHookInput, c: HookContext) => MaybePromise<TunnelDownDecision>;
  'tunnel:up'?: (i: TunnelHookInput, c: HookContext) => MaybePromise<TunnelUpDecision>;
}

/**
 * Declare a relay hook module (`export default defineRelayHooks({ … })`).
 * It only checks the shape at compile time; bundle the module into one
 * self-contained file — the runner may read nothing else.
 */
export function defineRelayHooks<T extends RelayHooks>(hooks: T): T {
  return hooks;
}

// ---------------------------------------------------------------------------
// Agent hooks (answered by the agent half)
// ---------------------------------------------------------------------------

/** The body of `POST /admin/hooks/<stage>` on the agent half. */
export type AgentHookCall =
  | {
      readonly stage: 'install:pre-tunnel' | 'install:post-tunnel';
      readonly input: LifecycleHookInput;
    }
  | {
      readonly stage: 'uninstall:pre-teardown' | 'uninstall:post-teardown';
      readonly input: LifecycleHookInput;
    }
  | { readonly stage: 'tunnel:down' | 'tunnel:up'; readonly input: TunnelHookInput };

/** What the agent half answers; tunnel stages answer `{ ok: true }`. */
export type AgentHookDecision =
  | { readonly ok: true; readonly output?: JsonValue }
  | { readonly ok: false; readonly reason: string };

/**
 * An agent half's hooks: one function per stage it declares under
 * `hooks.agent`. Tunnel stages may return nothing (`{ ok: true }`).
 * Served at `POST /admin/hooks/<stage>` with `createAgentHookHandler` from
 * `@lamalibre/lamaste/agent`, which verifies that Lamaste made the call
 * with exactly the body received and authenticates the answer
 * (`X-Lamalibre-Responder`) — an answer without that is not believed.
 */
export interface AgentHooks {
  'install:pre-tunnel'?: (i: LifecycleHookInput) => MaybePromise<AgentHookDecision>;
  'install:post-tunnel'?: (i: LifecycleHookInput) => MaybePromise<AgentHookDecision>;
  'uninstall:pre-teardown'?: (i: LifecycleHookInput) => MaybePromise<AgentHookDecision>;
  'uninstall:post-teardown'?: (i: LifecycleHookInput) => MaybePromise<AgentHookDecision>;
  'tunnel:down'?: (i: TunnelHookInput) => MaybePromise<AgentHookDecision | void>;
  'tunnel:up'?: (i: TunnelHookInput) => MaybePromise<AgentHookDecision | void>;
}

/** Declare an agent half's hooks (types only). */
export function defineAgentHooks<T extends AgentHooks>(hooks: T): T {
  return hooks;
}
