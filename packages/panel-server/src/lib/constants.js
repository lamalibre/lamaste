/**
 * Core API route prefixes reserved from plugin use.
 * Shared across plugin installation, plugin routing, and ticket scope registration.
 */
export const RESERVED_API_PREFIXES = [
  'health', 'onboarding', 'invite', 'enroll', 'tunnels', 'sites', 'system',
  'services', 'logs', 'users', 'certs', 'invitations', 'plugins', 'tickets', 'settings',
  'identity', 'storage', 'agents',
];
