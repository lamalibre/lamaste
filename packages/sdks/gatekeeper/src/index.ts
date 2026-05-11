// Types
export type {
  Group,
  GroupState,
  CreateGroupOptions,
  UpdateGroupOptions,
  DeleteGroupResult,
  Grant,
  GrantState,
  CreateGrantOptions,
  GrantFilter,
  AccessAllowed,
  AccessDenied,
  AccessResult,
  AccessRequestTemplates,
  TemplateOptions,
  GatekeeperSettings,
  AccessRequestEntry,
  TunnelInfo,
  AutheliaSession,
  GatekeeperLogger,
} from './lib/types.js';

// Constants
export {
  PRINCIPAL_TYPES,
  RESOURCE_TYPES,
  ACCESS_MODES,
  RESERVED_GROUP_NAMES,
  MAX_GROUPS,
  MAX_GRANTS,
  GRANT_RETENTION_MS,
  SESSION_CACHE_TTL_MS,
  GROUP_NAME_REGEX,
  MAX_GROUP_NAME_LENGTH,
  MIN_GROUP_NAME_LENGTH,
  DEFAULT_DATA_DIR,
  GROUPS_FILE,
  GRANTS_FILE,
  SETTINGS_FILE,
  ACCESS_LOG_FILE,
  AUTHELIA_VERIFY_URL,
  GATEKEEPER_PORT,
} from './lib/constants.js';

export type { PrincipalType, ResourceType, AccessMode } from './lib/constants.js';

// Groups
export {
  createGroup,
  listGroups,
  getGroup,
  updateGroup,
  deleteGroup,
  addMembers,
  removeMembers,
  getGroupsForUser,
} from './lib/groups.js';

// Grants
export {
  createGrant,
  listGrants,
  getGrant,
  revokeGrant,
  consumeGrant,
  removeGrantsByPredicate,
  removeGrantsByPrincipal,
} from './lib/grants.js';

// Authorization
export { checkAccess } from './lib/authz.js';

// Templates
export { getAccessRequestTemplates, buildAccessRequestPage } from './lib/templates.js';

// Migration
export { migrateFromLegacy } from './lib/migration.js';
