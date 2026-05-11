#!/usr/bin/env node
// ============================================================================
// create-lamaste-e2e — Installer + MCP server entry point
// ============================================================================
// Interactive (TTY):  Install mode — installs CLI + desktop (default), MCP (--mcp)
// Piped (stdio):      Server mode — runs as MCP server
//
// Usage:
//   npx @lamalibre/create-lamaste-e2e              # install CLI + desktop
//   npx @lamalibre/create-lamaste-e2e --mcp        # install CLI + desktop + MCP
//   npx @lamalibre/create-lamaste-e2e --cli-only   # install CLI only
//   npx @lamalibre/create-lamaste-e2e --install    # force install mode
//   npx @lamalibre/create-lamaste-e2e --server     # force MCP server mode
// ============================================================================

const args = process.argv.slice(2);
const forceInstall = args.includes('--install');
const forceServer = args.includes('--server');

try {
  if (forceServer) {
    await import('../src/index.js');
  } else if (forceInstall || process.stdin.isTTY) {
    const { install } = await import('../src/install.js');
    await install({
      mcp: args.includes('--mcp'),
      cliOnly: args.includes('--cli-only'),
    });
  } else {
    await import('../src/index.js');
  }
} catch (error) {
  console.error(`\n  Error: ${error.message}\n`);
  process.exit(1);
}
