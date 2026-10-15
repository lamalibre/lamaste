/**
 * Plugin hostings — which agent hosts an agent-hosted plugin's agent half,
 * through which internal tunnel, and the installation secret the two halves
 * share.
 *
 * One record per plugin, in `<stateDir>/plugin-hostings.json` (0600,
 * atomic, one mutex): the hosting agent, the assigned relay-loopback port,
 * the internal tunnel's id, the current installation secret and — during a
 * rotation — the previous one, which the forwarder keeps signing with until
 * the hosting agent has acknowledged the new secret, so no request is signed
 * with a secret the agent half cannot verify yet. The health the monitor
 * observed last is kept here too, so the panel can show it after a restart.
 *
 * Secrets: 32 random bytes, hex (see `caller-assertion.ts`). They leave this
 * file only through `GET /api/agents/me/plugin-config/<route>`, which the
 * hosting agent calls with its own certificate.
 */

import path from 'node:path';
import { generateHostingSecret, assertHostingSecret } from '../caller-assertion.js';
import { PromiseChainMutex, atomicWriteJSON, readJSONFile } from '../file-helpers.js';

export const PLUGIN_HOSTINGS_FILENAME = 'plugin-hostings.json';

export interface PluginHostingSecret {
  readonly secret: string;
  /** When this secret was issued (ISO 8601). Not secret; the agent compares it. */
  readonly issuedAt: string;
}

export type PluginHostingHealthState = 'unknown' | 'up' | 'down';

export interface PluginHostingHealth {
  readonly state: PluginHostingHealthState;
  /** When down: `tunnel` (the loopback port refuses) or `app` (the port answers, the agent half does not). */
  readonly reason?: 'tunnel' | 'app' | undefined;
  /** When the state last changed (ISO 8601). */
  readonly since: string;
  readonly lastError?: string | undefined;
}

export interface PluginHostingRecord {
  /** The plugin's route (manifest `name`). */
  readonly plugin: string;
  readonly agentLabel: string;
  /** The relay-loopback port of the internal tunnel; the agent half listens on the same port. */
  readonly port: number;
  readonly tunnelId: string;
  readonly createdAt: string;
  readonly current: PluginHostingSecret;
  /** The secret before the last rotation, kept until the agent acknowledges `current`. */
  readonly previous?: PluginHostingSecret | undefined;
  /** `issuedAt` of the last secret the hosting agent confirmed it holds. */
  readonly acknowledgedIssuedAt?: string | undefined;
  readonly health: PluginHostingHealth;
}

export type PluginHostingStore = Record<string, PluginHostingRecord>;

/** What the panel shows: everything but the secrets. */
export interface PluginHostingView {
  readonly plugin: string;
  readonly agentLabel: string;
  readonly port: number;
  readonly tunnelId: string;
  readonly createdAt: string;
  readonly secretIssuedAt: string;
  /** The hosting agent holds the current secret. */
  readonly secretAcknowledged: boolean;
  /** A rotation is in progress: the previous secret is still accepted. */
  readonly rotationPending: boolean;
  readonly health: PluginHostingHealth;
}

/** What the hosting agent fetches for its agent half. */
export interface AgentPluginConfig {
  readonly plugin: string;
  readonly port: number;
  readonly secret: string;
  readonly issuedAt: string;
  readonly previousSecret?: string | undefined;
  readonly previousIssuedAt?: string | undefined;
}

/** What the agent-config endpoint tells an agent about each plugin it hosts. */
export interface AgentPluginAssignment {
  readonly route: string;
  readonly port: number;
  readonly secretIssuedAt: string;
  readonly secretAcknowledged: boolean;
}

export class PluginHostingError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'ALREADY_HOSTED' | 'INVALID',
  ) {
    super(message);
    this.name = 'PluginHostingError';
  }
}

const ROUTE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function assertRoute(plugin: string): void {
  if (typeof plugin !== 'string' || !ROUTE_RE.test(plugin)) {
    throw new PluginHostingError(`Invalid plugin route "${String(plugin)}"`, 'INVALID');
  }
}

export function pluginHostingsPath(stateDir: string): string {
  return path.join(stateDir, PLUGIN_HOSTINGS_FILENAME);
}

const mutex = new PromiseChainMutex();

function isRecord(value: unknown): value is PluginHostingRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  const current = r['current'] as Record<string, unknown> | undefined;
  return (
    typeof r['plugin'] === 'string' &&
    typeof r['agentLabel'] === 'string' &&
    typeof r['port'] === 'number' &&
    typeof r['tunnelId'] === 'string' &&
    typeof r['createdAt'] === 'string' &&
    !!current &&
    typeof current['secret'] === 'string' &&
    typeof current['issuedAt'] === 'string'
  );
}

/** Read every hosting record. An absent file is an empty store. */
export async function readPluginHostings(stateDir: string): Promise<PluginHostingStore> {
  const raw = await readJSONFile<unknown>(pluginHostingsPath(stateDir), {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const store: PluginHostingStore = {};
  for (const [plugin, record] of Object.entries(raw as Record<string, unknown>)) {
    if (ROUTE_RE.test(plugin) && isRecord(record) && record.plugin === plugin) {
      store[plugin] = {
        ...record,
        health: record.health ?? { state: 'unknown', since: record.createdAt },
      };
    }
  }
  return store;
}

async function writePluginHostings(stateDir: string, store: PluginHostingStore): Promise<void> {
  await atomicWriteJSON(pluginHostingsPath(stateDir), store, { mode: 0o600 });
}

/** The hosting of one plugin, or null. */
export async function getPluginHosting(
  stateDir: string,
  plugin: string,
): Promise<PluginHostingRecord | null> {
  assertRoute(plugin);
  return (await readPluginHostings(stateDir))[plugin] ?? null;
}

export interface CreatePluginHostingInput {
  readonly plugin: string;
  readonly agentLabel: string;
  readonly port: number;
  readonly tunnelId: string;
}

/**
 * Record a new hosting with a fresh secret. Fails when the plugin is
 * already hosted — a plugin has one hosting agent.
 */
export function createPluginHosting(
  stateDir: string,
  input: CreatePluginHostingInput,
): Promise<PluginHostingRecord> {
  assertRoute(input.plugin);
  return mutex.run(async () => {
    const store = await readPluginHostings(stateDir);
    if (store[input.plugin]) {
      throw new PluginHostingError(
        `Plugin "${input.plugin}" is already hosted on agent "${store[input.plugin]?.agentLabel}"`,
        'ALREADY_HOSTED',
      );
    }
    const now = new Date().toISOString();
    const record: PluginHostingRecord = {
      plugin: input.plugin,
      agentLabel: input.agentLabel,
      port: input.port,
      tunnelId: input.tunnelId,
      createdAt: now,
      current: { secret: generateHostingSecret(), issuedAt: now },
      health: { state: 'unknown', since: now },
    };
    store[input.plugin] = record;
    await writePluginHostings(stateDir, store);
    return record;
  });
}

/** Remove a plugin's hosting. Returns the removed record, or null when there was none. */
export function removePluginHosting(
  stateDir: string,
  plugin: string,
): Promise<PluginHostingRecord | null> {
  assertRoute(plugin);
  return mutex.run(async () => {
    const store = await readPluginHostings(stateDir);
    const record = store[plugin];
    if (!record) return null;
    delete store[plugin];
    await writePluginHostings(stateDir, store);
    return record;
  });
}

/**
 * Issue a new secret. The one in use becomes `previous` and stays accepted
 * until the hosting agent acknowledges the new one; a rotation started
 * while another is still unacknowledged replaces the unacknowledged secret
 * and keeps the one the agent is known to hold.
 */
export function rotatePluginHostingSecret(
  stateDir: string,
  plugin: string,
): Promise<PluginHostingRecord> {
  assertRoute(plugin);
  return mutex.run(async () => {
    const store = await readPluginHostings(stateDir);
    const record = store[plugin];
    if (!record) throw new PluginHostingError(`Plugin "${plugin}" is not hosted`, 'NOT_FOUND');
    const held =
      record.acknowledgedIssuedAt === record.current.issuedAt
        ? record.current
        : (record.previous ?? record.current);
    const next: PluginHostingRecord = {
      ...record,
      current: { secret: generateHostingSecret(), issuedAt: new Date().toISOString() },
      previous: held,
    };
    store[plugin] = next;
    await writePluginHostings(stateDir, store);
    return next;
  });
}

/**
 * The hosting agent confirms it holds the secret issued at `issuedAt`. When
 * that is the current secret the previous one is dropped. An `issuedAt` that
 * is not the current secret's changes nothing (`acknowledged: false`).
 */
export function acknowledgePluginHostingSecret(
  stateDir: string,
  plugin: string,
  issuedAt: string,
): Promise<{ readonly record: PluginHostingRecord; readonly acknowledged: boolean }> {
  assertRoute(plugin);
  return mutex.run(async () => {
    const store = await readPluginHostings(stateDir);
    const record = store[plugin];
    if (!record) throw new PluginHostingError(`Plugin "${plugin}" is not hosted`, 'NOT_FOUND');
    if (issuedAt !== record.current.issuedAt) {
      return { record, acknowledged: false };
    }
    if (record.acknowledgedIssuedAt === issuedAt && record.previous === undefined) {
      return { record, acknowledged: true };
    }
    const { previous: _dropped, ...rest } = record;
    const next: PluginHostingRecord = { ...rest, acknowledgedIssuedAt: issuedAt };
    store[plugin] = next;
    await writePluginHostings(stateDir, store);
    return { record: next, acknowledged: true };
  });
}

/** Persist a health transition observed by the monitor. */
export function updatePluginHostingHealth(
  stateDir: string,
  plugin: string,
  health: PluginHostingHealth,
): Promise<PluginHostingRecord | null> {
  assertRoute(plugin);
  return mutex.run(async () => {
    const store = await readPluginHostings(stateDir);
    const record = store[plugin];
    if (!record) return null;
    const next: PluginHostingRecord = { ...record, health };
    store[plugin] = next;
    await writePluginHostings(stateDir, store);
    return next;
  });
}

/**
 * The secret the forwarder signs with: the current one once the agent has
 * acknowledged it, else the previous one the agent is known to hold. On a
 * fresh hosting there is no previous secret, so the current one is used —
 * the agent half cannot verify anything before it has fetched it anyway.
 */
export function signingSecretFor(record: PluginHostingRecord): string {
  const secret =
    record.acknowledgedIssuedAt === record.current.issuedAt || record.previous === undefined
      ? record.current.secret
      : record.previous.secret;
  assertHostingSecret(secret);
  return secret;
}

export function pluginHostingView(record: PluginHostingRecord): PluginHostingView {
  return {
    plugin: record.plugin,
    agentLabel: record.agentLabel,
    port: record.port,
    tunnelId: record.tunnelId,
    createdAt: record.createdAt,
    secretIssuedAt: record.current.issuedAt,
    secretAcknowledged: record.acknowledgedIssuedAt === record.current.issuedAt,
    rotationPending: record.previous !== undefined,
    health: record.health,
  };
}

export function agentPluginConfigFor(record: PluginHostingRecord): AgentPluginConfig {
  return {
    plugin: record.plugin,
    port: record.port,
    secret: record.current.secret,
    issuedAt: record.current.issuedAt,
    ...(record.previous
      ? { previousSecret: record.previous.secret, previousIssuedAt: record.previous.issuedAt }
      : {}),
  };
}

/** The assignments the agent-config endpoint reports to agent `label`. */
export function agentPluginAssignments(
  store: PluginHostingStore,
  label: string,
): AgentPluginAssignment[] {
  return Object.values(store)
    .filter((r) => r.agentLabel === label)
    .sort((a, b) => a.plugin.localeCompare(b.plugin))
    .map((r) => ({
      route: r.plugin,
      port: r.port,
      secretIssuedAt: r.current.issuedAt,
      secretAcknowledged: r.acknowledgedIssuedAt === r.current.issuedAt,
    }));
}
