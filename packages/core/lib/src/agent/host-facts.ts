/**
 * Host facts — what the relay needs to know about this agent's machine to
 * decide whether it can host a plugin (`hostEligibility`): the OS, the
 * distribution (`/etc/os-release`), the architecture, the Node.js version,
 * whether systemd is the system manager, and whether the app host helper is
 * enabled — its protocol, the Node.js it runs on (the one every agent half
 * it installs runs on), and the id of the relay key it verifies this
 * agent's app jobs with (`apphost enable|pin`).
 *
 * The sync gathers them on every run and reports them
 * (`PUT /api/agents/me/host-facts`) when they changed or a day has passed;
 * `agents/<label>/host-facts.json` (0600) remembers what was last reported:
 *
 *     { "reported": { "hash": "<sha256>", "at": "<ISO 8601>" } | null,
 *       "apphost":  { "helper": "<dev:ino:size:mtime>",
 *                     "facts": { "version": 1, "node": "22.13.1" } | null, "at": "<ISO 8601>" } | null }
 *
 * Whether the helper answers is learnt by running it (`sudo -n … status`),
 * which sudo logs; the answer is therefore kept until the helper file
 * changes (`apphost enable` installs a new one) or a day has passed, not
 * asked every 30 seconds. The pinned relay key is a root-owned file anyone
 * may read: it is read on every sync, so a re-pin is reported at once.
 */

import crypto from 'node:crypto';
import { readFile, readlink, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { atomicWriteJSON, readJSONFile } from '../file-helpers.js';
import { HostFactsSchema } from '../schemas.js';
import type { HostFacts } from '../schemas.js';
import { appHostHelperKey, appHostStatus, pinnedRelayKid } from './apphost.js';
import { agentDataDir } from './platform.js';

/** Facts are reported again after this long even when nothing changed. */
export const HOST_FACTS_REFRESH_MS = 24 * 60 * 60 * 1000;

/** What the helper itself answers (`status`): its protocol and Node.js; null — not enabled or silent. */
export type AppHostProbe = { readonly version: number; readonly node: string } | null;

/** A cached probe, validated as the reported `apphost` is, without the pinned key. */
const AppHostProbeSchema = HostFactsSchema.shape.apphost.unwrap().omit({ relayKid: true });

const DISTRO_ID_RE = /^[a-z0-9._-]{1,40}$/;
const DISTRO_VERSION_RE = /^[A-Za-z0-9._-]{0,40}$/;
const OS_RELEASE_FILES = ['/etc/os-release', '/usr/lib/os-release'];

/** Where the facts come from — the machine itself unless replaced (tests). */
export interface HostFactsSources {
  readonly platform?: NodeJS.Platform | undefined;
  readonly arch?: string | undefined;
  readonly nodeVersion?: string | undefined;
  readonly readFile?: ((filePath: string) => Promise<string>) | undefined;
  readonly isDirectory?: ((dirPath: string) => Promise<boolean>) | undefined;
  readonly readlink?: ((linkPath: string) => Promise<string>) | undefined;
  /**
   * The app host helper's protocol, Node.js and the relay key pinned for
   * the agent; null when it is not enabled or does not answer.
   */
  readonly appHost?: (() => Promise<HostFacts['apphost']>) | undefined;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
    return v.slice(1, -1).replace(/\\(["'$`\\])/g, '$1');
  }
  return v;
}

/**
 * The distribution from os-release text (`ID`, `ID_LIKE`, `VERSION_ID`):
 * null when there is no valid `ID`; `ID_LIKE` entries and a `VERSION_ID`
 * outside the reported shape are left out.
 */
export function parseOsRelease(text: string): HostFacts['distro'] {
  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m?.[1] !== undefined && m[2] !== undefined) fields.set(m[1], unquote(m[2]));
  }
  const id = fields.get('ID') ?? '';
  if (!DISTRO_ID_RE.test(id)) return null;
  const idLike = (fields.get('ID_LIKE') ?? '')
    .split(/\s+/)
    .filter((v) => DISTRO_ID_RE.test(v))
    .slice(0, 10);
  const versionId = fields.get('VERSION_ID') ?? '';
  return { id, idLike, versionId: DISTRO_VERSION_RE.test(versionId) ? versionId : '' };
}

async function defaultIsDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Ask the helper (`status`): its protocol and the Node.js it runs on, as
 * x.y.z; null when it is not enabled or does not answer.
 */
export async function probeAppHost(): Promise<AppHostProbe> {
  const availability = await appHostStatus();
  if (availability.state !== 'ready') return null;
  const node = /^(\d+\.\d+\.\d+)/.exec(availability.status.node)?.[1];
  return node === undefined ? null : { version: availability.status.protocol, node };
}

/**
 * Agent `label`'s host facts as this machine has them, validated against
 * {@link HostFactsSchema}: the helper asked directly and the relay key
 * pinned for `label`, unless `sources` replaces them.
 */
export async function gatherHostFacts(
  label: string,
  sources: HostFactsSources = {},
): Promise<HostFacts> {
  const platform = sources.platform ?? process.platform;
  if (platform !== 'linux' && platform !== 'darwin') {
    throw new Error(`Host facts are not defined for platform ${platform}`);
  }
  const nodeVersion = /^(\d+\.\d+\.\d+)/.exec(sources.nodeVersion ?? process.versions.node)?.[1];
  if (nodeVersion === undefined) throw new Error('The Node.js version is not x.y.z');
  const read = sources.readFile ?? ((p: string) => readFile(p, 'utf-8'));

  let distro: HostFacts['distro'] = null;
  let systemd = false;
  let apphost: HostFacts['apphost'] = null;
  if (platform === 'linux') {
    for (const file of OS_RELEASE_FILES) {
      const text = await read(file).catch(() => null);
      if (text !== null) {
        distro = parseOsRelease(text);
        break;
      }
    }
    // sd_booted(): systemd is the system manager when /run/systemd/system
    // exists; PID 1's executable is the fallback.
    const isDirectory = sources.isDirectory ?? defaultIsDirectory;
    systemd =
      (await isDirectory('/run/systemd/system')) ||
      path.basename(await (sources.readlink ?? readlink)('/proc/1/exe').catch(() => '')) ===
        'systemd';
    const appHost =
      sources.appHost ??
      (async () => {
        const probe = await probeAppHost();
        return probe === null ? null : { ...probe, relayKid: await pinnedRelayKid(label) };
      });
    apphost = await appHost();
  }

  return HostFactsSchema.parse({
    os: platform,
    arch: sources.arch ?? os.arch(),
    distro,
    node: nodeVersion,
    systemd,
    apphost,
  });
}

/** SHA-256 of the facts in a fixed field order — what decides whether they changed. */
export function hostFactsHash(facts: HostFacts): string {
  const canonical = {
    os: facts.os,
    arch: facts.arch,
    distro:
      facts.distro === null
        ? null
        : { id: facts.distro.id, idLike: facts.distro.idLike, versionId: facts.distro.versionId },
    node: facts.node,
    systemd: facts.systemd,
    apphost:
      facts.apphost === null
        ? null
        : {
            version: facts.apphost.version,
            node: facts.apphost.node,
            relayKid: facts.apphost.relayKid,
          },
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

interface HostFactsState {
  readonly reported: { readonly hash: string; readonly at: string } | null;
  /** The helper's last answer, for the helper file it came from. */
  readonly apphost: {
    readonly helper: string;
    readonly facts: AppHostProbe;
    readonly at: string;
  } | null;
}

export function hostFactsStatePath(label: string): string {
  return path.join(agentDataDir(label), 'host-facts.json');
}

async function readHostFactsState(label: string): Promise<HostFactsState> {
  const raw = await readJSONFile<unknown>(hostFactsStatePath(label), null).catch(() => null);
  const r = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const reported = r['reported'] as Record<string, unknown> | null | undefined;
  const apphost = r['apphost'] as Record<string, unknown> | null | undefined;
  const cached =
    apphost && apphost['facts'] !== null ? AppHostProbeSchema.safeParse(apphost['facts']) : null;
  return {
    reported:
      reported && typeof reported['hash'] === 'string' && typeof reported['at'] === 'string'
        ? { hash: reported['hash'], at: reported['at'] }
        : null,
    apphost:
      apphost &&
      typeof apphost['helper'] === 'string' &&
      typeof apphost['at'] === 'string' &&
      (cached === null || cached.success)
        ? { helper: apphost['helper'], facts: cached?.data ?? null, at: apphost['at'] }
        : null,
  };
}

/** Panel call the host facts sync needs, bound to the agent's mTLS identity. */
export interface HostFactsPanelCalls {
  /** `PUT /api/agents/me/host-facts`; 'unsupported' when the panel has no such endpoint (404). */
  putHostFacts(facts: HostFacts): Promise<'ok' | 'unsupported'>;
}

export interface HostFactsSyncOptions {
  readonly now?: number | undefined;
  /** Replaces the machine as the source of the facts (tests). */
  readonly sources?: HostFactsSources | undefined;
  /** Replaces the helper file's identity, the uncached probe and the pinned key's id (tests). */
  readonly appHost?:
    | {
        helperKey(): Promise<string | null>;
        probe(): Promise<AppHostProbe>;
        relayKid?(label: string): Promise<string | null>;
      }
    | undefined;
}

export interface HostFactsSyncResult {
  /** The facts were sent to the panel in this run. */
  readonly reported: boolean;
  /** They differ from what was last reported (a first report counts). */
  readonly changed: boolean;
}

const NOT_REPORTED: HostFactsSyncResult = Object.freeze({ reported: false, changed: false });

/**
 * Gather the host facts and report them when they changed since the last
 * report or {@link HOST_FACTS_REFRESH_MS} has passed. Failures are
 * warnings; nothing is recorded as reported until the panel took it, so
 * the next sync tries again.
 */
export async function syncHostFacts(
  label: string,
  panel: HostFactsPanelCalls,
  warnings: string[],
  options: HostFactsSyncOptions = {},
): Promise<HostFactsSyncResult> {
  const now = options.now ?? Date.now();
  const state = await readHostFactsState(label);
  let apphostCache = state.apphost;

  // The helper's answer, asked again only when the helper file changed or
  // the cached answer is a day old.
  const appHost = options.appHost ?? { helperKey: appHostHelperKey, probe: probeAppHost };
  const relayKid = appHost.relayKid ?? pinnedRelayKid;
  const cachedProbe = async (): Promise<AppHostProbe> => {
    const helper = await appHost.helperKey();
    if (helper === null) {
      apphostCache = null;
      return null;
    }
    if (
      apphostCache !== null &&
      apphostCache.helper === helper &&
      now - Date.parse(apphostCache.at) < HOST_FACTS_REFRESH_MS
    ) {
      return apphostCache.facts;
    }
    const answer = await appHost.probe();
    apphostCache = { helper, facts: answer, at: new Date(now).toISOString() };
    return answer;
  };

  const cachedAppHost = async (): Promise<HostFacts['apphost']> => {
    const probe = await cachedProbe();
    return probe === null ? null : { ...probe, relayKid: await relayKid(label) };
  };

  let facts: HostFacts;
  try {
    facts = await gatherHostFacts(label, { appHost: cachedAppHost, ...options.sources });
  } catch (err: unknown) {
    warnings.push(
      `Host facts could not be gathered (${err instanceof Error ? err.message : String(err)}).`,
    );
    return NOT_REPORTED;
  }

  let reported = state.reported;
  let result = NOT_REPORTED;
  const hash = hostFactsHash(facts);
  const fresh =
    reported !== null &&
    reported.hash === hash &&
    now - Date.parse(reported.at) < HOST_FACTS_REFRESH_MS;
  if (!fresh) {
    try {
      const answer = await panel.putHostFacts(facts);
      if (answer === 'unsupported') {
        warnings.push(
          'The panel does not take host facts yet (it predates Lamaste 4.3), so it cannot tell ' +
            'whether this agent can host a plugin; retrying on the next sync.',
        );
      } else {
        result = { reported: true, changed: reported?.hash !== hash };
        reported = { hash, at: new Date(now).toISOString() };
      }
    } catch (err: unknown) {
      warnings.push(
        `Host facts could not be reported (${err instanceof Error ? err.message : String(err)}); ` +
          'retrying on the next sync.',
      );
    }
  }

  const next: HostFactsState = { reported, apphost: apphostCache };
  if (JSON.stringify(next) !== JSON.stringify(state)) {
    await atomicWriteJSON(hostFactsStatePath(label), next, { mode: 0o600, mkdirp: true });
  }
  return result;
}
