import { execa } from 'execa';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';

/**
 * OS hardening subtasks: swap, firewall, fail2ban, SSH hardening, system dependencies.
 *
 * @param {object} ctx  Shared installer context.
 * @param {object} task Parent Listr2 task reference.
 * @returns {import('listr2').ListrTask[]}
 */
export function hardenTasks(ctx, task) {
  return task.newListr([
    {
      title: 'Creating swap file',
      // Swap is always created — critical for 512MB droplets regardless of hardening
      task: async (_ctx, subtask) => {
        // Check if swap already exists
        const { stdout: swapInfo } = await execa('swapon', ['--show']);
        if (swapInfo.trim().length > 0) {
          subtask.output = 'Swap already active, skipping creation';
          return;
        }

        subtask.output = 'Allocating 1GB swap file...';
        await execa('fallocate', ['-l', '1G', '/swapfile']);
        await execa('chmod', ['600', '/swapfile']);
        await execa('mkswap', ['/swapfile']);
        await execa('swapon', ['/swapfile']);

        // Add to /etc/fstab if not already present
        const fstab = await readFile('/etc/fstab', 'utf8');
        if (!fstab.includes('/swapfile')) {
          await writeFile('/etc/fstab', fstab.trimEnd() + '\n/swapfile none swap sw 0 0\n');
        }

        // Set swappiness
        await execa('sysctl', ['vm.swappiness=10']);
        await writeFile('/etc/sysctl.d/99-lamaste.conf', 'vm.swappiness=10\n');

        subtask.output = 'Swap file created and activated';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Configuring UFW firewall',
      skip: async () => {
        if (ctx.skipHarden) return 'Skipped via --skip-harden';

        // Check if UFW is active and all required ports are already allowed
        try {
          const { stdout } = await execa('ufw', ['status']);
          const isActive = stdout.includes('Status: active');
          if (!isActive) return false;

          const requiredPorts = ['22/tcp', '80/tcp', '443/tcp', '9292/tcp'];
          const allPresent = requiredPorts.every((port) => {
            // Match lines like "22/tcp   ALLOW   Anywhere"
            const regex = new RegExp(`^${port.replace('/', '\\/')}\\s+ALLOW`, 'm');
            return regex.test(stdout);
          });

          if (allPresent) return 'UFW active with all required ports already allowed';
        } catch {
          // ufw not installed or not available — proceed with task
        }

        return false;
      },
      task: async (_ctx, subtask) => {
        const requiredPorts = ['22/tcp', '80/tcp', '443/tcp', '9292/tcp'];

        // Determine if UFW is currently active
        let isActive = false;
        let statusOutput = '';
        try {
          const { stdout } = await execa('ufw', ['status']);
          statusOutput = stdout;
          isActive = stdout.includes('Status: active');
        } catch {
          // ufw not available or inactive
        }

        if (isActive) {
          // UFW is already active — only add missing port rules
          const actions = [];
          for (const port of requiredPorts) {
            const regex = new RegExp(`^${port.replace('/', '\\/')}\\s+ALLOW`, 'm');
            if (regex.test(statusOutput)) {
              actions.push(`Port ${port} already allowed`);
            } else {
              await execa('ufw', ['allow', port]);
              actions.push(`Added rule for ${port}`);
            }
          }
          subtask.output = actions.join(', ');
        } else {
          // UFW is not active — set up from scratch (without reset)
          subtask.output = 'Setting UFW defaults...';
          await execa('ufw', ['default', 'deny', 'incoming']);
          await execa('ufw', ['default', 'allow', 'outgoing']);

          subtask.output = 'Allowing ports 22, 80, 443, 9292...';
          for (const port of requiredPorts) {
            await execa('ufw', ['allow', port]);
          }

          await execa('ufw', ['--force', 'enable']);
          subtask.output = 'UFW enabled with ports 22, 80, 443, 9292 allowed';
        }
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Installing and configuring fail2ban',
      skip: async () => {
        if (ctx.skipHarden) return 'Skipped via --skip-harden';

        // Skip if our drop-in config already exists with expected content
        const configPath = '/etc/fail2ban/jail.d/lamaste.conf';
        if (existsSync(configPath)) {
          try {
            const existing = await readFile(configPath, 'utf8');
            if (existing.includes('[sshd]') && existing.includes('[nginx-http-auth]')) {
              const { stdout } = await execa('systemctl', ['is-active', 'fail2ban']);
              if (stdout.trim() === 'active') {
                return 'fail2ban already configured and running';
              }
            }
          } catch {
            // Config exists but can't be read or fail2ban not running — proceed
          }
        }

        return false;
      },
      task: async (_ctx, subtask) => {
        subtask.output = 'Installing fail2ban...';
        try {
          await execa('apt-get', ['install', '-y', 'fail2ban']);
        } catch (err) {
          throw new Error(
            `Failed to install fail2ban. Check your network connection and package sources.\n${err.stderr || err.message}`,
          );
        }

        const jailConfig = `[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime = 3600

[nginx-http-auth]
enabled = true
port = http,https
filter = nginx-http-auth
logpath = /var/log/nginx/error.log
maxretry = 5
bantime = 3600
`;

        // Write to jail.d/ drop-in instead of overwriting jail.local
        const jailDir = '/etc/fail2ban/jail.d';
        if (!existsSync(jailDir)) {
          await execa('mkdir', ['-p', jailDir]);
        }
        await writeFile(`${jailDir}/lamaste.conf`, jailConfig);

        subtask.output = 'Restarting fail2ban...';
        await execa('systemctl', ['restart', 'fail2ban']);

        const { stdout: status } = await execa('systemctl', ['is-active', 'fail2ban']);
        subtask.output = `fail2ban status: ${status.trim()}`;
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Hardening SSH configuration',
      skip: () => ctx.skipHarden && 'Skipped via --skip-harden',
      task: async (_ctx, subtask) => {
        const sshdConfigPath = '/etc/ssh/sshd_config';
        const tempPath = '/etc/ssh/sshd_config.lamaste-new';
        const backupPath = '/etc/ssh/sshd_config.pre-lamaste';

        const originalContent = await readFile(sshdConfigPath, 'utf8');

        const settings = {
          PasswordAuthentication: 'no',
          PermitRootLogin: 'prohibit-password',
          ChallengeResponseAuthentication: 'no',
        };

        // Check if all settings are already correctly applied
        const allCorrect = Object.entries(settings).every(([key, value]) => {
          const regex = new RegExp(`^${key}\\s+${value}$`, 'm');
          return regex.test(originalContent);
        });

        if (allCorrect) {
          subtask.output = 'SSH already hardened, skipping';
          return;
        }

        // Apply regex modifications to produce new content
        let content = originalContent;
        for (const [key, value] of Object.entries(settings)) {
          // Match both commented and uncommented lines with any spacing
          const regex = new RegExp(`^#?\\s*${key}\\s+.*$`, 'gm');
          if (regex.test(content)) {
            content = content.replace(regex, `${key} ${value}`);
          } else {
            content = content.trimEnd() + `\n${key} ${value}\n`;
          }
        }

        // Write modified content to a temp file for validation
        await writeFile(tempPath, content);

        subtask.output = 'Validating sshd config...';
        try {
          await execa('sshd', ['-t', '-f', tempPath]);
        } catch (err) {
          // Validation failed — remove temp file, leave original untouched
          await unlink(tempPath).catch(() => {});
          throw new Error(
            `sshd config validation failed, original config is untouched: ${err.message}`,
          );
        }

        // Validation passed — back up original (only if no prior backup exists)
        if (!existsSync(backupPath)) {
          await writeFile(backupPath, originalContent);
        }

        // Atomically move temp file into place
        await execa('mv', [tempPath, sshdConfigPath]);

        subtask.output = 'Restarting ssh...';
        await execa('systemctl', ['restart', 'ssh']);

        subtask.output = 'SSH hardened: key-auth only, root with keys only';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Installing system dependencies',
      task: async (_ctx, subtask) => {
        subtask.output = 'Updating package lists...';
        try {
          await execa('apt-get', ['update']);
        } catch (err) {
          throw new Error(
            `Failed to update package lists. Check your network connection and /etc/apt/sources.list.\n${err.stderr || err.message}`,
          );
        }

        subtask.output = 'Installing curl, openssl, nginx, certbot...';
        try {
          await execa('apt-get', [
            'install',
            '-y',
            'curl',
            'openssl',
            'nginx',
            'certbot',
            'python3-certbot-nginx',
          ]);
        } catch (err) {
          throw new Error(
            `Failed to install system packages. Check your network connection and package sources.\n${err.stderr || err.message}`,
          );
        }

        const { stdout: nginxVersion } = await execa('nginx', ['-v']);
        subtask.output = `Installed: ${nginxVersion || 'nginx'}`;

        // Stop nginx for now (will be configured and started later)
        await execa('systemctl', ['stop', 'nginx']);

        // Disable default nginx site
        const defaultSite = '/etc/nginx/sites-enabled/default';
        if (existsSync(defaultSite)) {
          await unlink(defaultSite);
        }

        subtask.output = 'System dependencies installed, nginx stopped';
      },
      rendererOptions: { persistentOutput: true },
    },
  ]);
}
