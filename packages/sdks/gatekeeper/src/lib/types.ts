import type { PrincipalType, AccessMode } from './constants.js';

/**
 * A Lamaste access control group.
 */
export interface Group {
  readonly name: string;
  readonly description: string;
  readonly members: readonly string[];
  readonly createdAt: string;
  readonly createdBy: string;
}

/**
 * Mutable group state (internal).
 */
export interface GroupState {
  name: string;
  description: string;
  members: string[];
  createdAt: string;
  createdBy: string;
}

/**
 * Options for creating a group.
 */
export interface CreateGroupOptions {
  readonly description?: string | undefined;
  readonly createdBy?: string | undefined;
}

/**
 * Options for updating a group.
 */
export interface UpdateGroupOptions {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
}

/**
 * Result of deleting a group.
 */
export interface DeleteGroupResult {
  readonly deletedGrants: number;
}

/**
 * A generic access grant binding a principal to a resource.
 */
export interface Grant {
  readonly grantId: string;
  readonly principalType: PrincipalType;
  readonly principalId: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly context: Record<string, unknown>;
  readonly used: boolean;
  readonly createdAt: string;
  readonly usedAt: string | null;
}

/**
 * Mutable grant state (internal).
 */
export interface GrantState {
  grantId: string;
  principalType: PrincipalType;
  principalId: string;
  resourceType: string;
  resourceId: string;
  context: Record<string, unknown>;
  used: boolean;
  createdAt: string;
  usedAt: string | null;
}

/**
 * Options for creating a grant.
 */
export interface CreateGrantOptions {
  readonly principalType: PrincipalType;
  readonly principalId: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly context?: Record<string, unknown>;
}

/**
 * Filter for listing grants.
 */
export interface GrantFilter {
  readonly principalType?: PrincipalType | undefined;
  readonly principalId?: string | undefined;
  readonly resourceType?: string | undefined;
  readonly resourceId?: string | undefined;
  readonly used?: boolean | undefined;
}

/**
 * Result of an access check.
 */
export interface AccessAllowed {
  readonly allowed: true;
}

export interface AccessDenied {
  readonly allowed: false;
  readonly resource: {
    readonly type: string;
    readonly id: string;
  };
  readonly templates: AccessRequestTemplates;
}

export type AccessResult = AccessAllowed | AccessDenied;

/**
 * Pre-filled message templates for access requests.
 */
export interface AccessRequestTemplates {
  readonly email: { readonly subject: string; readonly body: string };
  readonly slack: string;
  readonly teams: string;
  readonly whatsapp: string;
  readonly generic: string;
}

/**
 * A domain's brand as the pages Gatekeeper serves take it (read from the
 * domain's `brand.json` by `lib/brand.ts`): the name and the tagline for
 * the header, the accent for the colours, the logo's URL on the domain's
 * sign-in host (null when the brand serves none), and the support contact
 * shown instead of the settings' administrator e-mail.
 */
export interface PageBrand {
  readonly name: string;
  readonly tagline: string | null;
  /** `#rrggbb`, or null for the pages' own accent. */
  readonly accent: string | null;
  /** `https://auth.<domain>/static/media/logo.png`, or null. */
  readonly logoUrl: string | null;
  readonly supportEmail: string | null;
  /** `https:` only. */
  readonly supportUrl: string | null;
}

/**
 * Options for generating access request templates.
 */
export interface TemplateOptions {
  readonly adminContact?: string | undefined;
  readonly adminName?: string | undefined;
  readonly domain?: string | undefined;
  /** The brand of the host's domain; null or absent for the stock page. */
  readonly brand?: PageBrand | null | undefined;
}

/**
 * Gatekeeper service settings.
 */
export interface GatekeeperSettings {
  readonly adminEmail?: string | undefined;
  readonly adminName?: string | undefined;
  readonly slackChannel?: string | undefined;
  readonly teamsChannel?: string | undefined;
  readonly sessionCacheTtlMs?: number | undefined;
  readonly accessLoggingEnabled?: boolean | undefined;
  readonly accessLogRetentionDays?: number | undefined;
}

/**
 * An entry in the access request log.
 */
export interface AccessRequestEntry {
  readonly timestamp: string;
  readonly username: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly resourceFqdn: string;
}

/**
 * Tunnel info used by the authz check endpoint.
 */
export interface TunnelInfo {
  readonly id: string;
  readonly fqdn: string;
  readonly accessMode: AccessMode;
  readonly enabled: boolean;
  /**
   * Set on a plugin tunnel (`type: 'plugin'` with an owning agent): the
   * request goes to that agent's lamaste-agentd, which accepts the user only
   * with a relay assertion Gatekeeper signs (see authz.ts).
   */
  readonly plugin?: PluginTunnelTarget | undefined;
}

/** Where a plugin tunnel's requests go: the agent, its daemon's port, the plugin route. */
export interface PluginTunnelTarget {
  readonly agentLabel: string;
  readonly port: number;
  readonly route: string;
}

/**
 * Cached Authelia session data.
 */
export interface AutheliaSession {
  readonly username: string;
  readonly groups: string;
  readonly displayName: string;
  readonly email: string;
  readonly expiresAt: number;
}

/**
 * Logger interface (compatible with Fastify logger).
 */
export interface GatekeeperLogger {
  info(msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  warn(msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}
