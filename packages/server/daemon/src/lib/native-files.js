/**
 * What an application host with a native client serves to anyone
 * (native-apps-design.md D6): the app association files and the static page
 * at the client's redirect paths, written by the panel under
 * {@link NATIVE_FILES_ROOT}`/<fqdn>/` and named by the host's vhost
 * (`nginx.js` `nativeAppLocations`).
 *
 * - `apple-app-site-association` — only when the client names an iOS app:
 *   its bundles, and only the redirect paths as universal-link components
 *   (core `renderAppleAppSiteAssociation`);
 * - `assetlinks.json` — only when it names an Android app (core
 *   `renderAssetLinks`);
 * - `redirect.html` — the page a browser that reaches a redirect path gets
 *   (core `renderNativeRedirectPage`), in the domain's language and brand.
 *
 * Only served clients get files (enabled, their host present, under an
 * active domain); a host's directory goes when its client is no longer
 * served. Files are 0640 and directories 0750 under the web root, whose
 * setgid group (`www-data`) nginx reads with; each file is replaced by a
 * rename, only when its content changed.
 */

import crypto from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, rename, rm, unlink } from 'node:fs/promises';
import path from 'node:path';

import { renderAppleAppSiteAssociation, renderAssetLinks } from '@lamalibre/lamaste';
import { renderNativeRedirectPage } from '@lamalibre/lamaste/server';

import { NATIVE_FILES } from './nginx.js';

/** Where the native clients' hosts keep their files. */
export const NATIVE_FILES_ROOT =
  process.env.LAMALIBRE_LAMASTE_NATIVE_FILES_ROOT || '/var/www/lamaste/native';

const FILE_MODE = 0o640;
const DIR_MODE = 0o750;
/** A host's directory name: its fqdn, lower case. */
const HOST_DIR_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;

let deps = null;

/**
 * Replace the served clients' source (tests).
 *
 * @param {{ listNativeClients?: () => Promise<object[]>, pageInputsOf?: (domain: string) => Promise<object>, root?: string } | null} override
 */
export function setNativeFilesDepsForTests(override) {
  deps = override;
}

async function servedClients() {
  if (deps?.listNativeClients) return (await deps.listNativeClients()).filter((c) => c.served);
  const { listNativeClients } = await import('./native-apps.js');
  return (await listNativeClients()).filter((c) => c.served && c.fqdn && c.domain);
}

async function pageInputs(domain) {
  if (deps?.pageInputsOf) return deps.pageInputsOf(domain);
  const { pageInputsOf } = await import('./auth-branding.js');
  return pageInputsOf(domain);
}

function root() {
  return deps?.root ?? NATIVE_FILES_ROOT;
}

/** The directory of the host `fqdn`'s files. Throws on a name no host can have. */
export function nativeFilesDir(fqdn) {
  const name = String(fqdn).toLowerCase();
  if (!HOST_DIR_RE.test(name) || name.includes('..')) {
    throw new Error(`Not a host name: ${fqdn}`);
  }
  return path.join(root(), name);
}

/**
 * What the vhost of host `fqdn` serves for its native client — the files'
 * directory, the redirect paths, and which association files exist — or
 * null when the host has no served native client.
 *
 * @param {string} fqdn
 * @returns {Promise<{ dir: string, redirectPaths: string[], appleAppSiteAssociation: boolean, assetLinks: boolean } | null>}
 */
export async function nativeHostOf(fqdn) {
  const name = String(fqdn).toLowerCase();
  const client = (await servedClients()).find((c) => c.fqdn === name);
  if (!client) return null;
  return {
    dir: nativeFilesDir(name),
    redirectPaths: [...client.redirectPaths],
    appleAppSiteAssociation: Boolean(client.associations?.ios),
    assetLinks:
      Array.isArray(client.associations?.android) && client.associations.android.length > 0,
  };
}

/** The files of one served client: name → content. */
async function filesOf(client) {
  const files = new Map();
  const aasa = renderAppleAppSiteAssociation(client.associations, client.redirectPaths);
  if (aasa) files.set(NATIVE_FILES.appleAppSiteAssociation, `${JSON.stringify(aasa)}\n`);
  const links = renderAssetLinks(client.associations);
  if (links) files.set(NATIVE_FILES.assetLinks, `${JSON.stringify(links)}\n`);
  const { brand, language } = await pageInputs(client.domain);
  files.set(
    NATIVE_FILES.redirectPage,
    renderNativeRedirectPage({ brand, language, domain: client.domain }),
  );
  return files;
}

async function readIfFile(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile()) return null;
    return await readFile(file, 'utf-8');
  } catch {
    return null;
  }
}

/** Write `content` at `file` unless it holds it already: a new 0640 file, then a rename. */
async function writeIfChanged(file, content) {
  if ((await readIfFile(file)) === content) return false;
  const tmp = `${file}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  const fh = await open(tmp, 'wx', FILE_MODE);
  try {
    await fh.writeFile(content, 'utf-8');
    await fh.chmod(FILE_MODE);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  return true;
}

/**
 * Bring every host's files in line with the served native clients: each
 * served client's files written (only those that changed), files it no
 * longer has removed, the directories of hosts without one removed.
 * Returns the hosts whose files changed. Throws on a write failure (the
 * callers log it; the next sync tries again).
 *
 * @param {{ logger?: import('pino').Logger }} [opts]
 * @returns {Promise<string[]>}
 */
export async function syncNativeAppFiles({ logger } = {}) {
  const clients = await servedClients();
  const base = root();
  await mkdir(base, { recursive: true, mode: DIR_MODE });
  const changed = [];
  const keep = new Set();
  for (const client of clients) {
    const dir = nativeFilesDir(client.fqdn);
    keep.add(path.basename(dir));
    await mkdir(dir, { recursive: true, mode: DIR_MODE });
    const files = await filesOf(client);
    let touched = false;
    for (const [name, content] of files) {
      if (await writeIfChanged(path.join(dir, name), content)) touched = true;
    }
    for (const name of Object.values(NATIVE_FILES)) {
      if (!files.has(name) && (await readIfFile(path.join(dir, name))) !== null) {
        await unlink(path.join(dir, name));
        touched = true;
      }
    }
    if (touched) changed.push(client.fqdn);
  }
  for (const entry of await readdir(base)) {
    if (keep.has(entry) || !HOST_DIR_RE.test(entry)) continue;
    await rm(path.join(base, entry), { recursive: true, force: true });
    changed.push(entry);
  }
  if (changed.length > 0) logger?.info({ hosts: changed.length }, 'Native app files written');
  return changed;
}
