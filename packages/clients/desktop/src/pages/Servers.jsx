import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { Cloud, Plus, Server, ChevronDown, HardDrive, Database, Search } from 'lucide-react';
import ServerCard from '../components/ServerCard.jsx';
import CreateServerWizard from '../components/CreateServerWizard.jsx';
import CreateStorageWizard from '../components/CreateStorageWizard.jsx';
import StorageServerCard from '../components/StorageServerCard.jsx';
import AddManagedServer from '../components/AddManagedServer.jsx';
import DiscoverServerWizard from '../components/DiscoverServerWizard.jsx';
import LocalInstallWizard from '../components/LocalInstallWizard.jsx';

export default function Servers({ onManage }) {
  const queryClient = useQueryClient();
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [showAddManaged, setShowAddManaged] = useState(false);
  const [showDiscoverWizard, setShowDiscoverWizard] = useState(false);
  const [showLocalInstall, setShowLocalInstall] = useState(false);
  const [showCreateStorageWizard, setShowCreateStorageWizard] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const menuRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showAddMenu) return;
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowAddMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showAddMenu]);

  const serversQuery = useQuery({
    queryKey: ['servers'],
    queryFn: () => invoke('get_servers'),
    refetchInterval: 10000,
  });

  const storageServersQuery = useQuery({
    queryKey: ['storage-servers'],
    queryFn: () => invoke('get_storage_servers'),
    refetchInterval: 10000,
  });

  const localInstallQuery = useQuery({
    queryKey: ['local-install-available'],
    queryFn: () => invoke('check_local_install_available'),
    staleTime: 60000,
  });

  const setActiveMutation = useMutation({
    mutationFn: (serverId) => invoke('set_active_server', { serverId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['servers'] }),
  });

  const servers = serversQuery.data || [];
  const storageServers = storageServersQuery.data || [];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Cloud size={18} className="text-cyan-400" />
          <h1 className="text-lg font-bold text-white">Servers</h1>
          <span className="text-xs text-zinc-500">{servers.length} registered</span>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="text-xs px-3 py-1.5 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 flex items-center gap-1.5"
          >
            <Plus size={12} />
            Add Server
            <ChevronDown size={10} />
          </button>

          {showAddMenu && (
            <div className="absolute right-0 top-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden shadow-lg z-10 w-56">
              <button
                onClick={() => {
                  setShowAddMenu(false);
                  setShowCreateWizard(true);
                }}
                className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <Cloud size={12} />
                Create New Server
              </button>
              <button
                onClick={() => {
                  setShowAddMenu(false);
                  setShowAddManaged(true);
                }}
                className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <Server size={12} />
                Add Existing Server
              </button>
              <button
                onClick={() => {
                  setShowAddMenu(false);
                  setShowDiscoverWizard(true);
                }}
                className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <Search size={12} />
                Discover from DigitalOcean
              </button>
              <button
                onClick={() => {
                  setShowAddMenu(false);
                  setShowLocalInstall(true);
                }}
                disabled={
                  !localInstallQuery.data?.available || localInstallQuery.data?.alreadyInRegistry
                }
                className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <HardDrive size={12} />
                <span className="flex-1">Install on This Machine</span>
                {localInstallQuery.data?.platform === 'macos' && (
                  <span className="text-[9px] text-zinc-500">Linux only</span>
                )}
                {localInstallQuery.data?.alreadyInRegistry && (
                  <span className="text-[9px] text-zinc-500">Installed</span>
                )}
              </button>
              <div className="border-t border-zinc-700" />
              <button
                onClick={() => {
                  setShowAddMenu(false);
                  setShowCreateStorageWizard(true);
                }}
                className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <Database size={12} />
                Create Storage Server
              </button>
            </div>
          )}
        </div>
      </div>

      {servers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Server size={48} className="text-zinc-700 mb-4" />
          <h2 className="text-sm font-medium text-zinc-400 mb-2">No servers yet</h2>
          <p className="text-xs text-zinc-500 mb-6 text-center max-w-sm">
            Create a new server on DigitalOcean, connect to an existing installation, or install
            locally.
          </p>
          <div className="flex gap-2 flex-wrap justify-center">
            <button
              onClick={() => setShowCreateWizard(true)}
              className="text-xs px-4 py-2 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 flex items-center gap-1.5"
            >
              <Cloud size={12} />
              Create Server
            </button>
            <button
              onClick={() => setShowAddManaged(true)}
              className="text-xs px-4 py-2 rounded bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 flex items-center gap-1.5"
            >
              <Plus size={12} />
              Add Existing
            </button>
            <button
              onClick={() => setShowLocalInstall(true)}
              disabled={
                !localInstallQuery.data?.available || localInstallQuery.data?.alreadyInRegistry
              }
              className="text-xs px-4 py-2 rounded bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <HardDrive size={12} />
              Install Locally
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              onSetActive={(id) => setActiveMutation.mutate(id)}
              onManage={onManage}
            />
          ))}
        </div>
      )}

      {storageServers.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <Database size={16} className="text-cyan-400" />
            <h2 className="text-sm font-medium text-zinc-400">Storage Servers</h2>
            <span className="text-xs text-zinc-500">{storageServers.length}</span>
          </div>
          <div className="grid gap-3">
            {storageServers.map((s) => (
              <StorageServerCard key={s.id} server={s} />
            ))}
          </div>
        </div>
      )}

      {showCreateWizard && <CreateServerWizard onClose={() => setShowCreateWizard(false)} />}
      {showAddManaged && <AddManagedServer onClose={() => setShowAddManaged(false)} />}
      {showDiscoverWizard && <DiscoverServerWizard onClose={() => setShowDiscoverWizard(false)} />}
      {showLocalInstall && (
        <LocalInstallWizard
          existingInstall={localInstallQuery.data?.existingInstall}
          onClose={() => setShowLocalInstall(false)}
        />
      )}
      {showCreateStorageWizard && (
        <CreateStorageWizard onClose={() => setShowCreateStorageWizard(false)} />
      )}
    </div>
  );
}
