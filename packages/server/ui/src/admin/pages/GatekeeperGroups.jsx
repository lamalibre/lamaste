import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { Shield, Plus, Trash2, Users, UserPlus, UserMinus, Loader2 } from 'lucide-react';
import { errorMessage } from '../lib/errorMessage.js';

function CreateGroupModal({ onClose }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [apiError, setApiError] = useState(null);

  const mutation = useMutation({
    mutationFn: (data) => client.createGatekeeperGroup(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gatekeeper-groups'] });
      onClose();
    },
    onError: (err) => setApiError(errorMessage(err)),
  });

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();
      setApiError(null);
      if (!name.trim()) return;
      mutation.mutate({ name: name.trim(), description: description.trim() });
    },
    [name, description, mutation],
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold text-zinc-100 mb-4">Create Group</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., developers"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
              autoFocus
            />
            <p className="text-xs text-zinc-500 mt-1">
              Lowercase letters, numbers, hyphens. 2-63 chars.
            </p>
          </div>
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
            />
          </div>
          {apiError && <p className="text-sm text-red-400">{apiError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || !name.trim()}
              className="px-4 py-2 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded disabled:opacity-50"
            >
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddMembersModal({ groupName, currentMembers, onClose }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [apiError, setApiError] = useState(null);

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => client.getUsers(),
  });

  const mutation = useMutation({
    mutationFn: (usernames) => client.addGatekeeperGroupMembers(groupName, { usernames }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gatekeeper-groups'] });
      onClose();
    },
    onError: (err) => setApiError(errorMessage(err)),
  });

  const availableUsers = (usersQuery.data?.users || [])
    .filter((u) => !currentMembers.includes(u.username))
    .map((u) => u.username);

  const handleAdd = useCallback(
    (username) => {
      setApiError(null);
      mutation.mutate([username]);
    },
    [mutation],
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold text-zinc-100 mb-4">Add Members to {groupName}</h2>
        {apiError && <p className="text-sm text-red-400 mb-2">{apiError}</p>}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {availableUsers.length === 0 ? (
            <p className="text-sm text-zinc-500">All users are already members.</p>
          ) : (
            availableUsers
              .filter((u) => !input || u.includes(input.toLowerCase()))
              .map((username) => (
                <div
                  key={username}
                  className="flex items-center justify-between p-2 bg-zinc-800 rounded"
                >
                  <span className="text-sm text-zinc-200">{username}</span>
                  <button
                    onClick={() => handleAdd(username)}
                    disabled={mutation.isPending}
                    className="text-xs text-cyan-400 hover:text-cyan-300"
                  >
                    Add
                  </button>
                </div>
              ))
          )}
        </div>
        <div className="mt-4">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Filter users..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
          />
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GatekeeperGroupsPage() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [addMembersGroup, setAddMembersGroup] = useState(null);

  const groupsQuery = useQuery({
    queryKey: ['gatekeeper-groups'],
    queryFn: () => client.getGatekeeperGroups(),
    refetchInterval: 10_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (name) => client.deleteGatekeeperGroup(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gatekeeper-groups'] }),
  });

  const removeMemberMutation = useMutation({
    mutationFn: ({ name, username }) => client.removeGatekeeperGroupMember(name, username),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gatekeeper-groups'] }),
  });

  const groups = groupsQuery.data?.groups || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-cyan-400" />
          <h1 className="text-xl font-semibold text-zinc-100">Access Groups</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded"
        >
          <Plus className="w-4 h-4" /> Create Group
        </button>
      </div>

      <p className="text-sm text-zinc-500">
        Lamaste access control groups. Assign users to groups, then grant groups access to tunnels
        and plugins.
      </p>

      {groupsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center text-zinc-500">
          No groups yet. Create one to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.name} className="bg-zinc-900 border border-zinc-800 rounded-lg">
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-zinc-800/50"
                onClick={() => setExpandedGroup(expandedGroup === group.name ? null : group.name)}
              >
                <div className="flex items-center gap-3">
                  <Users className="w-4 h-4 text-zinc-500" />
                  <div>
                    <div className="text-sm font-medium text-zinc-100">{group.name}</div>
                    {group.description && (
                      <div className="text-xs text-zinc-500">{group.description}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-500">
                    {group.members?.length || 0} members
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        confirm(`Delete group "${group.name}"? This will revoke all its grants.`)
                      ) {
                        deleteMutation.mutate(group.name);
                      }
                    }}
                    className="text-zinc-500 hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {expandedGroup === group.name && (
                <div className="border-t border-zinc-800 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-zinc-400 uppercase tracking-wider">Members</span>
                    <button
                      onClick={() => setAddMembersGroup(group)}
                      className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
                    >
                      <UserPlus className="w-3 h-3" /> Add
                    </button>
                  </div>
                  {(group.members || []).length === 0 ? (
                    <p className="text-xs text-zinc-600">No members yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {group.members.map((member) => (
                        <span
                          key={member}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-zinc-800 rounded text-xs text-zinc-300"
                        >
                          {member}
                          <button
                            onClick={() =>
                              removeMemberMutation.mutate({ name: group.name, username: member })
                            }
                            className="text-zinc-500 hover:text-red-400"
                          >
                            <UserMinus className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateGroupModal onClose={() => setShowCreate(false)} />}
      {addMembersGroup && (
        <AddMembersModal
          groupName={addMembersGroup.name}
          currentMembers={addMembersGroup.members || []}
          onClose={() => setAddMembersGroup(null)}
        />
      )}
    </div>
  );
}
