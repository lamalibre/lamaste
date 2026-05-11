import {
  createGrant,
  listGrants,
  getGrant,
  revokeGrant,
} from '../../lib/grants.js';
import type { PrincipalType } from '../../lib/constants.js';

export async function grantCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'create': {
      const user = getFlag(args, '--user');
      const group = getFlag(args, '--group');
      const tunnel = getFlag(args, '--tunnel');
      const plugin = getFlag(args, '--plugin');
      const target = getFlag(args, '--target');

      if (!user && !group) {
        console.error('Must specify --user <username> or --group <groupname>');
        process.exit(1);
      }
      if (!tunnel && !plugin) {
        console.error('Must specify --tunnel <tunnelId> or --plugin <pluginName>');
        process.exit(1);
      }

      const principalType: PrincipalType = user ? 'user' : 'group';
      const principalId = (user ?? group)!;
      const resourceType = tunnel ? 'tunnel' : 'plugin';
      const resourceId = (tunnel ?? plugin)!;
      const context: Record<string, unknown> = {};
      if (target) context['target'] = target;

      const grant = await createGrant({
        principalType,
        principalId,
        resourceType,
        resourceId,
        context,
      });
      console.log(JSON.stringify(grant, null, 2));
      break;
    }

    case 'list': {
      const user = getFlag(args, '--user');
      const group = getFlag(args, '--group');
      const tunnel = getFlag(args, '--tunnel');
      const plugin = getFlag(args, '--plugin');

      const filter: Record<string, unknown> = {};
      if (user) {
        filter.principalType = 'user';
        filter.principalId = user;
      } else if (group) {
        filter.principalType = 'group';
        filter.principalId = group;
      }
      if (tunnel) {
        filter.resourceType = 'tunnel';
        filter.resourceId = tunnel;
      } else if (plugin) {
        filter.resourceType = 'plugin';
        filter.resourceId = plugin;
      }

      const grants = await listGrants(
        Object.keys(filter).length > 0 ? filter : undefined,
      );
      console.log(JSON.stringify(grants, null, 2));
      break;
    }

    case 'show': {
      const grantId = args[1];
      if (!grantId) {
        console.error('Usage: lamaste-gatekeeper grant show <grantId>');
        process.exit(1);
      }
      const grant = await getGrant(grantId);
      if (!grant) {
        console.error('Grant not found');
        process.exit(1);
      }
      console.log(JSON.stringify(grant, null, 2));
      break;
    }

    case 'revoke': {
      const grantId = args[1];
      if (!grantId) {
        console.error('Usage: lamaste-gatekeeper grant revoke <grantId>');
        process.exit(1);
      }
      const grant = await revokeGrant(grantId);
      console.log(`Revoked grant ${grant.grantId}`);
      break;
    }

    case '--help':
    case '-h':
    case undefined:
      console.log(`Usage: lamaste-gatekeeper grant <subcommand>

Subcommands:
  create --user <username> --tunnel <tunnelId>
  create --group <groupname> --tunnel <tunnelId>
  create --user <username> --plugin <pluginName> [--target agent:<label>]
  list [--user <username>] [--group <groupname>] [--tunnel <id>] [--plugin <name>]
  show <grantId>
  revoke <grantId>`);
      break;

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      process.exit(1);
  }
}

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}
