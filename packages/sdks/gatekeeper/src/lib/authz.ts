import { listGrants } from './grants.js';
import { getGroupsForUser } from './groups.js';
import { getAccessRequestTemplates } from './templates.js';
import type { AccessResult, TemplateOptions } from './types.js';

/**
 * Check if a user has access to a resource.
 *
 * Resolution order:
 * 1. Direct user grants (principalType='user', principalId=username)
 * 2. Group grants (principalType='group', principalId in user's Lamaste groups)
 *
 * @param username - The Authelia username to check
 * @param resourceType - The resource type (e.g., 'tunnel', 'plugin')
 * @param resourceId - The resource identifier (e.g., tunnel UUID, plugin name)
 * @param templateOptions - Options for generating access request templates
 * @returns AccessResult indicating allowed/denied with templates if denied
 */
export async function checkAccess(
  username: string,
  resourceType: string,
  resourceId: string,
  templateOptions?: TemplateOptions,
): Promise<AccessResult> {
  // Get all grants matching this resource
  const resourceGrants = await listGrants({ resourceType, resourceId });

  // Check 1: Direct user grant
  const hasUserGrant = resourceGrants.some(
    (g) => g.principalType === 'user' && g.principalId === username,
  );
  if (hasUserGrant) {
    return { allowed: true };
  }

  // Check 2: Group grant — resolve user's Lamaste groups
  const userGroups = await getGroupsForUser(username);
  if (userGroups.length > 0) {
    const groupGrants = resourceGrants.filter((g) => g.principalType === 'group');
    const hasGroupGrant = groupGrants.some((g) => userGroups.includes(g.principalId));
    if (hasGroupGrant) {
      return { allowed: true };
    }
  }

  // Denied — generate templates
  const templates = getAccessRequestTemplates(username, resourceId, templateOptions);

  return {
    allowed: false,
    resource: { type: resourceType, id: resourceId },
    templates,
  };
}

/**
 * The roles a grant carries as an entitlement — its `context.roles` when
 * that is a non-empty list of strings — or null. The panel's rule
 * (`entitlements.js` `grantRoles`): a grant without roles (a desktop's
 * local-install grant, one migrated from `user-plugin-access.json`) never
 * makes anyone a member of a plugin's audience.
 */
function entitlementRoles(context: Record<string, unknown> | undefined): string[] | null {
  const roles = context?.['roles'];
  if (!Array.isArray(roles) || roles.length === 0) return null;
  return roles.every((role) => typeof role === 'string') ? (roles as string[]) : null;
}

/**
 * Whether `username` is in the audience of the plugin at `route`: an
 * entitlement — a `plugin` grant on the route with roles — to the user or
 * to one of their Lamaste groups. What a plugin's web surface asks before it
 * serves the shell; the panel decides again, from its directory, on every
 * request to the plugin's API (a disabled or removed user, a plugin not
 * ready).
 */
export async function isPluginAudienceMember(username: string, route: string): Promise<boolean> {
  const entitlements = (await listGrants({ resourceType: 'plugin', resourceId: route })).filter(
    (g) => entitlementRoles(g.context) !== null,
  );
  if (entitlements.some((g) => g.principalType === 'user' && g.principalId === username)) {
    return true;
  }
  if (!entitlements.some((g) => g.principalType === 'group')) return false;
  const groups = await getGroupsForUser(username);
  return entitlements.some((g) => g.principalType === 'group' && groups.includes(g.principalId));
}
