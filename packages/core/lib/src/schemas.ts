/**
 * Shared Zod schemas — unified plugin manifest validation.
 *
 * Single source of truth for the three prior copies in:
 * - serverd/src/lib/plugins.js
 * - lamaste-agent/src/lib/agent-plugins.js
 * - lamaste-agent/src/lib/local-plugins.js
 */

import semver from 'semver';
import { z } from 'zod';
import {
  APPHOST_ROUTE_RE,
  AgentHalfPackageNameSchema,
  AgentServiceEntrySchema,
  AgentServiceMemoryMaxSchema,
  SystemPackageNameSchema,
} from './agent-half.js';
import {
  CORE_CAPABILITY_NAMESPACES,
  DEFAULT_PLUGIN_HOSTING,
  OIDC_USER_FACTORS,
  PLUGIN_CAPABILITY_NAMESPACE,
  PLUGIN_HOSTINGS,
  PLUGIN_CAPABILITY_REGEX,
  derivePluginRoute,
  pluginCapabilityRegexFor,
} from './constants.js';
import {
  HOOK_EFFECT_TYPES,
  HOOK_TIMEOUTS,
  POST_FORWARD_ON_ERROR,
  PRE_FORWARD_ON_ERROR,
  REQUEST_HOOKS_MAX,
  REQUEST_HOOK_MAX_BODY_BYTES,
  REQUEST_HOOK_ROUTES_MAX,
  REQUEST_STAGES,
  SECRET_SCAN_ACTIONS,
  SECRET_SCAN_HOOK,
  SECRET_SCAN_ON_UNSCANNABLE,
  SECRET_SCAN_PACK_NAMES,
  SHARED_HOOKS,
  parseRoutePattern,
} from './hooks/index.js';
import { IdentityBlockSchema } from './identity.js';
import { SettingsBlockSchema } from './plugin-settings.js';
import { UserSurfaceBlockSchema } from './web-surface.js';

// ---------------------------------------------------------------------------
// Capability string
// ---------------------------------------------------------------------------

/**
 * Plugin- and ticket-scope-contributed capability string.
 *
 * Plugins MUST namespace every capability they declare under
 * `plugin:<short-name>:<action>` where `<short-name>` matches the route
 * derived from the manifest's `name` field via {@link derivePluginRoute}.
 *
 * The schema enforces:
 *   1. Top-level prefix is exactly `plugin:` — no plugin can invent a new
 *      top-level namespace (e.g. `admin:write` is rejected even if it does
 *      not yet exist as a base capability).
 *   2. The string matches {@link PLUGIN_CAPABILITY_REGEX}.
 *   3. The middle segment is not one of {@link CORE_CAPABILITY_NAMESPACES} —
 *      defense-in-depth in case `derivePluginRoute` ever returned a core scope.
 *
 * Cross-checking the `<short-name>` segment against the manifest's actual
 * route is enforced at the manifest level (see {@link ManifestSchema}). This
 * standalone schema cannot perform that check because it does not know which
 * plugin is declaring the capability.
 */
export const CapabilityStringSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(
    (val) => PLUGIN_CAPABILITY_REGEX.test(val),
    `Plugin capabilities must match "${PLUGIN_CAPABILITY_NAMESPACE}:<short-name>:<action>" (lowercase alphanumeric with optional internal hyphens)`,
  )
  .refine((val) => {
    const segments = val.split(':');
    const middle = segments[1];
    return (
      middle !== undefined && !(CORE_CAPABILITY_NAMESPACES as readonly string[]).includes(middle)
    );
  }, 'Plugin capability short-name must not collide with a reserved core namespace');

// ---------------------------------------------------------------------------
// Panel page (multi-page panel declaration)
// ---------------------------------------------------------------------------

export const PanelPageSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(200)
    .regex(
      /^\/[a-z0-9-/]*$/,
      'Page path must start with / and contain only lowercase letters, numbers, hyphens, and slashes',
    ),
  title: z.string().min(1).max(100),
  icon: z.string().max(50).optional(),
  description: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// OIDC clients a plugin registers on the relay's Authelia
// ---------------------------------------------------------------------------

/** OAuth 2.0 grant types a plugin client may use. */
export const OIDC_GRANT_TYPES = [
  'urn:ietf:params:oauth:grant-type:device_code',
  'authorization_code',
  'refresh_token',
  'client_credentials',
] as const;

export type OidcGrantType = (typeof OIDC_GRANT_TYPES)[number];

/**
 * Claims a client may ask to have copied into its JWT access tokens, and the
 * scope each one needs. Authelia puts `groups`, `preferred_username`, `name`
 * and `email` in the UserInfo response by default; a resource server that
 * verifies the access token offline (Feria mapping `groups` to registry
 * scopes) needs them in the token, which takes a claims policy
 * (`identity_providers.oidc.claims_policies.<client>.access_token`) — and a
 * claim is only copied "provided the relevant scope was granted".
 */
export const OIDC_ACCESS_TOKEN_CLAIM_SCOPES = {
  groups: 'groups',
  preferred_username: 'profile',
  name: 'profile',
  email: 'email',
} as const;

export const OIDC_ACCESS_TOKEN_CLAIMS = Object.keys(OIDC_ACCESS_TOKEN_CLAIM_SCOPES) as [
  keyof typeof OIDC_ACCESS_TOKEN_CLAIM_SCOPES,
  ...(keyof typeof OIDC_ACCESS_TOKEN_CLAIM_SCOPES)[],
];

export type OidcAccessTokenClaim = keyof typeof OIDC_ACCESS_TOKEN_CLAIM_SCOPES;

/** Scopes a client whose only grant is `client_credentials` may not carry (Authelia refuses them). */
const OIDC_USER_ONLY_SCOPES: readonly string[] = ['openid', 'offline', 'offline_access'];

/**
 * An OIDC client declared by a plugin manifest — e.g. a CLI that logs in
 * through the relay's Authelia with the device-code flow, or a service that
 * authenticates with the client-credentials grant. Lamaste writes it into
 * `identity_providers.oidc.clients` when the plugin is enabled and removes
 * it when the plugin is disabled or uninstalled.
 *
 * A client is public (no secret, `token_endpoint_auth_method: none`) unless
 * `confidential` is set. For a confidential client Lamaste generates the
 * secret itself when the client first appears: Authelia's configuration
 * receives only its pbkdf2 digest, the plaintext is stored at
 * `<stateDir>/oidc-clients.json` (0600), returned once by the install or
 * enable response, and again by `rotate-secret`.
 */
export const OidcClientSchema = z
  .object({
    /** Must be the plugin's route or `<route>-<suffix>` — enforced at the manifest level. */
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'Client id must be lowercase letters, numbers and hyphens'),
    name: z.string().min(1).max(100).optional(),
    grantTypes: z.array(z.enum(OIDC_GRANT_TYPES)).min(1).max(OIDC_GRANT_TYPES.length),
    scopes: z
      .array(z.string().regex(/^[a-z_]+$/, 'Scope names are lowercase letters and underscores'))
      .min(1)
      .max(20)
      .default(['openid']),
    /** Audiences the client may request; `{domain}` is replaced with the relay domain. */
    audience: z.array(z.string().min(1).max(300)).max(10).default([]),
    redirectUris: z.array(z.string().url()).max(10).default([]),
    /** `RS256` makes access tokens JWTs (RFC 9068) a resource server can verify offline. */
    accessTokenSignedResponseAlg: z.enum(['none', 'RS256']).default('RS256'),
    /** Claims copied into JWT access tokens through a per-client claims policy. */
    accessTokenClaims: z
      .array(z.enum(OIDC_ACCESS_TOKEN_CLAIMS))
      .max(OIDC_ACCESS_TOKEN_CLAIMS.length)
      .default([]),
    /**
     * `one_factor` or `two_factor` for the user-facing grants. A client with
     * the `client_credentials` grant has no end user: Authelia requires
     * `one_factor` there, which is the default for such a client.
     */
    authorizationPolicy: z.enum(OIDC_USER_FACTORS).optional(),
    requirePkce: z.boolean().default(false),
    /** A confidential client authenticates to the token endpoint with a Lamaste-generated secret. */
    confidential: z.boolean().default(false),
  })
  .superRefine((client, ctx) => {
    const grants = new Set<string>(client.grantTypes);
    const clientCredentials = grants.has('client_credentials');
    if (clientCredentials && !client.confidential) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grantTypes'],
        message: 'The client_credentials grant requires a confidential client',
      });
    }
    if (grants.has('authorization_code') && client.redirectUris.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['redirectUris'],
        message: 'The authorization_code grant requires at least one redirect URI',
      });
    }
    // A client is a service (client_credentials alone) or a user-facing
    // client, never both: Authelia gives a client_credentials client
    // one_factor, never a domain's member policy, so a user grant beside it
    // would admit any account of the relay. Declare two clients.
    const userGrants = client.grantTypes.filter((g) => g !== 'client_credentials');
    if (clientCredentials && userGrants.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grantTypes'],
        message: `The client_credentials grant must be a client's only grant (declare ${userGrants.join(', ')} on a second, user-facing client)`,
      });
    }
    // Authelia (validator/identity_providers.go, v4.39.28) applies both
    // rules whenever client_credentials is among the grants, not only when
    // it is the sole grant.
    if (clientCredentials) {
      const forbidden = client.scopes.filter((s) => OIDC_USER_ONLY_SCOPES.includes(s));
      if (forbidden.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scopes'],
          message: `A client with the client_credentials grant may not have the scopes ${forbidden.join(', ')}`,
        });
      }
      if (client.authorizationPolicy === 'two_factor') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['authorizationPolicy'],
          message:
            'A client with the client_credentials grant has no end user: its authorizationPolicy must be one_factor (the default for such a client)',
        });
      }
    }
    if (new Set(client.accessTokenClaims).size !== client.accessTokenClaims.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accessTokenClaims'],
        message: 'accessTokenClaims must not repeat a claim',
      });
    }
    client.accessTokenClaims.forEach((claim, idx) => {
      const needed = OIDC_ACCESS_TOKEN_CLAIM_SCOPES[claim];
      if (!client.scopes.includes(needed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['accessTokenClaims', idx],
          message: `Access token claim "${claim}" needs the "${needed}" scope, which the client does not declare`,
        });
      }
    });
  })
  .transform((client) => ({
    ...client,
    authorizationPolicy:
      client.authorizationPolicy ??
      (client.grantTypes.includes('client_credentials') ? 'one_factor' : 'two_factor'),
  }));

export type OidcClientDeclaration = z.infer<typeof OidcClientSchema>;

// ---------------------------------------------------------------------------
// Agent block (agent-hosted plugins with an agent half)
// ---------------------------------------------------------------------------

/** Operating systems an agent half may require of its hosting agent. */
export const AGENT_HALF_OS = ['linux', 'darwin'] as const;

/**
 * What the agent half requires of its hosting agent, checked against the
 * agent's reported host facts ({@link HostFactsSchema}) when a plugin is
 * hosted (see `hostEligibility`). Hosting an agent half that was installed
 * by hand checks nothing.
 */
export const AgentRequiresSchema = z
  .object({
    /** A semver range for Node.js on the hosting agent, e.g. ">=22". */
    node: z
      .string()
      .min(1)
      .max(50)
      .refine(
        (range) => /^[0-9A-Za-z .<>=^~|*x-]+$/.test(range) && semver.validRange(range) !== null,
        'node must be a semver range',
      )
      .optional(),
    os: z.array(z.enum(AGENT_HALF_OS)).min(1).max(AGENT_HALF_OS.length).optional(),
    /**
     * System packages the agent half needs. Lamaste installs them (apt-get,
     * after approval) when it installs the agent half (`package`); for an
     * agent half installed by hand they are listed for the operator.
     */
    systemPackages: z.array(SystemPackageNameSchema).max(50).optional(),
  })
  .strict();

export type AgentRequires = z.infer<typeof AgentRequiresSchema>;

/**
 * How Lamaste runs an agent half it installs: the package's entry file as a
 * hardened systemd service (see `APPHOST_PATHS` and `appUnitName`).
 */
export const AgentServiceSchema = z
  .object({
    /** The service's entry, a path inside the agent package (`dist/agentd.js`). */
    entry: AgentServiceEntrySchema,
    /** The unit's `MemoryMax=`; unset — no limit. */
    memoryMax: AgentServiceMemoryMaxSchema.optional(),
  })
  .strict();

/**
 * The `agent` block of an agent-hosted plugin: present when the plugin has
 * an agent half Lamaste connects to through an internal plugin tunnel. The
 * port is assigned by Lamaste when the plugin is hosted, so the block does
 * not name one. With `package` (and `service`) Lamaste installs the agent
 * half onto the hosting agent itself; without, the agent half is installed
 * by hand. See `plugin-development/design/agent-hosted-app-plugins.md`.
 */
export const AgentBlockSchema = z
  .object({
    requires: AgentRequiresSchema.optional(),
    /** The agent half's package — one self-contained tarball, published at the plugin's version. */
    package: AgentHalfPackageNameSchema.optional(),
    /** How the agent half runs; required with `package`, and only with it. */
    service: AgentServiceSchema.optional(),
  })
  .strict()
  .superRefine((block, ctx) => {
    if (block.package !== undefined && block.service === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['service'],
        message: '"package" needs "service": how Lamaste runs the agent half it installs',
      });
    }
    if (block.service !== undefined && block.package === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['package'],
        message: '"service" needs "package": the agent half Lamaste installs',
      });
    }
  });

export type AgentBlock = z.infer<typeof AgentBlockSchema>;

// ---------------------------------------------------------------------------
// Host facts (what an agent reports about its host, for `agent.requires`)
// ---------------------------------------------------------------------------

const DISTRO_ID_RE = /^[a-z0-9._-]{1,40}$/;
const NODE_VERSION_RE = /^\d+\.\d+\.\d+$/;

/**
 * What an agent reports about its host on each sync (when it changed), kept
 * on its record so the relay can tell which agents can host a plugin.
 */
export const HostFactsSchema = z
  .object({
    os: z.enum(AGENT_HALF_OS),
    arch: z.string().regex(/^[a-z0-9_]{1,20}$/),
    /** From `/etc/os-release` (`ID`, `ID_LIKE`, `VERSION_ID`); null when there is none (macOS). */
    distro: z
      .object({
        id: z.string().regex(DISTRO_ID_RE),
        idLike: z.array(z.string().regex(DISTRO_ID_RE)).max(10),
        versionId: z.string().regex(/^[A-Za-z0-9._-]{0,40}$/),
      })
      .nullable(),
    /**
     * The Node.js version the agent runs (`22.13.1`) — what an agent half
     * installed by hand is checked against (it runs however the operator
     * runs it).
     */
    node: z.string().regex(NODE_VERSION_RE),
    /** Whether systemd is the system manager (PID 1). */
    systemd: z.boolean(),
    /**
     * The app host helper; null — it is not enabled. `version` is its
     * protocol; `node` the Node.js version it runs on, which is the one an
     * agent half Lamaste installs runs on (the unit's `ExecStart`);
     * `relayKid` the id of the relay key the helper verifies this agent's
     * app jobs with (`apphost enable|pin` pinned it), null when none is
     * pinned for it.
     */
    apphost: z
      .object({
        version: z.number().int().min(1),
        node: z.string().regex(NODE_VERSION_RE),
        relayKid: z
          .string()
          .regex(/^[a-f0-9]{32}$/)
          .nullable(),
      })
      .nullable(),
  })
  .strict();

export type HostFacts = z.infer<typeof HostFactsSchema>;

// ---------------------------------------------------------------------------
// Lifecycle hooks (agent-hosted plugins with an agent half)
// ---------------------------------------------------------------------------

const timeoutSchema = (max: number) => z.number().int().min(1).max(max);

const LifecycleStageSchema = z
  .object({ timeoutMs: timeoutSchema(HOOK_TIMEOUTS.lifecycle.max).optional() })
  .strict();
const TunnelStageSchema = z
  .object({ timeoutMs: timeoutSchema(HOOK_TIMEOUTS.tunnel.max).optional() })
  .strict();
const AgentStageSchema = z
  .object({ timeoutMs: timeoutSchema(HOOK_TIMEOUTS.agent.max).optional() })
  .strict();

/** A request hook route pattern, `"POST /admin/import/*"` (see `@lamalibre/lamaste/hooks`). */
export const RoutePatternSchema = z.string().superRefine((raw, ctx) => {
  const parsed = parseRoutePattern(raw);
  if ('error' in parsed) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.error });
  }
});

/** Settings of the shared `lamaste:secret-scan` hook (`with`): Lamaste rule packs only. */
export const SecretScanConfigSchema = z
  .object({
    action: z.enum(SECRET_SCAN_ACTIONS).optional(),
    packs: z
      .array(z.enum(SECRET_SCAN_PACK_NAMES))
      .min(1)
      .max(SECRET_SCAN_PACK_NAMES.length)
      .refine((packs) => new Set(packs).size === packs.length, 'packs must not repeat')
      .optional(),
    onUnscannable: z.enum(SECRET_SCAN_ON_UNSCANNABLE).optional(),
  })
  .strict();

export const RequestHookSchema = z
  .object({
    stage: z.enum(REQUEST_STAGES),
    routes: z.array(RoutePatternSchema).min(1).max(REQUEST_HOOK_ROUTES_MAX),
    /** The hook sees the body, buffered up to `maxBytes`. Without it the hook sees none. */
    body: z
      .object({ maxBytes: z.number().int().min(1).max(REQUEST_HOOK_MAX_BODY_BYTES) })
      .strict()
      .optional(),
    timeoutMs: timeoutSchema(HOOK_TIMEOUTS.request.max).optional(),
    /** Fail closed by default: `reject` (pre-forward) / `block` (post-forward). */
    onError: z.enum([...PRE_FORWARD_ON_ERROR, ...POST_FORWARD_ON_ERROR]).optional(),
    /** A body larger than `body.maxBytes`: `reject` / `block` by default. */
    onOversize: z.enum([...PRE_FORWARD_ON_ERROR, ...POST_FORWARD_ON_ERROR]).optional(),
    /** A shared hook shipped by Lamaste instead of the plugin's own module. */
    use: z.enum(SHARED_HOOKS).optional(),
    /** The shared hook's settings. */
    with: z.record(z.unknown()).optional(),
  })
  .strict()
  .superRefine((hook, ctx) => {
    const allowed: readonly string[] =
      hook.stage === 'pre-forward' ? PRE_FORWARD_ON_ERROR : POST_FORWARD_ON_ERROR;
    for (const key of ['onError', 'onOversize'] as const) {
      const value = hook[key];
      if (value !== undefined && !allowed.includes(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} of a ${hook.stage} hook is one of ${allowed.join(', ')}`,
        });
      }
    }
    if (hook.with !== undefined && hook.use === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['with'],
        message: '"with" configures a shared hook — name it with "use"',
      });
    }
    if (hook.use === SECRET_SCAN_HOOK) {
      if (hook.stage !== 'post-forward') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stage'],
          message: `${SECRET_SCAN_HOOK} scans responses: its stage is post-forward`,
        });
      }
      if (hook.body === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['body'],
          message: `${SECRET_SCAN_HOOK} needs the response body: declare body.maxBytes`,
        });
      }
      const settings = SecretScanConfigSchema.safeParse(hook.with ?? {});
      if (!settings.success) {
        for (const issue of settings.error.issues) {
          ctx.addIssue({ ...issue, path: ['with', ...issue.path] });
        }
      }
    }
  });

export type RequestHookDeclaration = z.infer<typeof RequestHookSchema>;

const RelayHooksSchema = z
  .object({
    /**
     * The plugin's relay hook module, inside its relay package: one
     * self-contained ES module (Node built-ins only), run by Lamaste's hook
     * runner and never imported by the panel.
     */
    entry: z
      .string()
      .min(1)
      .max(200)
      .regex(
        /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._/-]+\.(?:mjs|js)$/,
        'entry is a relative path to a .mjs or .js file inside the package',
      )
      .optional(),
    /** Effect types the plugin's own hooks may return; anything else is dropped. */
    effects: z
      .array(z.enum(HOOK_EFFECT_TYPES))
      .max(HOOK_EFFECT_TYPES.length)
      .refine((e) => new Set(e).size === e.length, 'effects must not repeat')
      .optional(),
    install: z
      .object({
        'pre-tunnel': LifecycleStageSchema.optional(),
        'post-tunnel': LifecycleStageSchema.optional(),
      })
      .strict()
      .optional(),
    uninstall: z
      .object({
        'pre-teardown': LifecycleStageSchema.optional(),
        'post-teardown': LifecycleStageSchema.optional(),
      })
      .strict()
      .optional(),
    request: z.array(RequestHookSchema).max(REQUEST_HOOKS_MAX).optional(),
    tunnel: z
      .object({ down: TunnelStageSchema.optional(), up: TunnelStageSchema.optional() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((relay, ctx) => {
    const ownHooks =
      Object.keys(relay.install ?? {}).length +
      Object.keys(relay.uninstall ?? {}).length +
      Object.keys(relay.tunnel ?? {}).length +
      (relay.request ?? []).filter((h) => h.use === undefined).length;
    if (ownHooks > 0 && relay.entry === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entry'],
        message: 'Relay hooks of the plugin itself need "entry", the module that implements them',
      });
    }
    if (ownHooks === 0 && relay.entry !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entry'],
        message: '"entry" is set but no relay hook of the plugin itself is declared',
      });
    }
  });

const AgentHooksSchema = z
  .object({
    install: z
      .object({
        'pre-tunnel': AgentStageSchema.optional(),
        'post-tunnel': AgentStageSchema.optional(),
      })
      .strict()
      .optional(),
    uninstall: z
      .object({
        'pre-teardown': AgentStageSchema.optional(),
        'post-teardown': AgentStageSchema.optional(),
      })
      .strict()
      .optional(),
    tunnel: z
      .object({ down: AgentStageSchema.optional(), up: AgentStageSchema.optional() })
      .strict()
      .optional(),
  })
  .strict();

/**
 * The `hooks` block of an agent-hosted plugin with an agent half: code that
 * runs around Lamaste's own steps — relay hooks in Lamaste's sandboxed hook
 * runner, agent hooks in the agent half (`POST /admin/hooks/<stage>`). See
 * `plugin-development/design/agent-hosted-app-plugins.md`, "Slice 2 design".
 */
export const HooksBlockSchema = z
  .object({
    relay: RelayHooksSchema.optional(),
    agent: AgentHooksSchema.optional(),
  })
  .strict();

export type HooksBlock = z.infer<typeof HooksBlockSchema>;

// ---------------------------------------------------------------------------
// Plugin manifest
// ---------------------------------------------------------------------------

export const ManifestSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(100)
      .regex(
        /^[a-z0-9-]+$/,
        'Plugin name must contain only lowercase letters, numbers, and hyphens',
      ),
    displayName: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[\x20-\x7E]+$/, 'Display name must contain only printable ASCII characters')
      .optional(),
    version: z.string().min(1).max(50),
    description: z.string().max(500).optional().default(''),
    capabilities: z.array(CapabilityStringSchema).max(50).optional().default([]),
    packages: z
      .object({
        server: z
          .string()
          .min(1)
          .regex(/^@lamalibre\//, 'Server package must be in the @lamalibre/ scope')
          .optional(),
        agent: z
          .string()
          .min(1)
          .regex(/^@lamalibre\//, 'Agent package must be in the @lamalibre/ scope')
          .optional(),
      })
      .optional()
      .default({}),
    // The multi-page shape comes first: a union returns its first match and
    // a non-strict object strips unknown keys, so with the flat shape first
    // `{ pages: [...] }` parsed as `{}` and a plugin's pages were lost.
    panel: z
      .union([
        z.object({
          pages: z
            .array(PanelPageSchema)
            .min(1)
            .max(50)
            .refine(
              (pages) => new Set(pages.map((p) => p.path)).size === pages.length,
              'Page paths must be unique within a plugin',
            ),
          apiPrefix: z
            .string()
            .max(200)
            .regex(/^\/api\/[a-z0-9-]+$/)
            .optional(),
        }),
        z.object({
          label: z.string().min(1).max(100).optional(),
          icon: z.string().max(50).optional(),
          route: z.string().max(200).optional(),
        }),
      ])
      .optional()
      .default({}),
    config: z
      .record(
        z
          .string()
          .min(1)
          .max(100)
          .regex(
            /^[a-zA-Z][a-zA-Z0-9_-]*$/,
            'Config key must start with a letter and contain only letters, numbers, hyphens, and underscores',
          ),
        z
          .object({
            type: z.enum(['string', 'number', 'boolean']),
            default: z.union([z.string(), z.number(), z.boolean()]).optional(),
            description: z.string().max(500).optional(),
            enum: z
              .array(z.union([z.string(), z.number()]))
              .max(100)
              .optional(),
          })
          .refine(
            (entry) => {
              if (entry.default === undefined) return true;
              return typeof entry.default === entry.type;
            },
            { message: 'Config default value must match declared type' },
          ),
      )
      .optional()
      .default({})
      .refine((val) => Object.keys(val).length <= 50, {
        message: 'Config must have at most 50 keys',
      }),
    modes: z
      .array(z.enum(['server', 'agent', 'local']))
      .min(1)
      .optional()
      .default(['server', 'agent']),
    oidcClients: z.array(OidcClientSchema).max(10).optional().default([]),
    /**
     * Where the plugin's code runs — see `PLUGIN_HOSTINGS`. An agent-hosted
     * plugin is never imported by Lamaste; only its declarations
     * (`oidcClients`, `capabilities`) take effect.
     */
    hosting: z.enum(PLUGIN_HOSTINGS).optional().default(DEFAULT_PLUGIN_HOSTING),
    /**
     * The agent half of an agent-hosted plugin (see `AgentBlockSchema`).
     * Only meaningful — and only accepted — with `hosting: "agent"`.
     */
    agent: AgentBlockSchema.optional(),
    /**
     * Lifecycle hooks (see `HooksBlockSchema`). Only for an agent-hosted
     * plugin with an agent half — the pipelines they plug into exist only
     * around a hosting.
     */
    hooks: HooksBlockSchema.optional(),
    /**
     * What an admin configures (see `SettingsBlockSchema`). Only with an
     * agent half: the agent half stores the values, the relay a cache.
     */
    settings: SettingsBlockSchema.optional(),
    /**
     * The plugin's roles and the user attributes it may receive (see
     * `IdentityBlockSchema`). Only with an agent half: its users reach the
     * agent half's `/app/*`, and the agent half keeps their projection.
     */
    identity: IdentityBlockSchema.optional(),
    /**
     * How the plugin's end users reach it (see `UserSurfaceBlockSchema`):
     * its web surface, a static shell the relay serves on the plugin's own
     * site. Only with an agent half and `identity` — the shell is the front
     * of the agent half's `/app/*`.
     */
    userSurface: UserSurfaceBlockSchema.optional(),
  })
  .superRefine((manifest, ctx) => {
    if (manifest.agent !== undefined && manifest.hosting !== 'agent') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agent'],
        message: 'An "agent" block needs "hosting": "agent" — a server plugin has no agent half',
      });
    }

    if (manifest.hooks !== undefined && (manifest.hosting !== 'agent' || !manifest.agent)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hooks'],
        message:
          'Lifecycle hooks need an agent-hosted plugin with an agent half ("hosting": "agent" and an "agent" block)',
      });
    }

    if (manifest.settings !== undefined && manifest.agent === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['settings'],
        message: 'settings needs an agent block',
      });
    }

    if (manifest.identity !== undefined && (manifest.hosting !== 'agent' || !manifest.agent)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['identity'],
        message:
          'identity needs an agent-hosted plugin with an agent half ("hosting": "agent" and an "agent" block) — its users reach the agent half',
      });
    }

    if (manifest.userSurface !== undefined && manifest.identity === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['userSurface'],
        message:
          "userSurface needs identity (and so an agent-hosted plugin with an agent half) — its shell calls the agent half's /app/*, which knows its users only through identity",
      });
    }

    // The agent's root helper names the agent half's account, unit and
    // directories after the route, and accepts only a route without a
    // leading or trailing hyphen.
    if (
      manifest.agent?.package !== undefined &&
      !APPHOST_ROUTE_RE.test(derivePluginRoute(manifest.name))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message:
          'A plugin whose agent half Lamaste installs needs a route that starts and ends with a letter or digit',
      });
    }

    // An agent-hosted plugin has no code in the panel, so nothing could
    // serve a page or a panel bundle for it — unless it has an agent half:
    // then the panel forwards `/api/<route>/*` (the bundle included) to the
    // agent half over the internal plugin tunnel. Without the block a panel
    // declaration is a manifest error, not something to drop silently.
    if (
      manifest.hosting === 'agent' &&
      manifest.agent === undefined &&
      Object.keys(manifest.panel).length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['panel'],
        message:
          'An agent-hosted plugin ("hosting": "agent") without an "agent" block cannot declare a panel — Lamaste does not load its code',
      });
    }

    // A plugin may only register OIDC clients in its own namespace: the
    // client id is its route or `<route>-<suffix>`. Stops one plugin from
    // claiming `feria-cli`.
    const pluginRoute = derivePluginRoute(manifest.name);
    const seen = new Set<string>();
    manifest.oidcClients.forEach((client, idx) => {
      if (client.id !== pluginRoute && !client.id.startsWith(`${pluginRoute}-`)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['oidcClients', idx, 'id'],
          message: `OIDC client id "${client.id}" must be "${pluginRoute}" or start with "${pluginRoute}-"`,
        });
      }
      if (seen.has(client.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['oidcClients', idx, 'id'],
          message: `OIDC client id "${client.id}" is declared twice`,
        });
      }
      seen.add(client.id);
    });

    // Each declared capability's `<short-name>` segment must match the route
    // derived from the manifest's `name` field. Stops a manifest like
    // `@lamalibre/herd-server` (route "herd") from claiming
    // `plugin:shell:connect` and stealing the shell plugin's namespace.
    if (manifest.capabilities.length === 0) return;
    const route = derivePluginRoute(manifest.name);
    const expected = pluginCapabilityRegexFor(route);
    manifest.capabilities.forEach((cap, idx) => {
      if (!expected.test(cap)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['capabilities', idx],
          message: `Capability "${cap}" must use the plugin's own namespace "${PLUGIN_CAPABILITY_NAMESPACE}:${route}:<action>"`,
        });
      }
    });
  });

/** Inferred type from the manifest schema after parsing. */
export type ParsedManifest = z.infer<typeof ManifestSchema>;

// ---------------------------------------------------------------------------
// Package name validation
// ---------------------------------------------------------------------------

/**
 * Schema for validating a `@lamalibre/`-scoped package name.
 * Rejects path traversal patterns in the portion after the scope.
 */
export const LamaPackageNameSchema = z
  .string()
  .min(1)
  .startsWith('@lamalibre/')
  .refine(
    (val) => /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(val.slice('@lamalibre/'.length)),
    'Invalid package name after @lamalibre/ scope',
  );

/**
 * A plugin manifest that does not satisfy {@link ManifestSchema}. Callers
 * check for it with `instanceof` against this class, never against zod's
 * `ZodError`: a workspace or an install can hold more than one copy of zod,
 * and an error from one copy is not an instance of another's class.
 */
export class ManifestValidationError extends Error {
  /** Each problem, with the dotted path of the field it is about (`""` for the root). */
  readonly issues: readonly { readonly path: string; readonly message: string }[];

  constructor(issues: readonly { readonly path: string; readonly message: string }[]) {
    super(`Invalid plugin manifest: ${issues.map((i) => i.message).join(', ')}`);
    this.name = 'ManifestValidationError';
    this.issues = issues;
  }
}

/**
 * Validate a raw plugin manifest against the schema.
 *
 * @param raw - The raw manifest object
 * @returns The validated and parsed manifest
 * @throws {ManifestValidationError} If validation fails
 */
export function validateManifest(raw: unknown): ParsedManifest {
  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new ManifestValidationError(
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
