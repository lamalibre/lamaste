/**
 * The agent's side of `lamaste-apphost`, the root helper that installs the
 * agent halves of agent-hosted plugins (slice 3): how the agent runs it and
 * reads its answers. The helper is a self-contained script shipped with the
 * agent CLI (`scripts/lamaste-apphost`), installed by
 * `sudo lamaste-agent apphost enable`; the agent's user runs it through its
 * one sudoers rule (`sudo -n`), an agent running as root runs it directly.
 *
 * What goes to the helper on stdin — a package tarball, a plugin config
 * with its secret — never appears in its arguments, and nothing here logs
 * it. The helper's errors are one line on stderr, `lamaste-apphost: …`,
 * and never quote its input.
 */

import { stat } from 'node:fs/promises';

import { z } from 'zod';

import {
  APPHOST_PATHS,
  APPHOST_ROUTE_RE,
  AgentHalfPackageNameSchema,
  AgentHalfVersionSchema,
} from '../agent-half.js';
import { APP_UNIT_STATES } from '../agent-jobs.js';
import type { AppUnitState } from '../agent-jobs.js';
import { AGENT_LABEL_RE } from './registry.js';

const SUDO = '/usr/bin/sudo';
const HELPER_ENV = Object.freeze({ PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' });

/** The helper's exit status when the agent half named is not installed (`config`, `activate`). */
export const APPHOST_EXIT_NOT_INSTALLED = 3;

/** The helper's exit status when the route belongs to another agent label or package. */
export const APPHOST_EXIT_NOT_OWNER = 4;

/** How the helper is started: directly as root, through `sudo -n` otherwise. */
export function appHostInvocation(
  args: readonly string[],
  uid: number = process.getuid?.() ?? -1,
): { readonly file: string; readonly args: readonly string[] } {
  return uid === 0
    ? { file: APPHOST_PATHS.helper, args: [...args] }
    : { file: SUDO, args: ['-n', APPHOST_PATHS.helper, ...args] };
}

export interface AppHostRunOptions {
  /** Bytes for the helper's stdin (a tarball, a config) — never an argument. */
  readonly input?: Buffer | string | undefined;
  readonly timeoutMs?: number | undefined;
}

/** A finished helper run. `exitCode` is -1 when it could not be started. */
export interface AppHostRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/** Run the helper with `args` (never throws for a failed run — read `exitCode`). */
export async function runAppHost(
  args: readonly string[],
  options: AppHostRunOptions = {},
): Promise<AppHostRun> {
  const { execa } = await import('execa');
  const { file, args: argv } = appHostInvocation(args);
  const result = await execa(file, [...argv], {
    ...(options.input !== undefined ? { input: options.input } : { stdin: 'ignore' as const }),
    timeout: options.timeoutMs ?? 120_000,
    reject: false,
    extendEnv: false,
    env: { ...HELPER_ENV },
  });
  return {
    exitCode: typeof result.exitCode === 'number' ? result.exitCode : -1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    // Not started at all (no sudo, say): execa's own account of why.
    stderr:
      typeof result.stderr === 'string' && result.stderr !== ''
        ? result.stderr
        : typeof result.exitCode === 'number'
          ? ''
          : (result.shortMessage ?? ''),
    timedOut: result.timedOut === true,
  };
}

/**
 * Why a helper run failed, in one line: the helper's own message, or what
 * kept it from running (sudo refusing, a timeout). Carries no secret — the
 * helper never echoes its input.
 */
export function appHostFailure(run: AppHostRun): string {
  if (run.timedOut) return 'it did not finish in time';
  const lines = run.stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const own = [...lines].reverse().find((l) => l.startsWith('lamaste-apphost: '));
  if (own !== undefined) return own.slice('lamaste-apphost: '.length);
  if (lines.length > 0) return `it could not be run (${lines[0]})`;
  return `it exited with status ${run.exitCode}`;
}

/** Whether the helper is installed on this machine (`apphost enable` was run). */
export async function isAppHostEnabled(): Promise<boolean> {
  return (await appHostHelperKey()) !== null;
}

/**
 * The helper file's identity (device, inode, size, mtime) — it changes when
 * `apphost enable` installs a new helper; null when there is none.
 */
export async function appHostHelperKey(): Promise<string | null> {
  try {
    const st = await stat(APPHOST_PATHS.helper);
    return st.isFile() ? `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}` : null;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

const AppHostAppSchema = z.object({
  versions: z.array(AgentHalfVersionSchema),
  current: AgentHalfVersionSchema.nullable(),
  previous: AgentHalfVersionSchema.nullable(),
  unit: z.enum(APP_UNIT_STATES),
  /** Who owns the route on this machine (the helper's owner record); null when there is none. */
  owner: z
    .object({ package: AgentHalfPackageNameSchema, label: z.string().regex(AGENT_LABEL_RE) })
    .nullable(),
});

const AppHostStatusSchema = z.object({
  protocol: z.number().int().min(1),
  /** The Node.js the helper runs on — and every agent half it installs (`process.versions.node`). */
  node: z
    .string()
    .regex(/^\d+\.\d+\.\d+/)
    .max(64),
  apps: z.record(z.string().regex(APPHOST_ROUTE_RE), AppHostAppSchema),
});

/** What `lamaste-apphost status` reports. */
export type AppHostStatus = z.infer<typeof AppHostStatusSchema>;

/** Parse the helper's `status` output; null when it is not one. */
export function parseAppHostStatus(stdout: string): AppHostStatus | null {
  try {
    const parsed = AppHostStatusSchema.safeParse(JSON.parse(stdout));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const AppHostOutcomeSchema = z.object({
  ok: z.literal(true),
  version: AgentHalfVersionSchema.nullable(),
  unit: z.enum(APP_UNIT_STATES),
});

/** The agent half after a mutating helper command: the version `current` points at, its unit. */
export interface AppHostOutcome {
  readonly version: string | null;
  readonly unit: AppUnitState;
}

/** Parse what `install`, `config`, `activate` and `remove` print; null when it is not that. */
export function parseAppHostOutcome(stdout: string): AppHostOutcome | null {
  try {
    const parsed = AppHostOutcomeSchema.safeParse(JSON.parse(stdout));
    return parsed.success ? { version: parsed.data.version, unit: parsed.data.unit } : null;
  } catch {
    return null;
  }
}

/** The helper on this machine: not installed, installed but not runnable, or answering. */
export type AppHostAvailability =
  | { readonly state: 'absent' }
  | { readonly state: 'unusable'; readonly reason: string }
  | { readonly state: 'ready'; readonly status: AppHostStatus };

/**
 * Ask the helper for its status (of one agent half, or all). `unusable`
 * means it is installed but did not answer — sudo refused (the rule names
 * another user), or it is broken.
 */
export async function appHostStatus(route?: string): Promise<AppHostAvailability> {
  if (route !== undefined && !APPHOST_ROUTE_RE.test(route)) {
    throw new Error(`Invalid plugin route "${route}"`);
  }
  if (!(await isAppHostEnabled())) return { state: 'absent' };
  const run = await runAppHost(route === undefined ? ['status'] : ['status', route], {
    timeoutMs: 60_000,
  });
  if (run.exitCode !== 0) return { state: 'unusable', reason: appHostFailure(run) };
  const status = parseAppHostStatus(run.stdout);
  return status === null
    ? { state: 'unusable', reason: 'it answered status with something unexpected' }
    : { state: 'ready', status };
}
