/**
 * Re-exports the static site filesystem helpers from
 * `@lamalibre/lamaste/server`. They need no privileges: the web root belongs
 * to the lamaste user (group www-data, for nginx).
 */

export {
  SITES_ROOT,
  ALLOWED_EXTENSIONS,
  validateFileExtension,
  validatePath,
  getSiteRoot,
  createSiteDirectory,
  removeSiteDirectory,
  listFiles,
  saveUploadedFile,
  deleteFile,
  getSiteSize,
} from '@lamalibre/lamaste/server';
