/**
 * Shared Zod schemas — unified plugin manifest validation.
 *
 * Single source of truth for the three prior copies in:
 * - serverd/src/lib/plugins.js
 * - lamaste-agent/src/lib/agent-plugins.js
 * - lamaste-agent/src/lib/local-plugins.js
 */

import { z } from 'zod';
import {
  CORE_CAPABILITY_NAMESPACES,
  PLUGIN_CAPABILITY_NAMESPACE,
  PLUGIN_CAPABILITY_REGEX,
  derivePluginRoute,
  pluginCapabilityRegexFor,
} from './constants.js';

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
    panel: z
      .union([
        z.object({
          label: z.string().min(1).max(100).optional(),
          icon: z.string().max(50).optional(),
          route: z.string().max(200).optional(),
        }),
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
  })
  .superRefine((manifest, ctx) => {
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
 * Validate a raw plugin manifest against the schema.
 *
 * @param raw - The raw manifest object
 * @returns The validated and parsed manifest
 * @throws {z.ZodError} If validation fails
 */
export function validateManifest(raw: unknown): ParsedManifest {
  return ManifestSchema.parse(raw);
}
