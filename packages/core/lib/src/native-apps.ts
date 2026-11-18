/**
 * Native apps on the user surface — the rules every side shares
 * (packages/core/docs/native-apps-design.md; desktop clients:
 * packages/core/docs/desktop-native-clients-design.md).
 *
 * An administrator registers one **native client** for an application host
 * (a user-surface host: a plugin-owned site, or a tunnel bound to plugin
 * routes). Lamaste renders it into Authelia as a public OIDC client —
 * PKCE `S256`, authorization code + refresh token, the host's audience, and
 * redirect URIs by its kind: a **mobile** client's are claimed HTTPS paths on
 * the host, a **desktop** client's are loopback paths on the device
 * (`http://127.0.0.1<path>`, any port) — and stands in front of Authelia's
 * token endpoint for it (the token broker). A native app then calls every
 * plugin the host serves with one bearer access token, checked as a browser
 * session is.
 *
 * This module is browser-safe (no Node imports): the client's shape and
 * limits, its id, its redirect paths, the app association files the host
 * serves, and the words of the grant lifecycle the panel, its UI and its
 * CLI share. The token verifier, the sign-in events and the Authelia
 * rendering live elsewhere (`native-token.ts`, `sign-in-events.ts`,
 * `server/authelia.ts`).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Client id
// ---------------------------------------------------------------------------

/**
 * Every OIDC client id Lamaste owns starts with this — the panel's own
 * `lamaste-server`, every native client. A manifest may not declare one
 * ({@link isReservedOidcClientId}).
 */
export const LAMASTE_OIDC_CLIENT_ID_PREFIX = 'lamaste-';

/** A native client's id: this prefix and the administrator's slug. */
export const NATIVE_CLIENT_ID_PREFIX = `${LAMASTE_OIDC_CLIENT_ID_PREFIX}native-`;

/** A native client's slug: lower case letters, digits and inner hyphens, 1–40. */
export const NATIVE_CLIENT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const NATIVE_CLIENT_ID_RE = /^lamaste-native-[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * Whether `id` is an OIDC client id only Lamaste may use: `lamaste`, or
 * anything under `lamaste-`. A manifest declaring one is refused — a
 * plugin routed `lamaste` could otherwise have named the panel's own
 * client or a native client.
 */
export function isReservedOidcClientId(id: string): boolean {
  return id === 'lamaste' || id.startsWith(LAMASTE_OIDC_CLIENT_ID_PREFIX);
}

/** Whether `value` is a native client's id (`lamaste-native-<slug>`). */
export function isNativeClientId(value: unknown): value is string {
  return typeof value === 'string' && NATIVE_CLIENT_ID_RE.test(value);
}

/** The id of the native client with `slug`. Throws on a slug no client can have. */
export function nativeClientId(slug: string): string {
  if (!NATIVE_CLIENT_SLUG_RE.test(slug)) throw new Error('Invalid native client slug');
  return `${NATIVE_CLIENT_ID_PREFIX}${slug}`;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** How long a native client's access tokens live, in minutes. */
export const NATIVE_ACCESS_TOKEN_MINUTES = Object.freeze({ min: 5, max: 15, default: 15 });

/** A grant's lifetimes, in days: idle (since its last refresh) and absolute (since sign-in). */
export const NATIVE_LIFETIME_DAYS = Object.freeze({
  min: 1,
  max: 365,
  idleDefault: 30,
  absoluteDefault: 90,
});

/** How many redirect paths one native client may claim. */
export const NATIVE_REDIRECT_PATHS_MAX = 4;

/** How many loopback paths one desktop client may register. */
export const NATIVE_LOOPBACK_PATHS_MAX = 4;

/** The longest redirect path. */
export const NATIVE_REDIRECT_PATH_MAX_LENGTH = 128;

/** The longest client name (Authelia's consent screen shows it). */
export const NATIVE_CLIENT_NAME_MAX_LENGTH = 100;

/** The longest device name an app may give its grant (`device_name`). */
export const NATIVE_DEVICE_NAME_MAX_LENGTH = 64;

/** The longest `User-Agent` summary a grant keeps. */
export const NATIVE_USER_AGENT_MAX_LENGTH = 128;

/** The scopes a native client is rendered with. */
export const NATIVE_CLIENT_SCOPES = Object.freeze(['openid', 'offline_access', 'profile'] as const);

/** The grant types a native client is rendered with. */
export const NATIVE_CLIENT_GRANT_TYPES = Object.freeze([
  'authorization_code',
  'refresh_token',
] as const);

/**
 * How long, after a rotation, the broker answers the spent refresh token
 * again with the answer it gave (design R8): a lost answer on a phone's
 * network, or two refreshes at once, is not a reuse.
 */
export const NATIVE_REFRESH_GRACE_MS = 30_000;

// ---------------------------------------------------------------------------
// Redirect paths
// ---------------------------------------------------------------------------

const REDIRECT_PATH_RE = /^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/;

/**
 * Whether `path` may be a desktop client's loopback path: one or more
 * segments of `[A-Za-z0-9._~-]`, no `.` or `..` segment, at most
 * {@link NATIVE_REDIRECT_PATH_MAX_LENGTH}, no query or fragment — the
 * redirect-path rule without the host exclusions, since the path is on the
 * device, not on the application host.
 */
export function isNativeLoopbackPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length > NATIVE_REDIRECT_PATH_MAX_LENGTH) return false;
  if (!REDIRECT_PATH_RE.test(path)) return false;
  return !path.split('/').some((segment) => segment === '.' || segment === '..');
}

/**
 * The path prefixes a redirect path may not lie under: the API, the
 * association files, and the vhosts' own internal locations (an exact
 * location there would collide with one the renderers write, and nginx
 * would refuse the host's whole vhost — security review L4).
 */
const REDIRECT_PATH_FORBIDDEN_PREFIXES = Object.freeze(['/api', '/.well-known', '/internal']);

/**
 * Whether `path` may be a native client's redirect path on its host: one or
 * more segments of `[A-Za-z0-9._~-]`, no `.` or `..` segment, at most
 * {@link NATIVE_REDIRECT_PATH_MAX_LENGTH}, nothing under `/api`,
 * `/.well-known` or `/internal` (compared case-insensitively), no query or
 * fragment. The host serves a fallback page there without authentication
 * (D6) — in place of whatever its backend or shell would answer there.
 */
export function isNativeRedirectPath(path: unknown): path is string {
  if (!isNativeLoopbackPath(path)) return false;
  const lower = path.toLowerCase();
  return !REDIRECT_PATH_FORBIDDEN_PREFIXES.some(
    (prefix) => lower === prefix || lower.startsWith(`${prefix}/`),
  );
}

/** The audience of an application host's access tokens: its origin, `https://<fqdn>`. */
export function nativeAudience(fqdn: string): string {
  return `https://${fqdn.toLowerCase()}`;
}

/** The redirect URIs a mobile client is registered with: `https://<fqdn><path>`. */
export function nativeRedirectUris(fqdn: string, paths: readonly string[]): string[] {
  return paths.map((path) => {
    if (!isNativeRedirectPath(path)) throw new Error('Invalid native redirect path');
    return `${nativeAudience(fqdn)}${path}`;
  });
}

/**
 * The loopback interface a desktop client's redirect URIs name: the IPv4
 * literal, never `localhost` (it may resolve elsewhere) — and Authelia
 * matches neither `localhost` nor `[::1]` against it (verified 2026-11-17).
 */
export const NATIVE_LOOPBACK_HOST = '127.0.0.1';

/**
 * The redirect URIs a desktop client is registered with:
 * `http://127.0.0.1<path>`, with no port. Authelia compares a loopback IP
 * literal's redirect without its port (RFC 8252 §7.3), so the app listens
 * on any free port; the path is compared exactly.
 */
export function nativeLoopbackRedirectUris(paths: readonly string[]): string[] {
  return paths.map((path) => {
    if (!isNativeLoopbackPath(path)) throw new Error('Invalid native loopback path');
    return `http://${NATIVE_LOOPBACK_HOST}${path}`;
  });
}

// ---------------------------------------------------------------------------
// App association files
// ---------------------------------------------------------------------------

/** Where an application host serves the iOS association file. */
export const APPLE_APP_SITE_ASSOCIATION_PATH = '/.well-known/apple-app-site-association';

/** Where an application host serves the Android association file. */
export const ASSET_LINKS_PATH = '/.well-known/assetlinks.json';

/** An Apple developer team id. */
export const APPLE_TEAM_ID_RE = /^[A-Z0-9]{10}$/;

/** An iOS bundle id or an Android package name: reverse DNS. */
export const APP_PACKAGE_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_-]+)+$/;

/** The longest bundle id or package name. */
export const APP_PACKAGE_NAME_MAX_LENGTH = 155;

/** A signing certificate's SHA-256 fingerprint as Android writes it: 32 upper-case hex pairs. */
export const SHA256_CERT_FINGERPRINT_RE = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/;

/** How many bundle ids, packages, or fingerprints per package. */
export const NATIVE_ASSOCIATIONS_MAX = 10;

const PackageNameSchema = z
  .string()
  .max(APP_PACKAGE_NAME_MAX_LENGTH)
  .regex(APP_PACKAGE_NAME_RE, 'Not a reverse-DNS name');

function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

/**
 * The administrator's setting the app association files are rendered from:
 * the iOS team and bundle ids, the Android packages and the SHA-256
 * fingerprints of their signing certificates. Either side may be absent.
 */
export const NativeAssociationsSchema = z
  .object({
    ios: z
      .object({
        teamId: z.string().regex(APPLE_TEAM_ID_RE, 'Not an Apple team id'),
        bundleIds: z
          .array(PackageNameSchema)
          .min(1)
          .max(NATIVE_ASSOCIATIONS_MAX)
          .refine(unique, { message: 'bundleIds must not repeat' }),
      })
      .strict()
      .optional(),
    android: z
      .array(
        z
          .object({
            packageName: PackageNameSchema,
            sha256CertFingerprints: z
              .array(
                z
                  .string()
                  .regex(SHA256_CERT_FINGERPRINT_RE, 'Not a SHA-256 certificate fingerprint'),
              )
              .min(1)
              .max(NATIVE_ASSOCIATIONS_MAX)
              .refine(unique, { message: 'sha256CertFingerprints must not repeat' }),
          })
          .strict(),
      )
      .max(NATIVE_ASSOCIATIONS_MAX)
      .refine((list) => unique(list.map((a) => a.packageName)), {
        message: 'packageName must not repeat',
      })
      .optional(),
  })
  .strict();

export type NativeAssociations = z.output<typeof NativeAssociationsSchema>;

/**
 * `apple-app-site-association` for a host, or null when the setting names
 * no iOS app: the bundles as `<team>.<bundle>`, and **only the redirect
 * paths** as universal-link components — the host's other links keep
 * opening in the browser — plus `webcredentials` (an HTTPS callback of
 * `ASWebAuthenticationSession` needs it). Pure.
 */
export function renderAppleAppSiteAssociation(
  associations: NativeAssociations,
  redirectPaths: readonly string[],
): Record<string, unknown> | null {
  const parsed = NativeAssociationsSchema.parse(associations);
  if (!parsed.ios) return null;
  for (const path of redirectPaths) {
    if (!isNativeRedirectPath(path)) throw new Error('Invalid native redirect path');
  }
  const appIds = parsed.ios.bundleIds.map((bundle) => `${parsed.ios?.teamId}.${bundle}`);
  return {
    applinks: {
      details: [
        {
          appIDs: appIds,
          components: redirectPaths.map((path) => ({ '/': path })),
        },
      ],
    },
    webcredentials: { apps: appIds },
  };
}

/**
 * `assetlinks.json` for a host, or null when the setting names no Android
 * app: `delegate_permission/common.handle_all_urls` per package (Android
 * filters the paths in the app's own manifest). Pure.
 */
export function renderAssetLinks(associations: NativeAssociations): unknown[] | null {
  const parsed = NativeAssociationsSchema.parse(associations);
  if (!parsed.android || parsed.android.length === 0) return null;
  return parsed.android.map((app) => ({
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: app.packageName,
      sha256_cert_fingerprints: [...app.sha256CertFingerprints],
    },
  }));
}

// ---------------------------------------------------------------------------
// The client as the administrator writes it
// ---------------------------------------------------------------------------

/** The kinds of application host a native client belongs to. */
export const NATIVE_CLIENT_HOST_KINDS = Object.freeze(['site', 'tunnel'] as const);

export type NativeClientHostKind = (typeof NATIVE_CLIENT_HOST_KINDS)[number];

/**
 * The kinds of native client: `mobile` — claimed HTTPS redirect paths on the
 * host and its app association files; `desktop` — loopback redirects on the
 * device, no files on the host. A host has at most one client of each kind.
 */
export const NATIVE_CLIENT_KINDS = Object.freeze(['mobile', 'desktop'] as const);

export type NativeClientKind = (typeof NATIVE_CLIENT_KINDS)[number];

/** Whether `value` is a kind of native client. */
export function isNativeClientKind(value: unknown): value is NativeClientKind {
  return typeof value === 'string' && (NATIVE_CLIENT_KINDS as readonly string[]).includes(value);
}

const RedirectPathsSchema = z
  .array(z.string().refine(isNativeRedirectPath, { message: 'Not a valid redirect path' }))
  .min(1)
  .max(NATIVE_REDIRECT_PATHS_MAX)
  .refine(unique, { message: 'redirectPaths must not repeat' });

const LoopbackPathsSchema = z
  .array(z.string().refine(isNativeLoopbackPath, { message: 'Not a valid loopback path' }))
  .min(1)
  .max(NATIVE_LOOPBACK_PATHS_MAX)
  .refine(unique, { message: 'loopbackPaths must not repeat' });

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

const ClientNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(NATIVE_CLIENT_NAME_MAX_LENGTH)
  .refine((name) => !CONTROL_RE.test(name), {
    message: 'The name may not contain control or direction characters',
  });

const AccessMinutesSchema = z
  .number()
  .int()
  .min(NATIVE_ACCESS_TOKEN_MINUTES.min)
  .max(NATIVE_ACCESS_TOKEN_MINUTES.max);

const LifetimeDaysSchema = z
  .number()
  .int()
  .min(NATIVE_LIFETIME_DAYS.min)
  .max(NATIVE_LIFETIME_DAYS.max);

/** What every new native client names, whatever its kind. */
const CREATE_COMMON = {
  slug: z.string().regex(NATIVE_CLIENT_SLUG_RE, 'Not a valid client slug'),
  hostKind: z.enum(NATIVE_CLIENT_HOST_KINDS),
  hostId: z.string().min(1).max(128),
  name: ClientNameSchema,
  accessTokenMinutes: AccessMinutesSchema.default(NATIVE_ACCESS_TOKEN_MINUTES.default),
  idleDays: LifetimeDaysSchema.default(NATIVE_LIFETIME_DAYS.idleDefault),
  absoluteDays: LifetimeDaysSchema.default(NATIVE_LIFETIME_DAYS.absoluteDefault),
  enabled: z.boolean().default(true),
};

const MobileClientCreateSchema = z
  .object({
    kind: z.literal('mobile'),
    ...CREATE_COMMON,
    redirectPaths: RedirectPathsSchema,
    associations: NativeAssociationsSchema.default({}),
  })
  .strict();

const DesktopClientCreateSchema = z
  .object({
    kind: z.literal('desktop'),
    ...CREATE_COMMON,
    loopbackPaths: LoopbackPathsSchema,
  })
  .strict();

/**
 * A new native client: its kind (`mobile` when absent — a 4.14 body is a
 * mobile client), its slug (the id is `lamaste-native-<slug>`), the
 * application host it belongs to, the name its consent screen shows, the
 * lifetimes (defaults 15 minutes, 30 days idle, 90 days absolute; idle
 * never longer than absolute), and by kind: a mobile client's redirect
 * paths on the host and, optionally, its app association setting; a
 * desktop client's loopback paths (no redirect paths, no associations —
 * refused as unknown keys).
 */
export const NativeClientCreateSchema = z.preprocess(
  (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value) && !('kind' in value)
      ? { ...value, kind: 'mobile' }
      : value,
  z
    .discriminatedUnion('kind', [MobileClientCreateSchema, DesktopClientCreateSchema])
    .refine((client) => client.idleDays <= client.absoluteDays, {
      message: 'idleDays must not exceed absoluteDays',
      path: ['idleDays'],
    }),
);

/** A new mobile client as written; `kind` may be left out. */
export type NativeMobileClientCreateInput = Omit<
  z.input<typeof MobileClientCreateSchema>,
  'kind'
> & { readonly kind?: 'mobile' };

/** A new desktop client as written. */
export type NativeDesktopClientCreateInput = z.input<typeof DesktopClientCreateSchema>;

export type NativeClientCreateInput =
  | NativeMobileClientCreateInput
  | NativeDesktopClientCreateInput;
export type NativeClientCreate =
  | z.output<typeof MobileClientCreateSchema>
  | z.output<typeof DesktopClientCreateSchema>;

/**
 * A change to a native client: any of its settings but its id, host and
 * kind (`kind` is refused as an unknown key — delete and create instead).
 * Whether idle stays within absolute is checked against the merged record
 * ({@link nativeClientLifetimesValid}); whether the change fits the
 * client's kind, with {@link nativeClientUpdateKindError}.
 */
export const NativeClientUpdateSchema = z
  .object({
    name: ClientNameSchema.optional(),
    redirectPaths: RedirectPathsSchema.optional(),
    loopbackPaths: LoopbackPathsSchema.optional(),
    accessTokenMinutes: AccessMinutesSchema.optional(),
    idleDays: LifetimeDaysSchema.optional(),
    absoluteDays: LifetimeDaysSchema.optional(),
    associations: NativeAssociationsSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((change) => Object.keys(change).length > 0, { message: 'Nothing to change' });

export type NativeClientUpdateInput = z.input<typeof NativeClientUpdateSchema>;
export type NativeClientUpdate = z.output<typeof NativeClientUpdateSchema>;

/** The settings only one kind of client has, by kind. */
const KIND_ONLY_SETTINGS: Readonly<Record<NativeClientKind, readonly string[]>> = Object.freeze({
  mobile: ['redirectPaths', 'associations'],
  desktop: ['loopbackPaths'],
});

/**
 * Why `change` does not fit a client of `kind`, or null when it does: a
 * mobile client takes no loopback paths, a desktop client no redirect
 * paths and no app association setting.
 */
export function nativeClientUpdateKindError(
  kind: NativeClientKind,
  change: Readonly<Record<string, unknown>>,
): string | null {
  const other: NativeClientKind = kind === 'mobile' ? 'desktop' : 'mobile';
  const misplaced = KIND_ONLY_SETTINGS[other].filter((key) => change[key] !== undefined);
  return misplaced.length === 0 ? null : `A ${kind} client has no ${misplaced.join(' or ')}`;
}

/** Whether a client's lifetimes hold together: idle never longer than absolute. */
export function nativeClientLifetimesValid(client: {
  readonly idleDays: number;
  readonly absoluteDays: number;
}): boolean {
  return client.idleDays <= client.absoluteDays;
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

/**
 * Why a grant ended (the broker, the standing checks, an administrator, the
 * app). `standing:<why>` reasons say which part of the person's standing
 * failed.
 */
export const NATIVE_GRANT_END_REASONS = Object.freeze([
  'idle_expired',
  'absolute_expired',
  'reuse',
  'issuer_refused',
  'revoked_by_client',
  'revoked_by_admin',
  'client_disabled',
  'client_deleted',
  'host_deleted',
  'standing:disabled',
  'standing:removed',
  'standing:erased',
  'standing:not_member',
  'standing:no_role',
  'standing:no_grant',
  'standing:cleanup_pending',
] as const);

export type NativeGrantEndReason = (typeof NATIVE_GRANT_END_REASONS)[number];

/** Whether `value` is a reason a grant ends for. */
export function isNativeGrantEndReason(value: unknown): value is NativeGrantEndReason {
  return (
    typeof value === 'string' && (NATIVE_GRANT_END_REASONS as readonly string[]).includes(value)
  );
}

/**
 * A device name an app gave its grant (`device_name` on the code exchange),
 * as the grant keeps it: trimmed, at most {@link NATIVE_DEVICE_NAME_MAX_LENGTH}
 * characters, no control or direction characters — or null when nothing
 * usable is left.
 */
export function nativeDeviceName(raw: unknown): string | null {
  return printableSummary(raw, NATIVE_DEVICE_NAME_MAX_LENGTH);
}

/**
 * The `User-Agent` summary a grant keeps: control and direction characters
 * dropped, whitespace collapsed, cut at {@link NATIVE_USER_AGENT_MAX_LENGTH}
 * — or null.
 */
export function nativeUserAgentSummary(raw: unknown): string | null {
  return printableSummary(raw, NATIVE_USER_AGENT_MAX_LENGTH);
}

function printableSummary(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(new RegExp(CONTROL_RE.source, 'g'), ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return null;
  return Array.from(cleaned).slice(0, max).join('').trim();
}

// ---------------------------------------------------------------------------
// Gatekeeper's projection
// ---------------------------------------------------------------------------

/**
 * The panel's projection of the served native clients for Gatekeeper
 * (`<stateDir>/native-apps.json`, 0600): which client belongs to which
 * host. Gatekeeper admits a bearer token on a host only for the client the
 * projection names there.
 */
export const NATIVE_APPS_PROJECTION_FILE = 'native-apps.json';

/** One served native client as the projection lists it. */
export interface NativeAppsProjectionClient {
  readonly clientId: string;
  /** Its kind (`mobile` when a projection written before kinds names none). */
  readonly kind: NativeClientKind;
  /** The application host's name, lower case. */
  readonly fqdn: string;
  /** The relay domain the host is under (its issuer is `https://auth.<domain>`). */
  readonly domain: string;
}

const PROJECTION_HOST_RE =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * The projection, read defensively: `{ v: 1, clients: [...] }` with every
 * entry a native client id, a kind (`mobile` when absent), a host under its
 * domain, `enabled: true`; null for anything else — a missing or malformed
 * projection refuses every bearer token. A host has at most one client of
 * each kind: a host listed twice for one kind, or a client id listed twice,
 * is left out (two answers to "whose client is this" mean no one's).
 */
export function parseNativeAppsProjection(parsed: unknown): NativeAppsProjectionClient[] | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const p = parsed as { v?: unknown; clients?: unknown };
  if (p.v !== 1 || !Array.isArray(p.clients)) return null;
  const out: NativeAppsProjectionClient[] = [];
  for (const entry of p.clients as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const { clientId, fqdn, domain, enabled } = e;
    const kind = e['kind'] ?? 'mobile';
    if (enabled !== true || !isNativeClientId(clientId) || !isNativeClientKind(kind)) continue;
    if (typeof fqdn !== 'string' || typeof domain !== 'string') continue;
    const host = fqdn.toLowerCase();
    const base = domain.toLowerCase();
    if (!PROJECTION_HOST_RE.test(host) || !PROJECTION_HOST_RE.test(base)) continue;
    if (!host.endsWith(`.${base}`)) continue;
    out.push({ clientId, kind, fqdn: host, domain: base });
  }
  const count = (match: (c: NativeAppsProjectionClient) => boolean): number =>
    out.filter(match).length;
  return out.filter(
    (c) =>
      count((x) => x.fqdn === c.fqdn && x.kind === c.kind) === 1 &&
      count((x) => x.clientId === c.clientId) === 1,
  );
}

/** The served native clients of the host `fqdn` (any case) — at most one of each kind. */
export function nativeClientsOfHost(
  clients: readonly NativeAppsProjectionClient[],
  fqdn: string,
): NativeAppsProjectionClient[] {
  const name = fqdn.toLowerCase();
  return clients.filter((c) => c.fqdn === name);
}

/** The served native client of `kind` (default `mobile`) of the host `fqdn` (any case), or null. */
export function nativeClientOfHost(
  clients: readonly NativeAppsProjectionClient[],
  fqdn: string,
  kind: NativeClientKind = 'mobile',
): NativeAppsProjectionClient | null {
  return nativeClientsOfHost(clients, fqdn).find((c) => c.kind === kind) ?? null;
}
