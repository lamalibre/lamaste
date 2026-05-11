/**
 * Re-export core constants from @lamalibre/lamaste.
 *
 * During the transition, existing imports within lamaste-serverd continue
 * to resolve via this file. New code should import directly from the core
 * library.
 */
export { RESERVED_API_PREFIXES } from '@lamalibre/lamaste';
