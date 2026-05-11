import { checkAccess } from '../../lib/authz.js';

export async function accessCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'check': {
      const username = args[1];
      const resourceType = args[2];
      const resourceId = args[3];

      if (!username || !resourceType || !resourceId) {
        console.error(
          'Usage: lamaste-gatekeeper access check <username> <resourceType> <resourceId>',
        );
        process.exit(1);
      }

      const result = await checkAccess(username, resourceType, resourceId);
      console.log(JSON.stringify(result, null, 2));

      if (!result.allowed) {
        process.exit(1);
      }
      break;
    }

    case '--help':
    case '-h':
    case undefined:
      console.log(`Usage: lamaste-gatekeeper access <subcommand>

Subcommands:
  check <username> <resourceType> <resourceId>    Check if user has access`);
      break;

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      process.exit(1);
  }
}
