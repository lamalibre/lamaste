import { Cpu } from 'lucide-react';

/** `ubuntu 24.04`, `Linux` or `macOS` — the system an agent reported. */
function systemName(facts) {
  if (facts.os === 'darwin') return 'macOS';
  if (!facts.distro) return 'Linux';
  return [facts.distro.id, facts.distro.versionId].filter(Boolean).join(' ');
}

/**
 * What an agent reported about its host on its last sync, compactly: its
 * system, architecture and Node.js; on Linux also whether systemd is the
 * system manager and whether the app host helper (which installs agent
 * halves) is enabled, with its protocol and the relay key it verifies the
 * relay's app jobs with. `at` is when it reported them.
 */
export function HostFactsSummary({ facts, at }) {
  if (!facts) {
    return (
      <span
        className="text-xs text-zinc-600"
        title="The agent reports its host on its sync — it has not yet (sync not running, or lamaste-agent too old)"
      >
        host not reported
      </span>
    );
  }
  const linux = facts.os === 'linux';
  const parts = [systemName(facts), facts.arch, `Node ${facts.node}`];
  if (linux) parts.push(facts.systemd ? 'systemd' : 'no systemd');
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500">
      <Cpu size={11} className="shrink-0 text-zinc-600" />
      {parts.map((part, i) => (
        <span key={`${i}-${part}`} className="whitespace-nowrap">
          {i > 0 && '· '}
          {part}
        </span>
      ))}
      {linux &&
        (facts.apphost ? (
          <span
            className="whitespace-nowrap text-cyan-400"
            title="The app host helper is enabled: Lamaste can install agent halves here"
          >
            · app host v{facts.apphost.version}
            {facts.apphost.relayKid ? (
              <span
                className="text-zinc-500"
                title={`The helper runs app jobs signed with relay key ${facts.apphost.relayKid}`}
              >
                {' '}
                (relay key {facts.apphost.relayKid.slice(0, 12)})
              </span>
            ) : (
              <span
                className="text-yellow-400"
                title="The helper has no key of this relay pinned and runs none of its app jobs: sudo lamaste-agent apphost pin"
              >
                {' '}
                (no relay key pinned)
              </span>
            )}
          </span>
        ) : (
          <span
            className="whitespace-nowrap text-zinc-600"
            title="Enable it on the agent with: sudo lamaste-agent apphost enable"
          >
            · app host off
          </span>
        ))}
      {at && (
        <span className="whitespace-nowrap text-zinc-600">
          · reported {new Date(at).toLocaleString()}
        </span>
      )}
    </span>
  );
}
