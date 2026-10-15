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

import { constants } from 'node:fs';
import { lstat, open, stat } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import {
  APPHOST_PATHS,
  APPHOST_ROUTE_RE,
  AgentHalfPackageNameSchema,
  AgentHalfVersionSchema,
} from '../agent-half.js';
import { APP_UNIT_STATES } from '../agent-jobs.js';
import type { AppUnitState } from '../agent-jobs.js';
import { parseRelayVerifyKey } from '../relay-assertion.js';
import { AGENT_LABEL_RE } from './registry.js';

const SUDO = '/usr/bin/sudo';
const HELPER_ENV = Object.freeze({ PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' });

/** The helper's exit status when the agent half named is not installed (`config`, `activate`). */
export const APPHOST_EXIT_NOT_INSTALLED = 3;

/** The helper's exit status when the route belongs to another agent label or package. */
export const APPHOST_EXIT_NOT_OWNER = 4;

/**
 * The helper's exit status when it refuses a job the relay did not sign
 * for this agent with the key pinned for it: no signature, a bad one, an
 * expired or replayed one, or one for another command, route, payload or
 * agent (`install`, `activate`, `remove`).
 */
export const APPHOST_EXIT_UNSIGNED = 5;

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

// ---------------------------------------------------------------------------
// The relay key pinned for an agent (what the helper verifies app jobs with)
// ---------------------------------------------------------------------------

/** The version of a relay pin file's format. */
export const RELAY_PIN_VERSION = 1;

/**
 * The relay key the app host helper verifies agent `label`'s app jobs with
 * (`APPHOST_PATHS.relayPinFile`, root 0644, written by `sudo lamaste-agent
 * apphost enable|pin` from that agent's relay over its pinned mTLS channel).
 */
export interface RelayPin {
  /** The agent's label on this machine (the file's name, the helper's `<label>`). */
  readonly label: string;
  /** The label the relay knows the agent by — what its signed jobs name. */
  readonly agent: string;
  /** The key's id, derived from it. */
  readonly kid: string;
  /** Base64 of the key's DER SubjectPublicKeyInfo (Ed25519). */
  readonly publicKey: string;
  /** The panel it was fetched from. */
  readonly panelUrl: string;
  readonly pinnedAt: string;
}

const PIN_KEYS = ['v', 'label', 'agent', 'kid', 'publicKey', 'panelUrl', 'pinnedAt'];
const PIN_MAX_BYTES = 16 * 1024;

/** The pin file's content: `{ v, label, agent, kid, publicKey, panelUrl, pinnedAt }`, one line. */
export function relayPinJson(pin: RelayPin): string {
  return `${JSON.stringify({
    v: RELAY_PIN_VERSION,
    label: pin.label,
    agent: pin.agent,
    kid: pin.kid,
    publicKey: pin.publicKey,
    panelUrl: pin.panelUrl,
    pinnedAt: pin.pinnedAt,
  })}\n`;
}

/**
 * Parse a pin file of agent `label`, strictly: every field and no other,
 * the label its own, the key an Ed25519 key whose id is `kid`. Null when it
 * is not one.
 */
export function parseRelayPin(text: string, label: string): RelayPin | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length !== PIN_KEYS.length || !PIN_KEYS.every((k) => Object.hasOwn(r, k))) return null;
  const { v, agent, kid, publicKey, panelUrl, pinnedAt } = r;
  if (
    v !== RELAY_PIN_VERSION ||
    r['label'] !== label ||
    !AGENT_LABEL_RE.test(label) ||
    typeof agent !== 'string' ||
    !AGENT_LABEL_RE.test(agent) ||
    typeof kid !== 'string' ||
    typeof publicKey !== 'string' ||
    typeof panelUrl !== 'string' ||
    !panelUrl.startsWith('https://') ||
    panelUrl.length > 2048 ||
    /\p{Cc}/u.test(panelUrl) ||
    typeof pinnedAt !== 'string' ||
    !Number.isFinite(Date.parse(pinnedAt))
  ) {
    return null;
  }
  try {
    parseRelayVerifyKey({ kid, publicKey });
  } catch {
    return null;
  }
  return { label, agent, kid, publicKey, panelUrl, pinnedAt };
}

/** Agent `label`'s pin: none, one the helper would refuse (and why), or the key. */
export type RelayPinState =
  | { readonly state: 'absent' }
  | { readonly state: 'invalid'; readonly reason: string }
  | { readonly state: 'pinned'; readonly pin: RelayPin };

export interface ReadRelayPinOptions {
  /** Prefixes the pin's path (tests); "/" on a machine. */
  readonly root?: string | undefined;
  /** Who must own the pin and its directory (tests); root (0) on a machine. */
  readonly ownerUid?: number | undefined;
}

/**
 * Read the relay key pinned for agent `label` as the helper does: a regular
 * file and its directory, owned by root and writable by no one else — a pin
 * the agent's user could have written is no pin.
 */
export async function readRelayPin(
  label: string,
  options: ReadRelayPinOptions = {},
): Promise<RelayPinState> {
  const root = options.root ?? '/';
  const ownerUid = options.ownerUid ?? 0;
  const file = path.join(root, APPHOST_PATHS.relayPinFile(label));
  let dirInfo;
  try {
    dirInfo = await lstat(path.dirname(file));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' };
    throw err;
  }
  if (!dirInfo.isDirectory() || dirInfo.uid !== ownerUid || (dirInfo.mode & 0o022) !== 0) {
    return { state: 'invalid', reason: `${APPHOST_PATHS.relaysDir} is not a root-owned directory` };
  }
  let handle;
  try {
    // O_NOFOLLOW: the pin itself is never a link.
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { state: 'absent' };
    if (code === 'ELOOP') return { state: 'invalid', reason: 'the pin is a symbolic link' };
    throw err;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== ownerUid || (info.mode & 0o022) !== 0) {
      return { state: 'invalid', reason: 'the pin is not a root-owned file' };
    }
    if (info.size > PIN_MAX_BYTES) return { state: 'invalid', reason: 'the pin is too large' };
    const pin = parseRelayPin(await handle.readFile('utf-8'), label);
    return pin === null
      ? { state: 'invalid', reason: 'the pin is not a relay key pin' }
      : { state: 'pinned', pin };
  } finally {
    await handle.close();
  }
}

/** The id of the relay key pinned for agent `label`; null when none is (or the pin is unusable). */
export async function pinnedRelayKid(label: string): Promise<string | null> {
  try {
    const pin = await readRelayPin(label);
    return pin.state === 'pinned' ? pin.pin.kid : null;
  } catch {
    return null;
  }
}
