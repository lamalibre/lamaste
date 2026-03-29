import { createWriteStream, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir, platform, arch } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execSync, spawn } from 'node:child_process';
import { get as httpsGet } from 'node:https';
import { get as httpGet } from 'node:http';

const REPO = 'lamalibre/portlama';
const CACHE_DIR = join(homedir(), '.portlama', 'desktop');

// Map platform+arch to the suffix pattern used in Tauri asset names
const PLATFORM_SUFFIXES = {
  'darwin-arm64': '_aarch64.dmg',
  'darwin-x64': '_x64.dmg',
  'linux-x64': '_amd64.AppImage',
  'linux-arm64': '_aarch64.AppImage',
};

function detectPlatformSuffix() {
  const os = platform();
  const cpu = arch();
  const key = `${os}-${cpu}`;
  const suffix = PLATFORM_SUFFIXES[key];
  if (!suffix) throw new Error(`Unsupported platform: ${os} ${cpu}`);
  return { os, cpu, suffix };
}

async function getLatestRelease() {
  const url = `https://api.github.com/repos/${REPO}/releases?per_page=10`;
  const body = await fetchJson(url);
  const release = body.find((r) => r.tag_name && r.tag_name.startsWith('desktop-v'));
  if (!release) throw new Error('No desktop release found');
  return release;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https:') ? httpsGet : httpGet;
    get(url, { headers: { 'User-Agent': 'install-portlama-desktop' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON from ${url}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https:') ? httpsGet : httpGet;
    get(url, { headers: { 'User-Agent': 'install-portlama-desktop' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }

      const total = parseInt(res.headers['content-length'], 10) || 0;
      let downloaded = 0;

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = Math.round((downloaded / total) * 100);
          process.stdout.write(`\r  Downloading... ${pct}%`);
        }
      });

      const stream = createWriteStream(dest);
      pipeline(res, stream).then(() => {
        if (total > 0) process.stdout.write('\r  Downloading... done\n');
        resolve();
      }, reject);
    }).on('error', reject);
  });
}

async function installMacOS(dmgPath) {
  const appName = 'Portlama.app';
  const appsDir = '/Applications';
  const installedApp = join(appsDir, appName);

  console.log('  Mounting DMG...');
  const mountOutput = execSync(`hdiutil attach "${dmgPath}" -nobrowse`, {
    encoding: 'utf8',
  });

  // Find the mount point from hdiutil output — last line, last tab-separated field
  const mountLine = mountOutput.trim().split('\n').pop();
  const mountPoint = mountLine.split('\t').pop().trim();

  if (!mountPoint || !existsSync(mountPoint)) {
    throw new Error(`Failed to find DMG mount point in: ${mountOutput}`);
  }

  try {
    const appSource = join(mountPoint, appName);
    if (!existsSync(appSource)) {
      throw new Error(`${appName} not found in DMG at ${mountPoint}`);
    }

    // Remove old version if present
    if (existsSync(installedApp)) {
      console.log('  Removing previous version...');
      execSync(`rm -rf "${installedApp}"`);
    }

    console.log(`  Copying to ${appsDir}...`);
    execSync(`cp -R "${appSource}" "${appsDir}/"`);
  } finally {
    execSync(`hdiutil detach "${mountPoint}" -quiet`, { stdio: 'ignore' });
  }

  // Clear Gatekeeper quarantine attribute so the unsigned app can launch
  try {
    execSync(`xattr -rd com.apple.quarantine "${installedApp}"`, {
      stdio: 'ignore',
    });
  } catch {
    // Non-fatal — user can still right-click → Open
  }

  console.log(`  Installed to ${installedApp}`);
  console.log('  Launching...');
  spawn('open', [installedApp], { detached: true, stdio: 'ignore' }).unref();
}

async function installLinux(appImagePath) {
  chmodSync(appImagePath, 0o755);

  const binDir = join(homedir(), '.local', 'bin');
  mkdirSync(binDir, { recursive: true });

  const dest = join(binDir, 'portlama-desktop');
  execSync(`cp "${appImagePath}" "${dest}"`);
  chmodSync(dest, 0o755);

  console.log(`  Installed to ${dest}`);
  console.log(`  Make sure ${binDir} is in your PATH, then run: portlama-desktop`);
  console.log('  Launching...');
  spawn(dest, [], { detached: true, stdio: 'ignore' }).unref();
}

export async function install() {
  console.log('\n  Portlama Desktop Installer\n');

  const plat = detectPlatformSuffix();
  console.log(`  Platform: ${plat.os} ${plat.cpu}`);

  console.log('  Checking for latest release...');
  const release = await getLatestRelease();
  const tag = release.tag_name;
  const version = tag.replace('desktop-v', '');
  console.log(`  Latest: ${version}`);

  // Find the matching asset from the release
  const asset = release.assets.find((a) => a.name.endsWith(plat.suffix));
  if (!asset) {
    throw new Error(
      `No ${plat.suffix} asset found in release ${tag}. Available: ${release.assets.map((a) => a.name).join(', ')}`,
    );
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const cachedFile = join(CACHE_DIR, `${tag}-${asset.name}`);

  if (existsSync(cachedFile)) {
    console.log('  Using cached download');
  } else {
    console.log(`  Asset: ${asset.name}`);
    await download(asset.browser_download_url, cachedFile);
  }

  if (plat.os === 'darwin') {
    await installMacOS(cachedFile);
  } else {
    await installLinux(cachedFile);
  }

  console.log('\n  Done!\n');
}
