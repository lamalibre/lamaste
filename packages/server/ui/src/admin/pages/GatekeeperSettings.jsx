import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { Settings, Loader2, RefreshCw } from 'lucide-react';
import { errorMessage } from '../lib/errorMessage.js';

const DEFAULT_FORM = {
  adminEmail: '',
  adminName: '',
  slackChannel: '',
  teamsChannel: '',
  accessLoggingEnabled: false,
  accessLogRetentionDays: 30,
};

function formFromSettings(settings) {
  if (!settings) return DEFAULT_FORM;
  return {
    adminEmail: settings.adminEmail || '',
    adminName: settings.adminName || '',
    slackChannel: settings.slackChannel || '',
    teamsChannel: settings.teamsChannel || '',
    accessLoggingEnabled: settings.accessLoggingEnabled || false,
    accessLogRetentionDays: settings.accessLogRetentionDays || 30,
  };
}

export default function GatekeeperSettingsPage() {
  const client = useAdminClient();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ['gatekeeper-settings'],
    queryFn: () => client.getGatekeeperSettings(),
  });

  const initialForm = useMemo(
    () => formFromSettings(settingsQuery.data?.settings),
    [settingsQuery.data],
  );

  const [form, setForm] = useState(DEFAULT_FORM);
  const [formKey, setFormKey] = useState(0);
  const [apiError, setApiError] = useState(null);
  const [saved, setSaved] = useState(false);

  // Reset form when server data arrives (key-based reset)
  const currentKey = settingsQuery.dataUpdatedAt;
  if (currentKey !== formKey && settingsQuery.data?.settings) {
    setFormKey(currentKey);
    setForm(initialForm);
  }

  const saveMutation = useMutation({
    mutationFn: (data) => client.updateGatekeeperSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gatekeeper-settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) => setApiError(errorMessage(err)),
  });

  const bustMutation = useMutation({
    mutationFn: () => client.bustGatekeeperCache(),
  });

  const handleSave = useCallback(
    (e) => {
      e.preventDefault();
      setApiError(null);
      const data = { ...form };
      if (!data.adminEmail) delete data.adminEmail;
      if (!data.adminName) delete data.adminName;
      if (!data.slackChannel) delete data.slackChannel;
      if (!data.teamsChannel) delete data.teamsChannel;
      saveMutation.mutate(data);
    },
    [form, saveMutation],
  );

  if (settingsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-zinc-400 p-8">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5 text-cyan-400" />
        <h1 className="text-xl font-semibold text-zinc-100">Gatekeeper Settings</h1>
      </div>

      <form onSubmit={handleSave} className="space-y-6 max-w-lg">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-medium text-zinc-300">Admin Contact</h2>
          <p className="text-xs text-zinc-500">
            Shown on access-request pages so users know who to contact.
          </p>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Admin Name</label>
            <input
              type="text"
              value={form.adminName}
              onChange={(e) => setForm({ ...form, adminName: e.target.value })}
              placeholder="e.g., IT Admin"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Admin Email</label>
            <input
              type="email"
              value={form.adminEmail}
              onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
              placeholder="admin@example.com"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Slack Channel</label>
            <input
              type="text"
              value={form.slackChannel}
              onChange={(e) => setForm({ ...form, slackChannel: e.target.value })}
              placeholder="#access-requests"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Teams Channel</label>
            <input
              type="text"
              value={form.teamsChannel}
              onChange={(e) => setForm({ ...form, teamsChannel: e.target.value })}
              placeholder="Access Requests"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-medium text-zinc-300">Access Logging</h2>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.accessLoggingEnabled}
              onChange={(e) => setForm({ ...form, accessLoggingEnabled: e.target.checked })}
              className="rounded border-zinc-700 bg-zinc-800 text-cyan-500 focus:ring-cyan-500"
            />
            <span className="text-sm text-zinc-300">Log denied access attempts</span>
          </label>

          {form.accessLoggingEnabled && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Retention (days)</label>
              <input
                type="number"
                value={form.accessLogRetentionDays}
                onChange={(e) =>
                  setForm({ ...form, accessLogRetentionDays: Number(e.target.value) })
                }
                min={1}
                max={365}
                className="w-24 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-medium text-zinc-300">Cache</h2>
          <p className="text-xs text-zinc-500">
            Gatekeeper caches auth decisions for 30 seconds. Bust the cache to immediately apply
            grant changes.
          </p>
          <button
            type="button"
            onClick={() => bustMutation.mutate()}
            disabled={bustMutation.isPending}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-zinc-700 rounded text-zinc-300 hover:text-cyan-400 hover:border-cyan-600"
          >
            <RefreshCw className={`w-4 h-4 ${bustMutation.isPending ? 'animate-spin' : ''}`} />
            {bustMutation.isSuccess ? 'Cache cleared' : 'Bust Cache'}
          </button>
        </div>

        {apiError && <p className="text-sm text-red-400">{apiError}</p>}

        <button
          type="submit"
          disabled={saveMutation.isPending}
          className="px-4 py-2 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded disabled:opacity-50"
        >
          {saveMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : saved ? (
            'Saved'
          ) : (
            'Save Settings'
          )}
        </button>
      </form>
    </div>
  );
}
