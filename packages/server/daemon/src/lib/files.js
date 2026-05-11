/**
 * Shim — static site filesystem helpers now live in
 * `@lamalibre/lamaste/server`. This file wires the daemon's execa instance
 * to the parameterized core API.
 */

import { execa } from 'execa';
import {
  SITES_ROOT,
  ALLOWED_EXTENSIONS,
  validateFileExtension,
  validatePath,
  getSiteRoot,
  createSiteDirectory as createSiteDirectoryCore,
  removeSiteDirectory as removeSiteDirectoryCore,
  listFiles as listFilesCore,
  saveUploadedFile as saveUploadedFileCore,
  deleteFile as deleteFileCore,
  getSiteSize as getSiteSizeCore,
} from '@lamalibre/lamaste/server';

// Re-export pure helpers unchanged
export { SITES_ROOT, ALLOWED_EXTENSIONS, validateFileExtension, validatePath, getSiteRoot };

export function createSiteDirectory(siteId, siteName) {
  return createSiteDirectoryCore(siteId, siteName, execa);
}

export function removeSiteDirectory(siteId) {
  return removeSiteDirectoryCore(siteId, execa);
}

export function listFiles(siteId, relativePath = '.') {
  return listFilesCore(siteId, relativePath, execa);
}

export function saveUploadedFile(siteId, relativePath, fileStream) {
  return saveUploadedFileCore(siteId, relativePath, fileStream, execa);
}

export function deleteFile(siteId, relativePath) {
  return deleteFileCore(siteId, relativePath, execa);
}

export function getSiteSize(siteId) {
  return getSiteSizeCore(siteId, execa);
}
