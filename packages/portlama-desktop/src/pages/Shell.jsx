import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import {
  Loader2,
  Shield,
  Clock,
  Plus,
  Trash2,
  AlertTriangle,
  Terminal,
  Power,
  X,
  ExternalLink,
  FileText,
  ShieldCheck,
  Pencil,
} from 'lucide-react';

const DURATION_OPTIONS = [
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '2 hours', value: 120 },
];

const TIMEOUT_OPTIONS = [
  { label: '5 minutes', value: 5 },
  { label: '10 minutes', value: 10 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
];

const MAX_FILE_SIZE_OPTIONS = [
  { label: '10 MB', value: 10485760 },
  { label: '50 MB', value: 52428800 },
  { label: '100 MB', value: 104857600 },
  { label: '500 MB', value: 524288000 },
];

const RESTRICTED_COMMANDS = [
  'sudo',
  'su',
  'launchctl',
  'systemctl',
  'chmod',
  'chown',
  'rm',
  'mkfs',
  'dd',
  'reboot',
  'shutdown',
];

const EMPTY_POLICY_FORM = {
  name: '',
  description: '',
  allowedIps: [],
  deniedIps: [],
  inactivityTimeout: null,
  maxFileSize: null,
  restrictedCommands: {},
};

export default function Shell() {
  const queryClient = useQueryClient();
  const [showEnableGlobal, setShowEnableGlobal] = useState(false);
  const [showEnableAgent, setShowEnableAgent] = useState(null);
  const [selectedDuration, setSelectedDuration] = useState(30);
  const [selectedPolicyId, setSelectedPolicyId] = useState('');
  const [showPolicyForm, setShowPolicyForm] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState(null);
  const [policyForm, setPolicyForm] = useState(EMPTY_POLICY_FORM);
  const [policyFormError, setPolicyFormError] = useState(null);
  const [newAllowIp, setNewAllowIp] = useState('');
  const [newDenyIp, setNewDenyIp] = useState('');
  const [ipError, setIpError] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const configQuery = useQuery({
    queryKey: ['shell-config'],
    queryFn: () => invoke('get_shell_config'),
  });

  const policiesQuery = useQuery({
    queryKey: ['shell-policies'],
    queryFn: () => invoke('get_shell_policies'),
  });

  const sessionsQuery = useQuery({
    queryKey: ['shell-sessions'],
    queryFn: () => invoke('get_shell_sessions'),
    refetchInterval: 10000,
  });

  const agentCertsQuery = useQuery({
    queryKey: ['agent-certs'],
    queryFn: () => invoke('get_agent_certs'),
    refetchInterval: 15000,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['shell-config'] });
    queryClient.invalidateQueries({ queryKey: ['shell-policies'] });
    queryClient.invalidateQueries({ queryKey: ['shell-sessions'] });
    queryClient.invalidateQueries({ queryKey: ['agent-certs'] });
  };

  const updateConfigMutation = useMutation({
    mutationFn: ({ enabled, defaultPolicy }) =>
      invoke('update_shell_config', { enabled, defaultPolicy }),
    onSuccess: () => {
      setShowEnableGlobal(false);
      invalidateAll();
    },
  });

  const createPolicyMutation = useMutation({
    mutationFn: (policy) => invoke('create_shell_policy', { policy }),
    onSuccess: () => {
      setShowPolicyForm(false);
      setPolicyForm(EMPTY_POLICY_FORM);
      setPolicyFormError(null);
      invalidateAll();
    },
    onError: (err) => {
      setPolicyFormError(err?.message || String(err));
    },
  });

  const updatePolicyMutation = useMutation({
    mutationFn: ({ policyId, updates }) => invoke('update_shell_policy', { policyId, updates }),
    onSuccess: () => {
      setShowPolicyForm(false);
      setEditingPolicy(null);
      setPolicyForm(EMPTY_POLICY_FORM);
      setPolicyFormError(null);
      invalidateAll();
    },
    onError: (err) => {
      setPolicyFormError(err?.message || String(err));
    },
  });

  const deletePolicyMutation = useMutation({
    mutationFn: (policyId) => invoke('delete_shell_policy', { policyId }),
    onSuccess: () => {
      setDeleteConfirm(null);
      invalidateAll();
    },
  });

  const enableAgentMutation = useMutation({
    mutationFn: ({ label, durationMinutes, policyId }) =>
      invoke('enable_agent_shell', {
        label,
        durationMinutes,
        policyId: policyId || null,
      }),
    onSuccess: () => {
      setShowEnableAgent(null);
      invalidateAll();
    },
  });

  const disableAgentMutation = useMutation({
    mutationFn: (label) => invoke('disable_agent_shell', { label }),
    onSuccess: () => {
      invalidateAll();
    },
  });

  const shellConfig = configQuery.data;
  const policies = policiesQuery.data || [];
  const sessions = sessionsQuery.data || [];
  const agentCerts = (agentCertsQuery.data || []).filter((a) => !a.revoked);

  const handleToggleGlobal = () => {
    if (!shellConfig) return;
    if (shellConfig.enabled) {
      updateConfigMutation.mutate({ enabled: false });
    } else {
      setShowEnableGlobal(true);
    }
  };

  const handleConfirmEnableGlobal = () => {
    if (!shellConfig) return;
    updateConfigMutation.mutate({ enabled: true });
  };

  const handleEnableAgent = () => {
    if (!showEnableAgent) return;
    enableAgentMutation.mutate({
      label: showEnableAgent,
      durationMinutes: selectedDuration,
      policyId: selectedPolicyId || null,
    });
  };

  const openPolicyCreateForm = () => {
    setEditingPolicy(null);
    setPolicyForm(EMPTY_POLICY_FORM);
    setPolicyFormError(null);
    setNewAllowIp('');
    setNewDenyIp('');
    setIpError(null);
    setShowPolicyForm(true);
  };

  const openPolicyEditForm = (policy) => {
    setEditingPolicy(policy);
    const restricted = {};
    if (policy.commandBlocklist?.restricted) {
      Object.entries(policy.commandBlocklist.restricted).forEach(([cmd, val]) => {
        restricted[cmd] = val;
      });
    }
    setPolicyForm({
      name: policy.name,
      description: policy.description || '',
      allowedIps: [...policy.allowedIps],
      deniedIps: [...policy.deniedIps],
      inactivityTimeout: policy.inactivityTimeout || null,
      maxFileSize: policy.maxFileSize || null,
      restrictedCommands: restricted,
    });
    setPolicyFormError(null);
    setNewAllowIp('');
    setNewDenyIp('');
    setIpError(null);
    setShowPolicyForm(true);
  };

  const validateIp = (ip) => {
    const ipCidrPattern = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
    return ipCidrPattern.test(ip.trim());
  };

  const handleAddAllowIp = () => {
    setIpError(null);
    if (!newAllowIp.trim()) return;
    if (!validateIp(newAllowIp)) {
      setIpError('Enter a valid IP address or CIDR range (e.g. 192.168.1.0/24)');
      return;
    }
    if (policyForm.allowedIps.includes(newAllowIp.trim())) {
      setIpError('IP already in allow list');
      return;
    }
    setPolicyForm({
      ...policyForm,
      allowedIps: [...policyForm.allowedIps, newAllowIp.trim()],
    });
    setNewAllowIp('');
  };

  const handleAddDenyIp = () => {
    setIpError(null);
    if (!newDenyIp.trim()) return;
    if (!validateIp(newDenyIp)) {
      setIpError('Enter a valid IP address or CIDR range (e.g. 192.168.1.0/24)');
      return;
    }
    if (policyForm.deniedIps.includes(newDenyIp.trim())) {
      setIpError('IP already in deny list');
      return;
    }
    setPolicyForm({
      ...policyForm,
      deniedIps: [...policyForm.deniedIps, newDenyIp.trim()],
    });
    setNewDenyIp('');
  };

  const handleRemoveAllowIp = (ip) => {
    setPolicyForm({
      ...policyForm,
      allowedIps: policyForm.allowedIps.filter((i) => i !== ip),
    });
  };

  const handleRemoveDenyIp = (ip) => {
    setPolicyForm({
      ...policyForm,
      deniedIps: policyForm.deniedIps.filter((i) => i !== ip),
    });
  };

  const handleToggleRestrictedCmd = (cmd) => {
    setPolicyForm({
      ...policyForm,
      restrictedCommands: {
        ...policyForm.restrictedCommands,
        [cmd]: !policyForm.restrictedCommands[cmd],
      },
    });
  };

  const handleSubmitPolicy = (e) => {
    e.preventDefault();
    setPolicyFormError(null);
    if (!policyForm.name.trim()) {
      setPolicyFormError('Policy name is required');
      return;
    }

    const restricted = {};
    Object.entries(policyForm.restrictedCommands).forEach(([cmd, blocked]) => {
      restricted[cmd] = blocked;
    });
    const hasRestrictions = Object.values(restricted).some((v) => v);

    const policyPayload = {
      id: editingPolicy?.id || '',
      name: policyForm.name.trim(),
      description: policyForm.description.trim() || null,
      allowedIps: policyForm.allowedIps,
      deniedIps: policyForm.deniedIps,
      maxFileSize: policyForm.maxFileSize || null,
      inactivityTimeout: policyForm.inactivityTimeout || null,
      commandBlocklist: hasRestrictions ? { hardBlocked: [], restricted } : null,
    };

    if (editingPolicy) {
      updatePolicyMutation.mutate({
        policyId: editingPolicy.id,
        updates: policyPayload,
      });
    } else {
      createPolicyMutation.mutate(policyPayload);
    }
  };

  const isPolicyInUse = (policyId) => {
    // A policy is in use if any active session references it or if it is the default
    return shellConfig?.defaultPolicy === policyId;
  };

  const formatTimeRemaining = (until) => {
    if (!until) return null;
    const remaining = new Date(until) - new Date();
    if (remaining <= 0) return null;
    const minutes = Math.ceil(remaining / 60000);
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return mins > 0 ? `${hours}h ${mins}m remaining` : `${hours}h remaining`;
    }
    return `${minutes}m remaining`;
  };

  const getPolicyName = (policyId) => {
    const policy = policies.find((p) => p.id === policyId);
    return policy?.name || null;
  };

  if (configQuery.isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-zinc-500">
          <Loader2 size={14} className="animate-spin" />
          Loading shell configuration...
        </div>
      </div>
    );
  }

  if (configQuery.isError) {
    return (
      <div className="p-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center">
          <AlertTriangle size={32} className="mx-auto text-amber-400 mb-3" />
          <p className="text-zinc-400 text-sm mb-1">Failed to load shell configuration</p>
          <p className="text-zinc-600 text-xs">
            {configQuery.error?.message || String(configQuery.error)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-white">Remote Shell</h1>
          {shellConfig && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full border ${
                shellConfig.enabled
                  ? 'text-green-400 bg-green-500/10 border-green-500/20'
                  : 'text-zinc-500 bg-zinc-800 border-zinc-700'
              }`}
            >
              {shellConfig.enabled ? 'enabled' : 'disabled'}
            </span>
          )}
        </div>
        <button
          onClick={handleToggleGlobal}
          disabled={updateConfigMutation.isPending}
          className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm ${
            shellConfig?.enabled
              ? 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700'
              : 'bg-cyan-600 hover:bg-cyan-500 text-white'
          } disabled:opacity-50`}
        >
          {updateConfigMutation.isPending && <Loader2 size={14} className="animate-spin" />}
          <Power size={14} />
          {shellConfig?.enabled ? 'Disable Shell' : 'Enable Shell'}
        </button>
      </div>

      {/* Global not enabled warning */}
      {shellConfig && !shellConfig.enabled && (
        <div className="bg-zinc-900 border border-amber-500/30 rounded-lg p-6 text-center">
          <Shield size={32} className="mx-auto text-amber-400 mb-3" />
          <h2 className="text-white font-semibold text-sm mb-2">Remote Shell is Disabled</h2>
          <p className="text-zinc-400 text-xs max-w-md mx-auto mb-4">
            Remote shell access allows administrators to execute commands on agent machines. Enable
            it to manage per-agent shell access controls.
          </p>
          <button
            onClick={() => setShowEnableGlobal(true)}
            disabled={updateConfigMutation.isPending}
            className="flex items-center gap-2 mx-auto rounded bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {updateConfigMutation.isPending && <Loader2 size={14} className="animate-spin" />}
            Enable Remote Shell
          </button>
        </div>
      )}

      {/* Content when enabled */}
      {shellConfig?.enabled && (
        <>
          {/* Policies Section */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <FileText size={14} className="text-cyan-400" />
                Policies
                {policiesQuery.isFetching && (
                  <Loader2 size={12} className="animate-spin text-zinc-500" />
                )}
              </h2>
              <button
                onClick={openPolicyCreateForm}
                className="flex items-center gap-1.5 rounded bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 text-sm text-white"
              >
                <Plus size={14} />
                Create Policy
              </button>
            </div>

            {/* Policy form */}
            {showPolicyForm && (
              <form
                onSubmit={handleSubmitPolicy}
                className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 mb-4"
              >
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-white">
                    {editingPolicy ? 'Edit Policy' : 'Create Policy'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPolicyForm(false);
                      setEditingPolicy(null);
                      setPolicyFormError(null);
                    }}
                    className="text-zinc-500 hover:text-zinc-300"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Name</label>
                    <input
                      type="text"
                      placeholder="Maintenance"
                      value={policyForm.name}
                      onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })}
                      className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Description</label>
                    <input
                      type="text"
                      placeholder="Policy for maintenance tasks"
                      value={policyForm.description}
                      onChange={(e) =>
                        setPolicyForm({
                          ...policyForm,
                          description: e.target.value,
                        })
                      }
                      className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Inactivity Timeout</label>
                    <select
                      value={policyForm.inactivityTimeout || ''}
                      onChange={(e) =>
                        setPolicyForm({
                          ...policyForm,
                          inactivityTimeout: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                    >
                      <option value="">No timeout</option>
                      {TIMEOUT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Max File Size</label>
                    <select
                      value={policyForm.maxFileSize || ''}
                      onChange={(e) =>
                        setPolicyForm({
                          ...policyForm,
                          maxFileSize: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                    >
                      <option value="">No limit</option>
                      {MAX_FILE_SIZE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* IP Allow List */}
                <div className="mb-3">
                  <label className="text-xs text-zinc-500 block mb-1">IP Allow List</label>
                  {policyForm.allowedIps.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {policyForm.allowedIps.map((ip) => (
                        <span
                          key={ip}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-zinc-300 font-mono"
                        >
                          {ip}
                          <button
                            type="button"
                            onClick={() => handleRemoveAllowIp(ip)}
                            className="text-zinc-600 hover:text-red-400"
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="192.168.1.0/24"
                      value={newAllowIp}
                      onChange={(e) => {
                        setNewAllowIp(e.target.value);
                        setIpError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddAllowIp();
                        }
                      }}
                      className="flex-1 rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleAddAllowIp}
                      className="flex items-center gap-1 rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
                    >
                      <Plus size={14} />
                      Add
                    </button>
                  </div>
                </div>

                {/* IP Deny List */}
                <div className="mb-3">
                  <label className="text-xs text-zinc-500 block mb-1">IP Deny List</label>
                  {policyForm.deniedIps.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {policyForm.deniedIps.map((ip) => (
                        <span
                          key={ip}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-zinc-950 border border-red-500/20 text-red-400 font-mono"
                        >
                          {ip}
                          <button
                            type="button"
                            onClick={() => handleRemoveDenyIp(ip)}
                            className="text-zinc-600 hover:text-red-400"
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="10.0.0.0/8"
                      value={newDenyIp}
                      onChange={(e) => {
                        setNewDenyIp(e.target.value);
                        setIpError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddDenyIp();
                        }
                      }}
                      className="flex-1 rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleAddDenyIp}
                      className="flex items-center gap-1 rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
                    >
                      <Plus size={14} />
                      Add
                    </button>
                  </div>
                </div>

                {ipError && <p className="text-red-400 text-xs mb-3">{ipError}</p>}

                {/* Restricted Commands */}
                <div className="mb-4">
                  <label className="text-xs text-zinc-500 block mb-2">Restricted Commands</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {RESTRICTED_COMMANDS.map((cmd) => (
                      <button
                        key={cmd}
                        type="button"
                        onClick={() => handleToggleRestrictedCmd(cmd)}
                        className={`flex items-center justify-between rounded px-3 py-2 text-xs font-mono border ${
                          policyForm.restrictedCommands[cmd]
                            ? 'text-red-400 bg-red-500/10 border-red-500/20'
                            : 'text-zinc-400 bg-zinc-950 border-zinc-700 hover:border-zinc-600'
                        }`}
                      >
                        {cmd}
                        <span className="text-[10px] ml-2 opacity-70">
                          {policyForm.restrictedCommands[cmd] ? 'blocked' : 'allowed'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {policyFormError && <p className="text-red-400 text-xs mb-3">{policyFormError}</p>}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={createPolicyMutation.isPending || updatePolicyMutation.isPending}
                    className="flex items-center gap-2 rounded bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {(createPolicyMutation.isPending || updatePolicyMutation.isPending) && (
                      <Loader2 size={14} className="animate-spin" />
                    )}
                    {editingPolicy ? 'Update Policy' : 'Create Policy'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPolicyForm(false);
                      setEditingPolicy(null);
                      setPolicyFormError(null);
                    }}
                    className="rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* Policy cards grid */}
            {policies.length === 0 && !showPolicyForm ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center">
                <FileText size={32} className="mx-auto text-zinc-600 mb-3" />
                <p className="text-zinc-400 text-sm">No policies defined.</p>
                <p className="text-zinc-500 text-xs mt-1">
                  Create a policy to define IP restrictions, command blocklists, and session limits.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {policies.map((policy) => {
                  const isDefault = shellConfig?.defaultPolicy === policy.id;
                  const restrictedCount = policy.commandBlocklist
                    ? Object.values(policy.commandBlocklist.restricted || {}).filter(Boolean).length
                    : 0;
                  const showingDeleteConfirm = deleteConfirm === policy.id;

                  return (
                    <div
                      key={policy.id}
                      className="bg-zinc-900 border border-zinc-800 rounded-lg p-4"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <ShieldCheck size={14} className="text-cyan-400" />
                          <span className="text-sm font-semibold text-white">{policy.name}</span>
                          {isDefault && (
                            <span className="text-xs px-2 py-0.5 rounded-full border text-cyan-400 bg-cyan-500/10 border-cyan-500/20">
                              default
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => openPolicyEditForm(policy)}
                            className="text-zinc-600 hover:text-zinc-300 p-1"
                            title="Edit policy"
                          >
                            <Pencil size={12} />
                          </button>
                          {!showingDeleteConfirm && (
                            <button
                              onClick={() => setDeleteConfirm(policy.id)}
                              disabled={isDefault || isPolicyInUse(policy.id)}
                              className="text-zinc-600 hover:text-red-400 p-1 disabled:opacity-30 disabled:cursor-not-allowed"
                              title={
                                isDefault
                                  ? 'Cannot delete default policy'
                                  : isPolicyInUse(policy.id)
                                    ? 'Cannot delete in-use policy'
                                    : 'Delete policy'
                              }
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                          {showingDeleteConfirm && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => deletePolicyMutation.mutate(policy.id)}
                                disabled={deletePolicyMutation.isPending}
                                className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
                              >
                                {deletePolicyMutation.isPending ? 'Deleting...' : 'Confirm'}
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      {policy.description && (
                        <p className="text-xs text-zinc-500 mb-3">{policy.description}</p>
                      )}
                      <div className="flex items-center gap-3 text-xs text-zinc-400">
                        <span>
                          {policy.allowedIps.length + policy.deniedIps.length} IP rule
                          {policy.allowedIps.length + policy.deniedIps.length !== 1 ? 's' : ''}
                        </span>
                        {restrictedCount > 0 && (
                          <span className="text-red-400">
                            {restrictedCount} blocked cmd
                            {restrictedCount !== 1 ? 's' : ''}
                          </span>
                        )}
                        {policy.inactivityTimeout && (
                          <span>{policy.inactivityTimeout}m timeout</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Agent Access Section */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Terminal size={14} className="text-cyan-400" />
              Agent Access
              {agentCertsQuery.isFetching && (
                <Loader2 size={12} className="animate-spin text-zinc-500" />
              )}
            </h2>
            {agentCerts.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center">
                <p className="text-zinc-400 text-sm">No agents found.</p>
                <p className="text-zinc-500 text-xs mt-1">
                  Generate agent certificates to see available agents.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {agentCerts.map((agent) => (
                  <AgentShellCard
                    key={agent.label}
                    agent={agent}
                    sessions={sessions}
                    policies={policies}
                    getPolicyName={getPolicyName}
                    onEnable={() => {
                      setShowEnableAgent(agent.label);
                      setSelectedDuration(30);
                      setSelectedPolicyId(shellConfig?.defaultPolicy || '');
                    }}
                    onDisable={() => disableAgentMutation.mutate(agent.label)}
                    disableIsPending={disableAgentMutation.isPending}
                    formatTimeRemaining={formatTimeRemaining}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Sessions Section */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Clock size={14} className="text-cyan-400" />
              Sessions
              {sessionsQuery.isFetching && (
                <Loader2 size={12} className="animate-spin text-zinc-500" />
              )}
            </h2>
            {sessions.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center">
                <p className="text-zinc-400 text-sm">No sessions recorded.</p>
              </div>
            ) : (
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="text-left text-xs text-zinc-500 font-medium px-4 py-2">
                        Agent
                      </th>
                      <th className="text-left text-xs text-zinc-500 font-medium px-4 py-2">
                        Admin
                      </th>
                      <th className="text-left text-xs text-zinc-500 font-medium px-4 py-2">
                        Started
                      </th>
                      <th className="text-left text-xs text-zinc-500 font-medium px-4 py-2">
                        Duration
                      </th>
                      <th className="text-left text-xs text-zinc-500 font-medium px-4 py-2">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((session) => (
                      <tr key={session.id} className="border-b border-zinc-800/50 last:border-0">
                        <td className="px-4 py-2 text-white font-mono text-xs">
                          {session.agentLabel}
                        </td>
                        <td className="px-4 py-2 text-zinc-400 text-xs">
                          {session.adminLabel || '\u2014'}
                        </td>
                        <td className="px-4 py-2 text-zinc-400 text-xs">
                          {new Date(session.startedAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-zinc-400 text-xs">
                          {session.duration ? `${Math.ceil(session.duration / 60)}m` : 'active'}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full border ${
                              session.endedAt
                                ? 'text-zinc-500 bg-zinc-800 border-zinc-700'
                                : 'text-green-400 bg-green-500/10 border-green-500/20'
                            }`}
                          >
                            {session.endedAt ? 'ended' : 'active'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Enable Global Shell Warning Modal */}
      {showEnableGlobal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 w-[28rem]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-400" />
                <h2 className="text-sm font-semibold text-white">Enable Remote Shell Access</h2>
              </div>
              <button
                onClick={() => setShowEnableGlobal(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
              This grants terminal access to agent machines. An admin with shell access can execute
              commands, read files, and modify the system.
            </p>
            <ul className="text-xs text-zinc-500 space-y-1.5 mb-5">
              <li className="flex items-start gap-2">
                <span className="text-zinc-600 mt-0.5">&#8226;</span>
                Shell access is time-limited and must be re-enabled after expiry
              </li>
              <li className="flex items-start gap-2">
                <span className="text-zinc-600 mt-0.5">&#8226;</span>
                All sessions are recorded and logged
              </li>
              <li className="flex items-start gap-2">
                <span className="text-zinc-600 mt-0.5">&#8226;</span>
                Dangerous commands are blocked by default
              </li>
            </ul>
            <p className="text-xs text-amber-400/80 mb-5">
              Only enable this if you understand the security implications.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowEnableGlobal(false)}
                className="rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmEnableGlobal}
                disabled={updateConfigMutation.isPending}
                className="flex items-center gap-2 rounded bg-amber-600 hover:bg-amber-500 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {updateConfigMutation.isPending && <Loader2 size={14} className="animate-spin" />}I
                understand, enable
              </button>
            </div>
            {updateConfigMutation.isError && (
              <p className="text-red-400 text-xs mt-3">
                {updateConfigMutation.error?.message || String(updateConfigMutation.error)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Enable Agent Shell Modal */}
      {showEnableAgent && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 w-96">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Enable Shell — {showEnableAgent}</h2>
              <button
                onClick={() => setShowEnableAgent(null)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mb-4">
              <label className="text-xs text-zinc-500 block mb-2">Duration</label>
              <div className="grid grid-cols-2 gap-2">
                {DURATION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedDuration(opt.value)}
                    className={`rounded border px-3 py-2 text-sm ${
                      selectedDuration === opt.value
                        ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-400'
                        : 'bg-zinc-950 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {policies.length > 0 && (
              <div className="mb-4">
                <label className="text-xs text-zinc-500 block mb-2">Policy</label>
                <select
                  value={selectedPolicyId}
                  onChange={(e) => setSelectedPolicyId(e.target.value)}
                  className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                >
                  <option value="">No policy</option>
                  {policies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {shellConfig?.defaultPolicy === p.id ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setShowEnableAgent(null)}
                className="rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={handleEnableAgent}
                disabled={enableAgentMutation.isPending}
                className="flex items-center gap-2 rounded bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {enableAgentMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                <Terminal size={14} />
                Enable Shell
              </button>
            </div>
            {enableAgentMutation.isError && (
              <p className="text-red-400 text-xs mt-3">
                {enableAgentMutation.error?.message || String(enableAgentMutation.error)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* General error display */}
      {disableAgentMutation.isError && (
        <p className="text-red-400 text-xs mt-3">
          {disableAgentMutation.error?.message || String(disableAgentMutation.error)}
        </p>
      )}
      {deletePolicyMutation.isError && (
        <p className="text-red-400 text-xs mt-3">
          {deletePolicyMutation.error?.message || String(deletePolicyMutation.error)}
        </p>
      )}
    </div>
  );
}

function AgentShellCard({
  agent,
  sessions: _sessions,
  policies: _policies,
  getPolicyName,
  onEnable,
  onDisable,
  disableIsPending,
  formatTimeRemaining,
}) {
  const { label } = agent;
  const shellTimeRemaining = formatTimeRemaining(agent.shellEnabledUntil);
  const isShellActive = !!shellTimeRemaining;
  const policyName = agent.shellPolicy ? getPolicyName(agent.shellPolicy) : null;

  const handleConnect = async () => {
    try {
      await open(`portlama-agent shell ${label}`);
    } catch {
      // Shell plugin open may not support running commands directly;
      // this is a best-effort approach
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-zinc-400" />
            <span className="text-sm font-semibold text-white">{label}</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full border ${
                isShellActive
                  ? 'text-green-400 bg-green-500/10 border-green-500/20'
                  : 'text-zinc-500 bg-zinc-800 border-zinc-700'
              }`}
            >
              {isShellActive ? 'shell active' : 'shell disabled'}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            {isShellActive && shellTimeRemaining && (
              <p className="text-xs text-green-400/70 flex items-center gap-1">
                <Clock size={10} />
                {shellTimeRemaining}
              </p>
            )}
            {policyName && (
              <span className="text-xs text-zinc-500 flex items-center gap-1">
                <ShieldCheck size={10} />
                {policyName}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isShellActive && (
            <>
              <button
                onClick={handleConnect}
                className="flex items-center gap-1.5 rounded bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 text-xs text-white"
              >
                <ExternalLink size={12} />
                Connect
              </button>
              <button
                onClick={onDisable}
                disabled={disableIsPending}
                className="flex items-center gap-1 rounded bg-zinc-800 border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-red-400 hover:border-red-500/30 disabled:opacity-50"
              >
                <Power size={12} />
                Disable
              </button>
            </>
          )}
          {!isShellActive && (
            <button
              onClick={onEnable}
              className="flex items-center gap-1.5 rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
            >
              <Terminal size={12} />
              Enable Shell
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
