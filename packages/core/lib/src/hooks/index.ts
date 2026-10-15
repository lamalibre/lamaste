/**
 * `@lamalibre/lamaste/hooks` — the lifecycle hook contract of agent-hosted
 * plugins: stage names, limits, the types a hook receives and returns,
 * `defineRelayHooks`, route patterns, and the runner protocol Lamaste speaks.
 *
 * Self-contained (Node built-ins only): a plugin's relay hook module bundles
 * what it uses from here, and Lamaste's hook runner loads this directory
 * inside its sandbox. See `plugin-development/design/agent-hosted-app-plugins.md`.
 */

export * from './constants.js';
export * from './types.js';
export {
  AGENT_HOOK_DECISION_MAX_BYTES,
  parseAgentHookCall,
  parseAgentHookDecision,
} from './agent-hooks.js';
export {
  ROUTE_PATTERN_METHODS,
  matchRoutePattern,
  parseRoutePattern,
  requestPathSegments,
  routePattern,
} from './routes.js';
export type { RoutePattern, RoutePatternSurface } from './routes.js';
export {
  DEFAULT_FRAME_LIMITS,
  FrameError,
  FrameReader,
  encodeFrame,
  readFrame,
} from './protocol.js';
export type {
  Frame,
  FrameLimits,
  HookCallRequest,
  HookCallResponse,
  HookCallTarget,
} from './protocol.js';
export {
  findSecrets,
  redactSecrets,
  secretScanHook,
  unscannableReason,
} from './shared/secret-scan.js';
export type { SecretMatch } from './shared/secret-scan.js';
export { SECRET_SCAN_RULES } from './shared/packs.js';
export type { SecretScanRule } from './shared/packs.js';
