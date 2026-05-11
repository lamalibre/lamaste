/**
 * Service discovery — port scanning, process detection, Docker container discovery.
 *
 * Ported from the Tauri desktop app's services.rs. Uses execa for subprocess
 * calls (optional peer dependency — dynamically imported).
 *
 * Service registry: ~/.lamalibre/lamaste/services.json
 */

import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { atomicWriteJSON } from '../file-helpers.js';
import { SERVICES_REGISTRY_PATH } from './platform.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectConfig {
  binary?: string | undefined;
  processName?: string | undefined;
}

export interface ServiceDefinition {
  id: string;
  name: string;
  defaultPort: number;
  category: string;
  description: string;
  detect: DetectConfig;
  custom?: boolean | undefined;
}

export interface ServiceRegistry {
  services: ServiceDefinition[];
}

export interface DetectedService {
  id: string;
  name: string;
  category: string;
  description: string;
  defaultPort: number;
  detectedPort: number | null;
  status: 'not_found' | 'installed' | 'running';
  source: 'builtin' | 'custom';
  tunnelId: string | null;
  tunnelFqdn: string | null;
}

export interface DockerPort {
  hostPort: number;
  containerPort: number;
  protocol: string;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  ports: DockerPort[];
  status: string;
  tunnelId: string | null;
  tunnelFqdn: string | null;
}

export interface ScanResult {
  services: DetectedService[];
  dockerContainers: DockerContainer[];
}

export interface TunnelInfo {
  id?: string | undefined;
  port?: number | undefined;
  fqdn?: string | undefined;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CUSTOM_SERVICES = 100;
const MAX_NAME_LEN = 64;
const MAX_DESCRIPTION_LEN = 256;
const VALID_CATEGORIES = ['ai', 'database', 'dev', 'media', 'monitoring', 'custom'] as const;

export type ServiceCategory = (typeof VALID_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function validateBinaryName(name: string): void {
  if (name.length === 0 || name.length > MAX_NAME_LEN) {
    throw new Error(`Binary name must be 1-${MAX_NAME_LEN} characters`);
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error(
      'Binary name may only contain alphanumeric characters, dots, underscores, and hyphens',
    );
  }
}

function validateProcessName(name: string): void {
  if (name.length === 0 || name.length > 128) {
    throw new Error('Process name must be 1-128 characters');
  }
  // Custom process names are restricted to a safe charset to avoid regex injection
  // (pgrep -f interprets the pattern as extended regex).
  if (!/^[a-zA-Z0-9._ -]+$/.test(name)) {
    throw new Error(
      'Process name may only contain alphanumeric characters, dots, underscores, hyphens, and spaces',
    );
  }
}

/**
 * Sanitize a service name into a valid ID.
 * Lowercases, replaces non-alphanumeric with hyphens, collapses and trims hyphens.
 */
export function sanitizeId(name: string): string {
  const raw = name.toLowerCase().replace(/[^a-z0-9]/g, '-');

  let id = '';
  let lastWasHyphen = true; // treat start as hyphen to trim leading
  for (const c of raw) {
    if (c === '-') {
      if (!lastWasHyphen) {
        id += '-';
      }
      lastWasHyphen = true;
    } else {
      id += c;
      lastWasHyphen = false;
    }
  }
  // Trim trailing hyphen
  while (id.endsWith('-')) {
    id = id.slice(0, -1);
  }

  if (id.length === 0) {
    throw new Error('Name must contain at least one alphanumeric character');
  }

  return id;
}

// ---------------------------------------------------------------------------
// Validate a service definition's detect fields (tampered registry defense)
// ---------------------------------------------------------------------------

function validateServiceDetect(def: ServiceDefinition): boolean {
  if (def.detect.binary) {
    try {
      validateBinaryName(def.detect.binary);
    } catch {
      return false;
    }
  }
  // Custom services must pass strict process name validation.
  // Builtin services may use regex patterns (e.g., "python.*comfyui")
  // which are hardcoded and trusted.
  if (def.custom === true && def.detect.processName) {
    try {
      validateProcessName(def.detect.processName);
    } catch {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Default registry
// ---------------------------------------------------------------------------

function defaultRegistry(): ServiceRegistry {
  return {
    services: [
      {
        id: 'ollama',
        name: 'Ollama',
        defaultPort: 11434,
        category: 'ai',
        description: 'Local large language model server',
        detect: { binary: 'ollama', processName: 'ollama' },
      },
      {
        id: 'comfyui',
        name: 'ComfyUI',
        defaultPort: 8188,
        category: 'ai',
        description: 'Node-based Stable Diffusion GUI',
        detect: { processName: 'python.*comfyui' },
      },
      {
        id: 'lm-studio',
        name: 'LM Studio',
        defaultPort: 1234,
        category: 'ai',
        description: 'Desktop app for running local LLMs',
        detect: { processName: 'LM Studio' },
      },
      {
        id: 'sd-webui',
        name: 'Stable Diffusion WebUI',
        defaultPort: 7860,
        category: 'ai',
        description: 'AUTOMATIC1111 Stable Diffusion web interface',
        detect: { processName: 'webui.py' },
      },
      {
        id: 'open-webui',
        name: 'Open WebUI',
        defaultPort: 3000,
        category: 'ai',
        description: 'Web interface for local LLMs',
        detect: { binary: 'open-webui', processName: 'open-webui' },
      },
      {
        id: 'localai',
        name: 'LocalAI',
        defaultPort: 8080,
        category: 'ai',
        description: 'Self-hosted OpenAI-compatible API',
        detect: { binary: 'local-ai', processName: 'local-ai' },
      },
      {
        id: 'jupyter',
        name: 'Jupyter',
        defaultPort: 8888,
        category: 'dev',
        description: 'Interactive notebook environment',
        detect: { binary: 'jupyter', processName: 'jupyter' },
      },
      {
        id: 'vscode-server',
        name: 'VS Code Server',
        defaultPort: 8080,
        category: 'dev',
        description: 'Browser-based VS Code',
        detect: { binary: 'code-server', processName: 'code-server' },
      },
      {
        id: 'n8n',
        name: 'n8n',
        defaultPort: 5678,
        category: 'dev',
        description: 'Workflow automation platform',
        detect: { binary: 'n8n', processName: 'n8n' },
      },
      {
        id: 'grafana',
        name: 'Grafana',
        defaultPort: 3000,
        category: 'monitoring',
        description: 'Observability and dashboarding platform',
        detect: { binary: 'grafana-server', processName: 'grafana-server' },
      },
      {
        id: 'home-assistant',
        name: 'Home Assistant',
        defaultPort: 8123,
        category: 'media',
        description: 'Home automation platform',
        detect: { processName: 'hass' },
      },
      {
        id: 'plex',
        name: 'Plex',
        defaultPort: 32400,
        category: 'media',
        description: 'Media server and streaming platform',
        detect: { processName: 'Plex Media Server' },
      },
      {
        id: 'minio',
        name: 'MinIO',
        defaultPort: 9000,
        category: 'database',
        description: 'S3-compatible object storage',
        detect: { binary: 'minio', processName: 'minio' },
      },
      {
        id: 'postgresql',
        name: 'PostgreSQL',
        defaultPort: 5432,
        category: 'database',
        description: 'Relational database',
        detect: { binary: 'psql', processName: 'postgres' },
      },
      {
        id: 'redis',
        name: 'Redis',
        defaultPort: 6379,
        category: 'database',
        description: 'In-memory data store',
        detect: { binary: 'redis-cli', processName: 'redis-server' },
      },
      {
        id: 'mongodb',
        name: 'MongoDB',
        defaultPort: 27017,
        category: 'database',
        description: 'Document database',
        detect: { binary: 'mongosh', processName: 'mongod' },
      },
      {
        id: 'elasticsearch',
        name: 'Elasticsearch',
        defaultPort: 9200,
        category: 'database',
        description: 'Search and analytics engine',
        detect: { processName: 'elasticsearch' },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Registry I/O
// ---------------------------------------------------------------------------

/** Load the service registry. Falls back to defaults if missing or corrupt. */
export async function loadServiceRegistry(): Promise<ServiceRegistry> {
  try {
    const raw = await readFile(SERVICES_REGISTRY_PATH, 'utf-8');
    const reg = JSON.parse(raw) as ServiceRegistry;
    if (!Array.isArray(reg.services)) {
      throw new Error('Invalid registry format');
    }
    // Strip any entries that fail validation (tampered file defense)
    reg.services = reg.services.filter(validateServiceDetect);
    return reg;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Corrupt registry — fall through to defaults
    }
  }

  const registry = defaultRegistry();
  await saveServiceRegistry(registry).catch(() => {});
  return registry;
}

/** Save the service registry atomically. */
export async function saveServiceRegistry(registry: ServiceRegistry): Promise<void> {
  await atomicWriteJSON(SERVICES_REGISTRY_PATH, registry, {
    mkdirp: true,
    dirMode: 0o700,
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/**
 * TCP probe — attempt to connect to 127.0.0.1:port with a 200ms timeout.
 */
export function tcpProbe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 200);

    socket.connect(port, '127.0.0.1', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Find a process PID by name using pgrep -f.
 * Filters out our own PID to avoid self-matching.
 */
export async function findProcessPid(processName: string): Promise<number | null> {
  try {
    const { execa } = await import('execa');
    const { stdout } = await execa('pgrep', ['-f', processName], { timeout: 5000 });

    const ownPid = process.pid;
    for (const line of stdout.split('\n')) {
      const pid = parseInt(line.trim(), 10);
      if (!Number.isNaN(pid) && pid > 0 && pid !== ownPid) {
        return pid;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Find the listening port for a given PID using lsof.
 */
export async function findListeningPort(pid: number): Promise<number | null> {
  try {
    const { execa } = await import('execa');
    const { stdout } = await execa('lsof', ['-anP', '-iTCP', '-sTCP:LISTEN', '-p', String(pid)], {
      timeout: 5000,
    });

    // Parse lsof output — skip header line
    // Format: process PID user FD type device size/off node name
    // The name column contains e.g. *:11434 or 127.0.0.1:8080
    const lines = stdout.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const parts = line.split(/\s+/);
      const name = parts[parts.length - 1];
      if (!name) continue;
      const portStr = name.split(':').pop();
      if (portStr) {
        const port = parseInt(portStr, 10);
        if (!Number.isNaN(port) && port > 0 && port <= 65535) {
          return port;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a binary is installed using `which`.
 */
export async function isBinaryInstalled(binary: string): Promise<boolean> {
  try {
    const { execa } = await import('execa');
    const result = await execa('which', [binary], { timeout: 5000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Service detection
// ---------------------------------------------------------------------------

/**
 * Detect the status and port of a single service definition.
 */
export async function detectService(def: ServiceDefinition): Promise<DetectedService> {
  let status: DetectedService['status'] = 'not_found';
  let detectedPort: number | null = null;

  // Step 1: Check if binary is installed via `which`
  const installed = def.detect.binary ? await isBinaryInstalled(def.detect.binary) : false;

  // Step 2: Check if process is running via `pgrep` and find its port
  let running = false;
  if (def.detect.processName) {
    const pid = await findProcessPid(def.detect.processName);
    if (pid !== null) {
      running = true;
      // Step 3: Find actual port via lsof
      detectedPort = await findListeningPort(pid);
      if (detectedPort === null) {
        // Fallback: probe default port
        const probeResult = await tcpProbe(def.defaultPort);
        if (probeResult) {
          detectedPort = def.defaultPort;
        }
      }
    }
  }

  // Step 4: If not found via process, try TCP probe on default port
  if (!running && detectedPort === null) {
    const probeResult = await tcpProbe(def.defaultPort);
    if (probeResult) {
      detectedPort = def.defaultPort;
      status = 'running';
    }
  }

  if (running) {
    status = 'running';
  } else if (status !== 'running' && installed) {
    status = 'installed';
  }

  return {
    id: def.id,
    name: def.name,
    category: def.category,
    description: def.description,
    defaultPort: def.defaultPort,
    detectedPort,
    status,
    source: def.custom === true ? 'custom' : 'builtin',
    tunnelId: null,
    tunnelFqdn: null,
  };
}

// ---------------------------------------------------------------------------
// Docker scanning
// ---------------------------------------------------------------------------

/**
 * Parse Docker port mappings from `docker ps` output.
 * Format: 0.0.0.0:8080->80/tcp or :::8080->80/tcp
 */
export function parseDockerPorts(portStr: string): DockerPort[] {
  const ports: DockerPort[] = [];

  for (const mapping of portStr.split(', ')) {
    const arrowPos = mapping.indexOf('->');
    if (arrowPos === -1) continue;

    const hostPart = mapping.slice(0, arrowPos);
    const containerPart = mapping.slice(arrowPos + 2);

    const hostPortStr = hostPart.split(':').pop();
    const hostPort = hostPortStr ? parseInt(hostPortStr, 10) : NaN;

    const slashPos = containerPart.indexOf('/');
    let containerPort: number;
    let protocol: string;
    if (slashPos !== -1) {
      containerPort = parseInt(containerPart.slice(0, slashPos), 10);
      protocol = containerPart.slice(slashPos + 1);
    } else {
      containerPort = parseInt(containerPart, 10);
      protocol = 'tcp';
    }

    if (!Number.isNaN(hostPort) && !Number.isNaN(containerPort)) {
      ports.push({ hostPort, containerPort, protocol });
    }
  }

  return ports;
}

/**
 * Scan running Docker containers.
 */
export async function scanDocker(): Promise<DockerContainer[]> {
  try {
    const { execa } = await import('execa');
    const { stdout } = await execa(
      'docker',
      ['ps', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'],
      { timeout: 10_000 },
    );

    const containers: DockerContainer[] = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length < 5) continue;

      containers.push({
        id: parts[0]!,
        name: parts[1]!,
        image: parts[2]!,
        ports: parseDockerPorts(parts[3]!),
        status: parts[4]!,
        tunnelId: null,
        tunnelFqdn: null,
      });
    }

    return containers;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tunnel matching
// ---------------------------------------------------------------------------

/**
 * Match detected services and Docker containers against known tunnels.
 */
export function matchTunnels(
  services: DetectedService[],
  containers: DockerContainer[],
  tunnels: TunnelInfo[],
): void {
  for (const service of services) {
    const portToMatch = service.detectedPort ?? service.defaultPort;
    const tunnel = tunnels.find((t) => t.port === portToMatch);
    if (tunnel) {
      service.tunnelId = tunnel.id ?? null;
      service.tunnelFqdn = tunnel.fqdn ?? null;
    }
  }

  for (const container of containers) {
    for (const port of container.ports) {
      const tunnel = tunnels.find((t) => t.port === port.hostPort);
      if (tunnel) {
        container.tunnelId = tunnel.id ?? null;
        container.tunnelFqdn = tunnel.fqdn ?? null;
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Full scan
// ---------------------------------------------------------------------------

/**
 * Scan all services and Docker containers, then match against tunnels.
 */
export async function scanServices(tunnels: TunnelInfo[] = []): Promise<ScanResult> {
  const registry = await loadServiceRegistry();

  // Run service detection and Docker scan in parallel
  const [services, dockerContainers] = await Promise.all([
    Promise.all(registry.services.map(detectService)),
    scanDocker(),
  ]);

  matchTunnels(services, dockerContainers, tunnels);

  return { services, dockerContainers };
}

// ---------------------------------------------------------------------------
// Custom service management
// ---------------------------------------------------------------------------

/**
 * Add a custom service to the registry.
 */
export async function addCustomService(opts: {
  name: string;
  port: number;
  binary?: string | undefined;
  processName?: string | undefined;
  category: string;
  description: string;
}): Promise<ServiceDefinition> {
  if (opts.name.length === 0 || opts.name.length > MAX_NAME_LEN) {
    throw new Error(`Name must be 1-${MAX_NAME_LEN} characters`);
  }
  if (opts.description.length > MAX_DESCRIPTION_LEN) {
    throw new Error(`Description must be at most ${MAX_DESCRIPTION_LEN} characters`);
  }
  if (!(VALID_CATEGORIES as readonly string[]).includes(opts.category)) {
    throw new Error(`Category must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }
  if (opts.binary) validateBinaryName(opts.binary);
  if (opts.processName) validateProcessName(opts.processName);

  const id = sanitizeId(opts.name);

  const def: ServiceDefinition = {
    id,
    name: opts.name,
    defaultPort: opts.port,
    category: opts.category,
    description: opts.description,
    detect: {
      binary: opts.binary,
      processName: opts.processName,
    },
    custom: true,
  };

  const registry = await loadServiceRegistry();

  const customCount = registry.services.filter((s) => s.custom === true).length;
  if (customCount >= MAX_CUSTOM_SERVICES) {
    throw new Error(`Maximum of ${MAX_CUSTOM_SERVICES} custom services reached`);
  }

  if (registry.services.some((s) => s.id === id)) {
    throw new Error(`Service with id '${id}' already exists`);
  }

  registry.services.push(def);
  await saveServiceRegistry(registry);
  return def;
}

/**
 * Remove a custom service from the registry.
 * Built-in services cannot be removed.
 */
export async function removeCustomService(id: string): Promise<void> {
  const registry = await loadServiceRegistry();
  const idx = registry.services.findIndex((s) => s.id === id);
  if (idx === -1) {
    throw new Error(`Service '${id}' not found`);
  }
  if (registry.services[idx]!.custom !== true) {
    throw new Error(`Cannot remove built-in service '${id}'`);
  }

  registry.services.splice(idx, 1);
  await saveServiceRegistry(registry);
}
