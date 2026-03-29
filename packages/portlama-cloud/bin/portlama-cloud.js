#!/usr/bin/env node

/**
 * CLI entry point for portlama-cloud.
 *
 * Commands:
 *   provision --provider <name> --region <slug> --label <name>
 *   validate
 *   regions
 *   destroy   --provider <name> --id <dropletId>
 *
 * The cloud API token is read from PORTLAMA_CLOUD_TOKEN env var (never CLI args).
 * Output is NDJSON for machine consumption by the Tauri desktop app.
 */

import { provision } from '../dist/provisioner.js';
import { DigitalOceanProvider } from '../dist/digitalocean/index.js';
import { validateDOToken } from '../dist/digitalocean/scopes.js';
import { loadServers } from '../dist/registry.js';
import os from 'node:os';

function usage() {
  console.error(`Usage: portlama-cloud <command> [options]

Commands:
  provision  --provider <name> --region <slug> --label <name> [--size <slug>] [--domain <fqdn> --email <addr>] [--do-domain <name> --do-subdomain <prefix>] [--override-dns]
  validate   Validate the cloud API token
  regions    List available regions with latency probes
  sizes      --region <slug>  List available droplet sizes for a region
  domains    List DigitalOcean-managed domains (requires domain:read scope)
  create-domain --name <fqdn>  Register a new domain in DigitalOcean DNS
  domain-records --domain <name>  List DNS records for a domain
  destroy    --provider <name> --id <dropletId>
  servers    List registered servers

Environment:
  PORTLAMA_CLOUD_TOKEN  Cloud provider API token (required for cloud commands)
`);
  process.exit(1);
}

function getToken() {
  const token = process.env.PORTLAMA_CLOUD_TOKEN;
  if (!token) {
    console.error('Error: PORTLAMA_CLOUD_TOKEN environment variable is required');
    process.exit(1);
  }
  return token;
}

function getArg(args, name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    usage();
  }

  switch (command) {
    case 'provision': {
      const provider = getArg(args, 'provider') || 'digitalocean';
      const region = getArg(args, 'region');
      const label = getArg(args, 'label');
      const size = getArg(args, 'size') || undefined;
      const domain = getArg(args, 'domain') || undefined;
      const email = getArg(args, 'email') || undefined;
      const doDomain = getArg(args, 'do-domain') || undefined;
      const doSubdomain = getArg(args, 'do-subdomain') || undefined;
      const overrideDns = args.includes('--override-dns');
      const token = getToken();

      if (!region || !label) {
        console.error('Error: --region and --label are required');
        process.exit(1);
      }

      const platform = os.platform() === 'darwin' ? 'darwin' : 'linux';
      await provision({ provider, token, region, label, size, domain, email, platform, doDomain, doSubdomain, overrideDns });
      break;
    }

    case 'validate': {
      const token = getToken();
      const result = await validateDOToken(token);
      process.stdout.write(JSON.stringify(result) + '\n');
      break;
    }

    case 'regions': {
      const token = getToken();
      const provider = new DigitalOceanProvider(token);
      const regions = await provider.getRegions();
      const withLatency = await provider.probeLatency(regions);
      process.stdout.write(JSON.stringify(withLatency) + '\n');
      break;
    }

    case 'sizes': {
      const token = getToken();
      const region = getArg(args, 'region');
      if (!region) {
        console.error('Error: --region is required');
        process.exit(1);
      }
      const provider = new DigitalOceanProvider(token);
      const sizes = await provider.getSizes(region);
      process.stdout.write(JSON.stringify(sizes) + '\n');
      break;
    }

    case 'destroy': {
      const provider = getArg(args, 'provider') || 'digitalocean';
      const id = getArg(args, 'id');
      const token = getToken();

      if (!id) {
        console.error('Error: --id is required');
        process.exit(1);
      }

      if (provider === 'digitalocean') {
        const doProvider = new DigitalOceanProvider(token);
        await doProvider.destroyServer(id);
        process.stdout.write(JSON.stringify({ ok: true }) + '\n');
      } else {
        console.error(`Error: Unsupported provider: ${provider}`);
        process.exit(1);
      }
      break;
    }

    case 'servers': {
      const servers = await loadServers();
      // Redact sensitive fields before writing to stdout
      const redacted = servers.map(({ p12Password, ...rest }) => rest);
      process.stdout.write(JSON.stringify(redacted) + '\n');
      break;
    }

    case 'domains': {
      const token = getToken();
      const provider = new DigitalOceanProvider(token);
      const domains = await provider.listDomains();
      process.stdout.write(JSON.stringify(domains) + '\n');
      break;
    }

    case 'create-domain': {
      const token = getToken();
      const name = getArg(args, 'name');
      if (!name) {
        console.error('Error: --name is required');
        process.exit(1);
      }
      const provider = new DigitalOceanProvider(token);
      const domain = await provider.createDomain(name);
      process.stdout.write(JSON.stringify(domain) + '\n');
      break;
    }

    case 'domain-records': {
      const token = getToken();
      const domainName = getArg(args, 'domain');
      if (!domainName) {
        console.error('Error: --domain is required');
        process.exit(1);
      }
      const provider = new DigitalOceanProvider(token);
      const records = await provider.listDomainRecords(domainName);
      process.stdout.write(JSON.stringify(records) + '\n');
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      usage();
  }
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ error: err.message }) + '\n');
  process.exit(1);
});
