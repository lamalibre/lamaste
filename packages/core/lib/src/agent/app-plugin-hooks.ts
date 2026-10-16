/**
 * Lifecycle hooks on the agent — the agent's side of the hook pipelines of
 * the agent-hosted plugins it hosts. Every agent hook is an HTTP call to the
 * running agent half (`POST /admin/hooks/<stage>`, caller `lamaste`):
 *
 * - **Agent jobs.** For the stages that run while there is no tunnel (the
 *   agent's `install:pre-tunnel` before the tunnel is granted, its
 *   `uninstall:post-teardown` after it is removed), the relay lists a job in
 *   `agent-config`; the sync timer calls the agent half on this machine's
 *   loopback, signing with the installation secret it holds, and reports
 *   the result. A job whose agent half does not answer yet (connection
 *   refused) waits for the next sync, until the relay's deadline. The same
 *   channel carries the app jobs (`app-install`, `app-activate`,
 *   `app-remove`) that put the agent half itself in place; their handlers
 *   are the caller's ({@link AgentAppJobHandlers}). The relay signs every
 *   app job (`app-job-signature.ts`) and the agent's root helper runs only
 *   what it signed: an app job that comes without a signature matching it
 *   is reported failed, never handed to a handler. A result is kept until
 *   the relay took it (`app-job-results.json`), because the helper runs a
 *   signed job only once — a result that could not be reported is reported
 *   again, the job not run again.
 * - **Tunnel state.** The agent cannot see its own chisel session; the relay
 *   can. `agent-config` carries the relay's view of each hosting's health,
 *   and the sync calls the agent half's `tunnel:down` / `tunnel:up` when that
 *   view changes — or `tunnel:down` (reason `tunnel`) when the panel itself
 *   has been unreachable for {@link PANEL_LOSS_DOWN_AFTER_MS}.
 *
 * Runs in the sync command after converge and outside the agent lock: a
 * hook may take minutes and must not hold up a start or a stop.
 *
 * {@link createAgentHookHandler} is the agent half's side: it answers
 * `POST /admin/hooks/<stage>` for whatever framework the agent half uses,
 * checking that the call's assertion signs the body it came with and
 * authenticating its answer (`admin-handlers.ts`). An answer the agent
 * half does not authenticate is a failed call (`unauthenticated`), here on
 * the agent's loopback as on the relay.
 */

import path from 'node:path';

import {
  APPHOST_ROUTE_RE,
  AgentHalfPackageNameSchema,
  AgentHalfSpecSchema,
  AgentHalfVersionSchema,
} from '../agent-half.js';
import type { AgentHalfSpec } from '../agent-half.js';
import { callAgentHalfHook } from '../agent-hook-call.js';
import type { AgentHookCallResult } from '../agent-hook-call.js';
import { AGENT_APP_JOB_TIMEOUTS, AgentAppJobResultSchema, agentJobError } from '../agent-jobs.js';
import type { AgentAppJobResult, AgentJobResult } from '../agent-jobs.js';
import { appJobEnvelopeMatches, decodeAppJobSignature } from '../app-job-signature.js';
import type { AppJobKind, AppJobSignature } from '../app-job-signature.js';
import { atomicWriteJSON, readJSONFile } from '../file-helpers.js';
import {
  AGENT_HALF_HOOKS_PREFIX,
  HOOK_TIMEOUTS,
  isAgentHookStage,
  parseAgentHookCall,
  parseAgentHookDecision,
} from '../hooks/index.js';
import type {
  AgentHookDecision,
  AgentHookStage,
  AgentHooks,
  TunnelHookInput,
} from '../hooks/index.js';
import { BODY_NOT_AS_RECEIVED, adminAnswer, rawBodyOf } from './admin-handlers.js';
import type { AgentHookRequest, AgentHookResponse } from './admin-handlers.js';
import { loadAppPluginConfig } from './app-plugins.js';
import type { CallerAssertionVerifier } from './app-plugins.js';
import { agentDataDir } from './platform.js';

const ROUTE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The panel unreachable this long counts as the tunnel down (three sync intervals). */
export const PANEL_LOSS_DOWN_AFTER_MS = 90_000;

// ---------------------------------------------------------------------------
// Agent jobs
// ---------------------------------------------------------------------------

interface AgentJobBase {
  readonly id: string;
  readonly route: string;
  readonly timeoutMs: number;
  readonly deadlineAt: string;
}

/** Call a hook stage of the agent half on this machine's loopback. */
export interface AgentHookJob extends AgentJobBase {
  readonly kind: 'hook';
  readonly stage: AgentHookStage;
  readonly input: Readonly<Record<string, unknown>>;
}

/**
 * An app job, with the relay's signature over it — what the app host helper
 * verifies before it acts; it has been checked to describe this very job.
 */
interface AgentAppJobBase extends AgentJobBase {
  readonly signature: AppJobSignature;
}

/** Install the agent half pinned by `spec` (and make it current). */
export interface AgentAppInstallJob extends AgentAppJobBase {
  readonly kind: 'app-install';
  readonly spec: AgentHalfSpec;
}

/** Point the agent half (of `package`) at an installed version and restart it. */
export interface AgentAppActivateJob extends AgentAppJobBase {
  readonly kind: 'app-activate';
  readonly version: string;
  readonly package: string;
}

/** Remove the agent half (of `package`); `purge` also deletes its data and account. */
export interface AgentAppRemoveJob extends AgentAppJobBase {
  readonly kind: 'app-remove';
  readonly purge: boolean;
  readonly package: string;
}

export type AgentAppJob = AgentAppInstallJob | AgentAppActivateJob | AgentAppRemoveJob;

/**
 * An app job that came without a signature matching it: never run, its
 * failure reported (`reason`) so the relay does not wait for its deadline.
 */
export interface AgentRefusedAppJob extends AgentJobBase {
  readonly kind: 'refused';
  readonly jobKind: AppJobKind;
  readonly reason: string;
}

export type AgentJob = AgentHookJob | AgentAppJob | AgentRefusedAppJob;

export type { AgentJobResult };

export interface AgentJobReporter {
  reportJobResult(id: string, result: AgentJobResult): Promise<void>;
}

/** An app job that cannot run yet and stays pending for the next sync (until its deadline). */
export interface AgentJobDeferral {
  readonly deferred: true;
  /** Why, for the sync's warnings. */
  readonly reason: string;
}

/** What an app job handler answers: the result to report, or a deferral. */
export type AgentAppJobOutcome = AgentAppJobResult | AgentJobDeferral;

/**
 * Runs the app jobs (the agent CLI's, through the app host helper). A
 * handler answers `{ ok: false, error }` for a failure it can explain (one
 * line, no secret); one that throws is reported as an unexpected failure,
 * its message going to the sync's warnings only.
 */
export interface AgentAppJobHandlers {
  install(job: AgentAppInstallJob): Promise<AgentAppJobOutcome>;
  activate(job: AgentAppActivateJob): Promise<AgentAppJobOutcome>;
  remove(job: AgentAppRemoveJob): Promise<AgentAppJobOutcome>;
}

export interface AgentJobRunOptions {
  /** Without handlers, app jobs stay pending (with a warning) until the relay's deadline. */
  readonly appJobs?: AgentAppJobHandlers | undefined;
}

export interface AgentJobRunResult {
  /** Jobs run and reported. */
  readonly ran: readonly string[];
  /**
   * Jobs left for the next sync (no config yet, the agent half does not
   * answer yet, no handler for an app job, or its handler deferred it).
   */
  readonly deferred: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** `ms` within 1 and `max`: a timeout the relay named, capped by Lamaste. */
function clampTimeout(ms: number, max: number): number {
  return Math.min(Math.max(1, ms), max);
}

/** An app job's common fields: the route as the app host helper accepts it, finite numbers. */
function appJobBase(e: Record<string, unknown>, maxTimeoutMs: number): AgentJobBase | null {
  const { id, route, timeoutMs, deadlineAt } = e;
  if (
    typeof id !== 'string' ||
    !UUID_RE.test(id) ||
    typeof route !== 'string' ||
    !APPHOST_ROUTE_RE.test(route) ||
    typeof timeoutMs !== 'number' ||
    !Number.isFinite(timeoutMs) ||
    typeof deadlineAt !== 'string' ||
    !Number.isFinite(Date.parse(deadlineAt))
  ) {
    return null;
  }
  return { id, route, timeoutMs: clampTimeout(timeoutMs, maxTimeoutMs), deadlineAt };
}

function parseAgentJob(entry: unknown): AgentJob | null {
  if (!isRecord(entry)) return null;
  const e = entry;
  switch (e['kind']) {
    case 'hook':
      if (
        typeof e['id'] !== 'string' ||
        !UUID_RE.test(e['id']) ||
        typeof e['route'] !== 'string' ||
        !ROUTE_RE.test(e['route']) ||
        !isAgentHookStage(e['stage']) ||
        !e['input'] ||
        typeof e['input'] !== 'object' ||
        typeof e['timeoutMs'] !== 'number' ||
        typeof e['deadlineAt'] !== 'string'
      ) {
        return null;
      }
      return {
        id: e['id'],
        route: e['route'],
        kind: 'hook',
        stage: e['stage'],
        input: e['input'] as Record<string, unknown>,
        timeoutMs: clampTimeout(e['timeoutMs'], HOOK_TIMEOUTS.agent.max),
        deadlineAt: e['deadlineAt'],
      };
    case 'app-install': {
      const base = appJobBase(e, AGENT_APP_JOB_TIMEOUTS.install);
      const spec = AgentHalfSpecSchema.safeParse(e['spec']);
      if (!base || !spec.success) return null;
      const payload = { spec: spec.data };
      return signedAppJob(base, 'app-install', payload, e['signature'], (signature) => ({
        ...base,
        kind: 'app-install',
        ...payload,
        signature,
      }));
    }
    case 'app-activate': {
      const base = appJobBase(e, AGENT_APP_JOB_TIMEOUTS.activate);
      const version = AgentHalfVersionSchema.safeParse(e['version']);
      const pkg = AgentHalfPackageNameSchema.safeParse(e['package']);
      if (!base || !version.success || !pkg.success) return null;
      const payload = { version: version.data, package: pkg.data };
      return signedAppJob(base, 'app-activate', payload, e['signature'], (signature) => ({
        ...base,
        kind: 'app-activate',
        ...payload,
        signature,
      }));
    }
    case 'app-remove': {
      const base = appJobBase(e, AGENT_APP_JOB_TIMEOUTS.remove);
      const pkg = AgentHalfPackageNameSchema.safeParse(e['package']);
      if (!base || typeof e['purge'] !== 'boolean' || !pkg.success) return null;
      const payload = { purge: e['purge'], package: pkg.data };
      return signedAppJob(base, 'app-remove', payload, e['signature'], (signature) => ({
        ...base,
        kind: 'app-remove',
        ...payload,
        signature,
      }));
    }
    default:
      return null;
  }
}

/**
 * An app job whose own fields are valid, with its signature: the job when
 * the signature is well formed and describes exactly it (id, route, kind,
 * deadline, payload), a refused job otherwise. Whether the relay made the
 * signature is for the app host helper to verify, with the key pinned for
 * this agent; this keeps a job and a signature that disagree from getting
 * that far.
 */
function signedAppJob(
  base: AgentJobBase,
  kind: AppJobKind,
  payload: unknown,
  rawSignature: unknown,
  job: (signature: AppJobSignature) => AgentAppJob,
): AgentAppJob | AgentRefusedAppJob {
  const refused = (reason: string): AgentRefusedAppJob => ({
    ...base,
    kind: 'refused',
    jobKind: kind,
    reason,
  });
  if (rawSignature === undefined) {
    return refused(
      `The panel did not sign this ${kind} job, and the agent's app host helper runs only jobs ` +
        'its relay signed (update the relay)',
    );
  }
  const decoded = decodeAppJobSignature(rawSignature);
  if (!decoded) return refused(`The signature of this ${kind} job is malformed; it was not run`);
  if (
    !appJobEnvelopeMatches(decoded.envelope, {
      jobId: base.id,
      route: base.route,
      kind,
      payload,
      expiresAt: base.deadlineAt,
    })
  ) {
    return refused(`This ${kind} job does not match the relay's signature on it; it was not run`);
  }
  const { envelope, sig } = rawSignature as AppJobSignature;
  return job({ envelope, sig });
}

/** Validate the relay's `agentJobs`; anything malformed is ignored with a warning. */
export function parseAgentJobs(raw: unknown, warnings: string[]): AgentJob[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push('The panel reported agentJobs in an unexpected shape; ignoring it.');
    return [];
  }
  const out: AgentJob[] = [];
  for (const entry of raw) {
    const job = parseAgentJob(entry);
    if (!job) {
      warnings.push('The panel reported a malformed agent job; ignoring it.');
      continue;
    }
    out.push(job);
  }
  return out;
}

/**
 * Call a hook stage of the agent half of `route` on this machine's loopback,
 * with the plugin config delivered for it; null while that config is not
 * here yet.
 */
async function callLocalAgentHalf(
  label: string,
  route: string,
  stage: AgentHookStage,
  input: Readonly<Record<string, unknown>>,
  timeoutMs: number,
): Promise<AgentHookCallResult | null> {
  const config = await loadAppPluginConfig(label, route);
  if (!config) return null;
  return callAgentHalfHook({
    plugin: route,
    port: config.port,
    secret: config.secret,
    stage,
    input,
    timeoutMs,
  });
}

/** A hook job's result, or null when it waits for the next sync. */
async function runHookJob(label: string, job: AgentHookJob): Promise<AgentJobResult | null> {
  const result = await callLocalAgentHalf(label, job.route, job.stage, job.input, job.timeoutMs);
  if (!result) return null;
  // Refused: the agent half is not listening yet (it starts once its config
  // is here); the next sync tries again.
  if (!result.ok && result.code === 'refused') return null;
  return result.ok
    ? { ok: true, decision: result.decision }
    : { ok: false, error: agentJobError(result.error) };
}

function runAppHandler(
  job: AgentAppJob,
  handlers: AgentAppJobHandlers,
): Promise<AgentAppJobOutcome> {
  switch (job.kind) {
    case 'app-install':
      return handlers.install(job);
    case 'app-activate':
      return handlers.activate(job);
    case 'app-remove':
      return handlers.remove(job);
  }
}

/** An app job's result, or null when it waits for the next sync. */
async function runAppJob(
  job: AgentAppJob,
  handlers: AgentAppJobHandlers | undefined,
  warnings: string[],
): Promise<AgentAppJobResult | null> {
  if (!handlers) {
    warnings.push(
      `The panel asked this agent to run ${job.kind} for "${job.route}", which this sync ` +
        `cannot do; the job stays pending until the panel's deadline.`,
    );
    return null;
  }
  // Checked as unknown: the handlers are the agent CLI's JavaScript.
  let outcome: unknown;
  try {
    outcome = await runAppHandler(job, handlers);
  } catch (err: unknown) {
    warnings.push(
      `The ${job.kind} job of "${job.route}" failed: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      ok: false,
      error: `The ${job.kind} job failed unexpectedly on the agent (see its sync log)`,
    };
  }
  if (isRecord(outcome) && outcome['deferred'] === true) {
    warnings.push(
      `The ${job.kind} job of "${job.route}" waits for the next sync: ${String(outcome['reason'])}`,
    );
    return null;
  }
  const valid = AgentAppJobResultSchema.safeParse(outcome);
  if (!valid.success) {
    warnings.push(`The ${job.kind} job of "${job.route}" produced a malformed result.`);
    return { ok: false, error: `The ${job.kind} job produced a malformed result on the agent` };
  }
  return valid.data;
}

// ---------------------------------------------------------------------------
// App job results the relay has not taken yet
// ---------------------------------------------------------------------------

/** jobId → a result the relay has not taken yet, kept until the job's deadline. */
type AppJobResults = Record<
  string,
  { readonly result: AgentAppJobResult; readonly deadlineAt: string }
>;

function appJobResultsPath(label: string): string {
  return path.join(agentDataDir(label), 'app-job-results.json');
}

async function readAppJobResults(label: string): Promise<AppJobResults> {
  const raw = await readJSONFile<unknown>(appJobResultsPath(label), {}).catch(() => ({}));
  const out: AppJobResults = {};
  if (!isRecord(raw)) return out;
  for (const [id, entry] of Object.entries(raw)) {
    if (!UUID_RE.test(id) || !isRecord(entry) || typeof entry['deadlineAt'] !== 'string') continue;
    const result = AgentAppJobResultSchema.safeParse(entry['result']);
    if (result.success) out[id] = { result: result.data, deadlineAt: entry['deadlineAt'] };
  }
  return out;
}

/**
 * Run the jobs the relay listed, one after another, and report each. Hook
 * jobs are run here; app jobs by `options.appJobs`, and without handlers
 * they stay pending; a refused app job (no signature matching it) is
 * reported failed. An app job's result is kept (`app-job-results.json`,
 * 0600) until the relay took it: a report that failed is made again on the
 * next sync without running the job again — the app host helper runs a
 * signed job once.
 */
export async function runAgentJobs(
  label: string,
  jobs: readonly AgentJob[],
  reporter: AgentJobReporter,
  warnings: string[],
  options: AgentJobRunOptions = {},
): Promise<AgentJobRunResult> {
  const ran: string[] = [];
  const deferred: string[] = [];
  const stored = await readAppJobResults(label);
  // Results of jobs past their deadline are of no use to the relay any more.
  const unreported: AppJobResults = Object.fromEntries(
    Object.entries(stored).filter(([, entry]) => Date.parse(entry.deadlineAt) > Date.now()),
  );
  let dirty = Object.keys(unreported).length !== Object.keys(stored).length;
  const persist = async (): Promise<void> => {
    if (!dirty) return;
    try {
      await atomicWriteJSON(appJobResultsPath(label), unreported, { mode: 0o600, mkdirp: true });
      dirty = false;
    } catch (err: unknown) {
      warnings.push(
        `The results of app jobs could not be kept (${err instanceof Error ? err.message : String(err)}).`,
      );
    }
  };

  for (const job of jobs) {
    if (Date.parse(job.deadlineAt) <= Date.now()) continue; // the relay expires it
    let result: AgentJobResult | null;
    if (job.kind === 'hook') {
      result = await runHookJob(label, job);
    } else if (job.kind === 'refused') {
      warnings.push(`The ${job.jobKind} job of "${job.route}" was refused: ${job.reason}`);
      result = { ok: false, error: agentJobError(job.reason) };
    } else {
      const kept = unreported[job.id];
      if (kept) {
        result = kept.result;
      } else {
        const outcome = await runAppJob(job, options.appJobs, warnings);
        result = outcome;
        if (outcome !== null) {
          // Kept before it is reported: the helper will not run this job again.
          unreported[job.id] = { result: outcome, deadlineAt: job.deadlineAt };
          dirty = true;
          await persist();
        }
      }
    }
    if (result === null) {
      deferred.push(job.id);
      continue;
    }
    try {
      await reporter.reportJobResult(job.id, result);
      ran.push(job.id);
      if (unreported[job.id]) {
        delete unreported[job.id];
        dirty = true;
      }
    } catch (err: unknown) {
      const what =
        job.kind === 'hook'
          ? `the ${job.stage} hook`
          : `the ${job.kind === 'refused' ? job.jobKind : job.kind} job`;
      warnings.push(
        `The result of ${what} of "${job.route}" could not be reported ` +
          `(${err instanceof Error ? err.message : String(err)}).`,
      );
    }
  }
  await persist();
  return { ran, deferred };
}

// ---------------------------------------------------------------------------
// Tunnel state
// ---------------------------------------------------------------------------

export interface AgentTunnelHookDecl {
  readonly stage: 'tunnel:down' | 'tunnel:up';
  readonly timeoutMs: number;
}

/** What the sync needs of one `appPlugins` entry for the tunnel hooks. */
export interface TunnelHookAssignment {
  readonly route: string;
  readonly phase: 'installing' | 'active' | 'removing';
  readonly health: {
    readonly state: 'unknown' | 'up' | 'down';
    readonly reason?: 'tunnel' | 'app' | undefined;
    readonly since: string;
  };
  readonly agentHooks: readonly AgentTunnelHookDecl[];
}

/** Validate the tunnel-hook fields of `appPlugins` (relay 4.3+). */
export function parseTunnelHookAssignments(raw: unknown): TunnelHookAssignment[] {
  if (!Array.isArray(raw)) return [];
  const out: TunnelHookAssignment[] = [];
  for (const entry of raw) {
    const e = entry as Record<string, unknown>;
    const health = e?.['health'] as Record<string, unknown> | undefined;
    const hooks = e?.['agentHooks'];
    if (
      !e ||
      typeof e['route'] !== 'string' ||
      !ROUTE_RE.test(e['route']) ||
      !health ||
      !['unknown', 'up', 'down'].includes(health['state'] as string) ||
      typeof health['since'] !== 'string' ||
      !Array.isArray(hooks)
    ) {
      continue;
    }
    const agentHooks = hooks
      .filter(
        (h): h is AgentTunnelHookDecl =>
          !!h &&
          (h.stage === 'tunnel:down' || h.stage === 'tunnel:up') &&
          typeof h.timeoutMs === 'number',
      )
      .map((h) => ({
        stage: h.stage,
        timeoutMs: clampTimeout(h.timeoutMs, HOOK_TIMEOUTS.agent.max),
      }));
    const phase = e['phase'];
    out.push({
      route: e['route'],
      phase: phase === 'installing' || phase === 'removing' ? phase : 'active',
      health: {
        state: health['state'] as 'unknown' | 'up' | 'down',
        ...(health['reason'] === 'tunnel' || health['reason'] === 'app'
          ? { reason: health['reason'] }
          : {}),
        since: health['since'],
      },
      agentHooks,
    });
  }
  return out;
}

interface TunnelHookRecord {
  /** The last state delivered to the agent half. */
  readonly delivered: 'up' | 'down';
  readonly reason?: 'tunnel' | 'app' | undefined;
  readonly since: string;
  /** Kept so the hooks can be called while the panel is unreachable. */
  readonly hooks: readonly AgentTunnelHookDecl[];
}

type TunnelHookState = Record<string, TunnelHookRecord>;

function tunnelHookStatePath(label: string): string {
  return path.join(agentDataDir(label), 'app-plugin-tunnel-state.json');
}

async function readTunnelHookState(label: string): Promise<TunnelHookState> {
  const raw = await readJSONFile<unknown>(tunnelHookStatePath(label), {});
  return isRecord(raw) ? (raw as TunnelHookState) : {};
}

async function writeTunnelHookState(label: string, state: TunnelHookState): Promise<void> {
  await atomicWriteJSON(tunnelHookStatePath(label), state, { mode: 0o600 });
}

/** Call one tunnel hook on the agent half; true when it was delivered. */
async function deliverTunnelHook(
  label: string,
  route: string,
  decl: AgentTunnelHookDecl,
  input: TunnelHookInput,
  warnings: string[],
): Promise<boolean> {
  const result = await callLocalAgentHalf(
    label,
    route,
    decl.stage,
    input as unknown as Record<string, unknown>,
    decl.timeoutMs,
  );
  if (!result) return false;
  if (!result.ok) {
    warnings.push(
      `The ${decl.stage} hook of "${route}" did not answer (${result.error}); retrying.`,
    );
    return false;
  }
  if (!result.decision.ok) {
    warnings.push(`The ${decl.stage} hook of "${route}" reported: ${result.decision.reason}`);
  }
  return true;
}

/**
 * After a successful sync: deliver `tunnel:down` / `tunnel:up` to each
 * active hosting whose relay-side health changed since it was last
 * delivered. Returns the routes delivered to.
 */
export async function syncAgentTunnelHooks(
  label: string,
  assignments: readonly TunnelHookAssignment[],
  warnings: string[],
): Promise<string[]> {
  const state = await readTunnelHookState(label);
  const next: TunnelHookState = {};
  const delivered: string[] = [];
  for (const a of assignments) {
    const before = state[a.route];
    let record: TunnelHookRecord | undefined = before
      ? { ...before, hooks: a.agentHooks }
      : undefined;
    if (a.phase === 'active' && a.health.state !== 'unknown') {
      const wanted = a.health.state;
      const changed =
        record === undefined
          ? wanted === 'down'
          : record.delivered !== wanted || (wanted === 'down' && record.reason !== a.health.reason);
      if (changed) {
        const decl = a.agentHooks.find((h) => h.stage === `tunnel:${wanted}`);
        const ok = decl
          ? await deliverTunnelHook(
              label,
              a.route,
              decl,
              {
                state: wanted,
                ...(a.health.reason ? { reason: a.health.reason } : {}),
                since: a.health.since,
              },
              warnings,
            )
          : true;
        if (ok) {
          if (decl) delivered.push(a.route);
          record = {
            delivered: wanted,
            ...(a.health.reason && wanted === 'down' ? { reason: a.health.reason } : {}),
            since: a.health.since,
            hooks: a.agentHooks,
          };
        }
      }
    }
    if (record) next[a.route] = record;
    else if (a.agentHooks.length > 0) {
      next[a.route] = { delivered: 'up', since: a.health.since, hooks: a.agentHooks };
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(state)) await writeTunnelHookState(label, next);
  return delivered;
}

/**
 * After a failed sync: when the panel has been unreachable since `lastOkAt`
 * for at least {@link PANEL_LOSS_DOWN_AFTER_MS}, the tunnel is as good as
 * down — deliver `tunnel:down` (reason `tunnel`) to each hosting not already
 * told. The next successful sync reconciles with the relay's view.
 */
export async function agentTunnelHooksOnPanelLoss(
  label: string,
  lastOkAt: string | null,
  warnings: string[],
): Promise<string[]> {
  if (lastOkAt === null) return [];
  const lostSince = Date.parse(lastOkAt);
  if (!Number.isFinite(lostSince) || Date.now() - lostSince < PANEL_LOSS_DOWN_AFTER_MS) return [];
  const state = await readTunnelHookState(label);
  const since = new Date(lostSince).toISOString();
  const delivered: string[] = [];
  let changed = false;
  for (const [route, record] of Object.entries(state)) {
    if (record.delivered === 'down') continue;
    const decl = record.hooks.find((h) => h.stage === 'tunnel:down');
    const ok = decl
      ? await deliverTunnelHook(
          label,
          route,
          decl,
          { state: 'down', reason: 'tunnel', since },
          warnings,
        )
      : true;
    if (ok) {
      if (decl) delivered.push(route);
      state[route] = { ...record, delivered: 'down', reason: 'tunnel', since };
      changed = true;
    }
  }
  if (changed) await writeTunnelHookState(label, state);
  return delivered;
}

// ---------------------------------------------------------------------------
// The agent half's side
// ---------------------------------------------------------------------------

export interface AgentHookHandlerOptions {
  /** The agent half's verifier ({@link createCallerAssertionVerifier}). */
  readonly verifier: CallerAssertionVerifier;
  readonly hooks: AgentHooks;
}

/**
 * Answer `POST /admin/hooks/<stage>` in an agent half: the call must carry a
 * valid caller assertion naming Lamaste (no admin or forwarded caller may
 * run a hook) that signs exactly the body received — so the body must be
 * passed as received (a parsed object is refused with 400) — the stage must
 * be one the agent half implements, and its answer is checked before it is
 * sent. A hook that throws answers `{ ok: false, reason }` — the stage
 * fails, as the pipeline expects. Every answer to a verified call carries
 * the responder header over its exact body. Framework-agnostic: pass the
 * request, send `status`, `headers` and `bodyText`.
 */
export function createAgentHookHandler(opts: AgentHookHandlerOptions): {
  handle(request: AgentHookRequest): Promise<AgentHookResponse>;
} {
  return {
    async handle(request) {
      const pathOnly = request.url.split('?')[0] ?? '';
      const prefix = `${AGENT_HALF_HOOKS_PREFIX}/`;
      if (!pathOnly.startsWith(prefix)) return adminAnswer(404, { error: 'Not found' });
      const stage = pathOnly.slice(prefix.length);
      if (!isAgentHookStage(stage)) return adminAnswer(404, { error: 'Unknown hook stage' });
      if (request.method.toUpperCase() !== 'POST') {
        return adminAnswer(405, { error: 'Hook calls are POST' });
      }
      const raw = rawBodyOf(request.body);
      if (!raw) return adminAnswer(400, { error: BODY_NOT_AS_RECEIVED });
      const verified = await opts.verifier.verify(request.headers, 'POST', request.url, {
        body: raw,
        requireBodyHash: true,
      });
      if (!verified.ok) return adminAnswer(401, { error: verified.reason });
      if (verified.payload.caller.type !== 'lamaste') {
        return adminAnswer(403, { error: 'Only Lamaste calls lifecycle hooks' }, verified);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf-8'));
      } catch {
        return adminAnswer(400, { error: 'The hook call is not JSON' }, verified);
      }
      const call = parseAgentHookCall(parsed, stage);
      if (!call) return adminAnswer(400, { error: 'Malformed hook call' }, verified);

      const fn = opts.hooks[stage] as
        | ((input: unknown) => AgentHookDecision | void | Promise<AgentHookDecision | void>)
        | undefined;
      if (!fn) {
        return adminAnswer(404, { error: `This agent half has no ${stage} hook` }, verified);
      }
      let decision: unknown;
      try {
        decision = await fn(call.input);
      } catch (err: unknown) {
        return adminAnswer(
          200,
          { ok: false, reason: err instanceof Error ? err.message : String(err) },
          verified,
        );
      }
      if (decision === undefined && (stage === 'tunnel:down' || stage === 'tunnel:up')) {
        return adminAnswer(200, { ok: true }, verified);
      }
      const valid = parseAgentHookDecision(decision);
      if (!valid) {
        return adminAnswer(
          500,
          { error: `The ${stage} hook returned no valid decision` },
          verified,
        );
      }
      return adminAnswer(200, valid as unknown as Record<string, unknown>, verified);
    },
  };
}
