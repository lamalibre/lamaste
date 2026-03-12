import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version once at module load time — not on every request
let version = '0.0.0';
try {
  const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
  version = pkg.version || '0.0.0';
} catch {
  // If package.json can't be read, use fallback version
}

export default async function healthRoutes(fastify, _opts) {
  fastify.get('/health', async (_request, _reply) => {
    return { status: 'ok', version };
  });
}
