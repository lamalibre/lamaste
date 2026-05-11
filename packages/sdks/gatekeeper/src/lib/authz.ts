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
