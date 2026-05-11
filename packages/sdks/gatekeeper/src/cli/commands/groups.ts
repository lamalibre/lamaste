import {
  createGroup,
  listGroups,
  getGroup,
  updateGroup,
  deleteGroup,
  addMembers,
  removeMembers,
} from '../../lib/groups.js';

export async function groupCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'create': {
      const name = args[1];
      if (!name) {
        console.error('Usage: lamaste-gatekeeper group create <name> [--description "..."]');
        process.exit(1);
      }
      const descIdx = args.indexOf('--description');
      const description = descIdx !== -1 ? args[descIdx + 1] : undefined;
      const group = await createGroup(name, { description });
      console.log(JSON.stringify(group, null, 2));
      break;
    }

    case 'list': {
      const groups = await listGroups();
      console.log(JSON.stringify(groups, null, 2));
      break;
    }

    case 'show': {
      const name = args[1];
      if (!name) {
        console.error('Usage: lamaste-gatekeeper group show <name>');
        process.exit(1);
      }
      const group = await getGroup(name);
      if (!group) {
        console.error(`Group "${name}" not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(group, null, 2));
      break;
    }

    case 'rename': {
      const name = args[1];
      const newName = args[2];
      if (!name || !newName) {
        console.error('Usage: lamaste-gatekeeper group rename <name> <new-name>');
        process.exit(1);
      }
      const group = await updateGroup(name, { name: newName });
      console.log(JSON.stringify(group, null, 2));
      break;
    }

    case 'delete': {
      const name = args[1];
      if (!name) {
        console.error('Usage: lamaste-gatekeeper group delete <name>');
        process.exit(1);
      }
      const result = await deleteGroup(name);
      console.log(`Deleted group "${name}". Revoked ${result.deletedGrants} grant(s).`);
      break;
    }

    case 'add-member': {
      const groupName = args[1];
      const usernames = args.slice(2);
      if (!groupName || usernames.length === 0) {
        console.error(
          'Usage: lamaste-gatekeeper group add-member <group> <username> [<username>...]',
        );
        process.exit(1);
      }
      const group = await addMembers(groupName, usernames);
      console.log(JSON.stringify(group, null, 2));
      break;
    }

    case 'remove-member': {
      const groupName = args[1];
      const usernames = args.slice(2);
      if (!groupName || usernames.length === 0) {
        console.error(
          'Usage: lamaste-gatekeeper group remove-member <group> <username> [<username>...]',
        );
        process.exit(1);
      }
      const group = await removeMembers(groupName, usernames);
      console.log(JSON.stringify(group, null, 2));
      break;
    }

    case '--help':
    case '-h':
    case undefined:
      console.log(`Usage: lamaste-gatekeeper group <subcommand>

Subcommands:
  create <name> [--description "..."]     Create a group
  list                                     List all groups
  show <name>                              Show group details
  rename <name> <new-name>                 Rename a group
  delete <name>                            Delete a group and revoke its grants
  add-member <group> <username>...         Add members to a group
  remove-member <group> <username>...      Remove members from a group`);
      break;

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      process.exit(1);
  }
}
