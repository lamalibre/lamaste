// ============================================================================
// env_detect — thin MCP wrapper, delegates to lamaste-e2e CLI
// ============================================================================

import { z } from 'zod';
import { runE2eCommand } from '../subprocess.js';

export const envDetectTool = {
  name: 'env_detect',
  description:
    'Detect host hardware capabilities and recommend a VM profile. ' +
    'Returns CPU count, available memory, recommended profile, and all supported profiles. ' +
    'Run this before vm_create to choose the right resource tier.',
  inputSchema: z.object({}),
  async handler() {
    return runE2eCommand(['env', 'detect']);
  },
};
