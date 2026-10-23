import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from './Toast.jsx';
import CopyableId from './CopyableId.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import {
  WEB_SURFACE_ACCESS_MODES,
  accessModeText,
  createBlock,
  explainWebSurfaceRefusal,
  moveBlock,
  servedText,
  subdomainProblem,
} from '../lib/web-surface.js';

/**
 * Refetch what creating, moving or deleting a web surface changes: the
 * surface itself, the sites (it owns one), the tunnels (a move disables and
 * unbinds one), its hooks and the plugin list.
 */
function invalidateWebSurface(queryClient, name) {
  queryClient.invalidateQueries({ queryKey: ['plugin-web-surface', name] });
  queryClient.invalidateQueries({ queryKey: ['sites'] });
  queryClient.invalidateQueries({ queryKey: ['tunnels'] });
  queryClient.invalidateQueries({ queryKey: ['plugin-hooks', name] });
  queryClient.invalidateQueries({ queryKey: ['plugins'] });
  // A restricted tunnel's grants are copied to the site; a deleted site's go.
  queryClient.invalidateQueries({ queryKey: ['gatekeeper-grants'] });
}

function SectionTitle({ children }) {
  return <p className="mb-1.5 text-zinc-500">{children}</p>;
}

/** A refusal shown under the action it refused: the panel's message and what lifts it. */
function RefusalNote({ error }) {
  if (!error) return null;
  const { message, hint } = explainWebSurfaceRefusal(error);
  return (
    <div className="mt-2 flex items-start gap-1.5 text-red-400">
      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
      <span>
        {message}
        {hint && <span className="block text-zinc-400">{hint}</span>}
      </span>
    </div>
  );
}

/** What the installed version declares, the site, whether it is served. */
function StatusSection({ view }) {
  const served = servedText(view);
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-zinc-500">declared</dt>
        <dd className="text-zinc-300">
          {view.declared ? (
            <>
              subdomain <span className="font-mono">{view.declared.defaultSubdomain}</span>,{' '}
              {view.declared.accessMode}, shell from{' '}
              <span className="font-mono">{view.declared.root}</span>
            </>
          ) : (
            <span className="text-zinc-500">
              nothing — the installed version declares no web surface
            </span>
          )}
        </dd>
        <dt className="text-zinc-500">site</dt>
        <dd className="text-zinc-300">
          {view.site ? (
            <>
              <a
                href={`https://${view.site.fqdn}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
              >
                {view.site.fqdn}
                <ExternalLink size={11} />
              </a>
              <span className="text-zinc-500">
                {' '}
                · {accessModeText(view.site.accessMode ?? 'authenticated')}
              </span>
            </>
          ) : (
            <span className="text-zinc-500">none</span>
          )}
        </dd>
        {view.boundTunnel && (
          <>
            <dt className="text-zinc-500">bound tunnel</dt>
            <dd className="text-zinc-300">
              <span className="font-mono">{view.boundTunnel.fqdn ?? view.boundTunnel.id}</span>
              <span className="text-zinc-500"> — serves its user surface today</span>
            </dd>
          </>
        )}
      </dl>
      <p
        className={`flex items-start gap-1.5 ${served.served ? 'text-green-400' : 'text-yellow-400'}`}
      >
        {served.served ? (
          <Check size={12} className="mt-0.5 shrink-0" />
        ) : (
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        )}
        {served.text}
      </p>
    </div>
  );
}

/** The trees the relay holds: the approved one, the one it serves, the one before. */
function TreesSection({ tree }) {
  const servingApproved = tree.approved !== null && tree.current === tree.approved;
  return (
    <div>
      <SectionTitle>Web trees on the relay:</SectionTitle>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-zinc-500">approved</dt>
        <dd>
          <CopyableId id={tree.approved} missing="The installed version declares no web tree" />
        </dd>
        <dt className="text-zinc-500">served</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <CopyableId id={tree.current} missing="No tree is served yet" />
          {tree.current && !servingApproved && tree.approved && (
            <span className="text-yellow-400">not the approved one yet</span>
          )}
        </dd>
        <dt className="text-zinc-500">previous</dt>
        <dd>
          <CopyableId
            id={tree.previous}
            missing="None — kept as the fallback once a second tree is served"
          />
        </dd>
      </dl>
    </div>
  );
}

/** Give the plugin its site: the offered subdomain and access mode, both editable. */
function CreateSection({ plugin, view }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const offer = view.offer;
  const [subdomain, setSubdomain] = useState(offer?.subdomain ?? '');
  const [accessMode, setAccessMode] = useState(offer?.accessMode ?? 'authenticated');
  const edited = offer ? subdomain !== offer.subdomain : true;
  const blocked = createBlock(view, { edited });
  const problem = subdomainProblem(subdomain);

  const create = useMutation({
    mutationFn: () =>
      client.createPluginWebSurface(plugin.name, {
        // The declared values are the panel's defaults: send only what differs.
        ...(offer && subdomain === offer.subdomain ? {} : { subdomain }),
        ...(offer && accessMode === offer.accessMode ? {} : { accessMode }),
      }),
    onSuccess: (data) => {
      invalidateWebSurface(queryClient, plugin.name);
      addToast(
        `${plugin.name}: web surface created on ${data.webSurface?.site?.fqdn ?? subdomain}`,
      );
    },
    // The refusal stays under the form, with what lifts it.
    onError: () => invalidateWebSurface(queryClient, plugin.name),
  });

  return (
    <div>
      <SectionTitle>Create its web surface:</SectionTitle>
      <p className="mb-2 text-zinc-400">
        Lamaste issues a certificate for the hostname and creates a site the plugin owns: it serves
        the approved shell from the plugin’s server package and its user-surface API on one host,
        behind one sign-in. The site answers 503 until the surface is served.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">subdomain</span>
          <input
            type="text"
            value={subdomain}
            onChange={(e) => setSubdomain(e.target.value.trim().toLowerCase())}
            disabled={create.isPending}
            spellCheck={false}
            className="w-48 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-zinc-200 focus:border-cyan-400 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">access</span>
          <select
            value={accessMode}
            onChange={(e) => setAccessMode(e.target.value)}
            disabled={create.isPending}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200 focus:border-cyan-400 focus:outline-none"
          >
            {WEB_SURFACE_ACCESS_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={create.isPending || blocked !== null || problem !== null}
          onClick={() => create.mutate()}
          title={blocked ?? problem ?? undefined}
          className="flex items-center gap-1.5 rounded bg-cyan-600 px-2.5 py-1 text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          {create.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          Create web surface
        </button>
      </div>
      <p className="mt-1 text-zinc-500">{accessModeText(accessMode)}</p>
      {(blocked || (problem && subdomain !== '')) && (
        <p className="mt-1 text-yellow-400">{blocked ?? problem}</p>
      )}
      <RefusalNote error={create.error} />
    </div>
  );
}

/** Hand the bound tunnel's hostname to the web surface, in one reload. */
function MoveSection({ plugin, view }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [confirming, setConfirming] = useState(false);
  const tunnel = view.boundTunnel;
  const blocked = moveBlock(view, plugin.route);
  const fqdn = tunnel.fqdn ?? tunnel.id;

  const move = useMutation({
    mutationFn: () => client.movePluginWebSurface(plugin.name, tunnel.id),
    onSuccess: () => {
      setConfirming(false);
      invalidateWebSurface(queryClient, plugin.name);
      addToast(`${plugin.name}: ${fqdn} now serves its web surface`);
    },
    // The refusal stays under the button, with what lifts it.
    onError: () => {
      setConfirming(false);
      invalidateWebSurface(queryClient, plugin.name);
    },
  });

  return (
    <div>
      <SectionTitle>Move from its tunnel:</SectionTitle>
      <p className="mb-2 text-zinc-400">
        Tunnel <span className="font-mono text-zinc-300">{fqdn}</span> serves its user surface
        today. Moving hands that hostname to a site the plugin owns in one nginx reload: the shell
        is then served from the approved tree on the relay, the API as before. The tunnel stays,
        disabled and unbound, for a rollback by hand; a restricted tunnel’s grants are copied to the
        site.
      </p>
      {confirming ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-zinc-300">Move {fqdn} to the web surface?</span>
          <button
            type="button"
            disabled={move.isPending}
            onClick={() => move.mutate()}
            className="flex items-center gap-1.5 rounded bg-cyan-600 px-2.5 py-1 text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {move.isPending && <Loader2 size={11} className="animate-spin" />}
            Move
          </button>
          <button
            type="button"
            disabled={move.isPending}
            onClick={() => setConfirming(false)}
            className="rounded bg-zinc-700 px-2.5 py-1 text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={blocked !== null}
          onClick={() => setConfirming(true)}
          title={blocked ?? undefined}
          className="flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1 text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
        >
          <ArrowRightLeft size={11} /> Move from tunnel {fqdn}
        </button>
      )}
      {blocked && <p className="mt-1 text-yellow-400">{blocked}</p>}
      <RefusalNote error={move.error} />
    </div>
  );
}

/** Delete the site, its trees and the grants on it, behind typing its hostname. */
function DeleteSection({ plugin, view }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const fqdn = view.site.fqdn;

  const cancel = () => {
    setConfirming(false);
    setTyped('');
  };

  const remove = useMutation({
    mutationFn: () => client.deletePluginWebSurface(plugin.name),
    onSuccess: () => {
      cancel();
      invalidateWebSurface(queryClient, plugin.name);
      addToast(`${plugin.name}: web surface on ${fqdn} deleted`);
    },
    // The refusal stays under the form, with what lifts it.
    onError: () => invalidateWebSurface(queryClient, plugin.name),
  });

  return (
    <div>
      {confirming ? (
        <div className="space-y-2 rounded border border-red-500/30 p-2">
          <p className="text-zinc-300">
            Deleting removes the site <span className="font-mono">{fqdn}</span>, the web trees the
            relay keeps for it and every grant on the site. The plugin stays installed and hosted;
            its users reach it again only once it is given a site or a tunnel.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-zinc-500">
              Type <span className="font-mono text-zinc-300">{fqdn}</span> to confirm
            </span>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={remove.isPending}
              spellCheck={false}
              autoComplete="off"
              className="w-72 max-w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-zinc-200 focus:border-red-400 focus:outline-none"
            />
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={remove.isPending || typed !== fqdn}
              onClick={() => remove.mutate()}
              className="flex items-center gap-1.5 rounded bg-red-600 px-2.5 py-1 text-white hover:bg-red-500 disabled:opacity-50"
            >
              {remove.isPending ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Trash2 size={11} />
              )}
              Delete web surface
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={cancel}
              className="rounded bg-zinc-700 px-2.5 py-1 text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          <RefusalNote error={remove.error} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1 text-red-400 hover:bg-red-600/20 hover:text-red-300"
        >
          <Trash2 size={11} /> Delete web surface
        </button>
      )}
    </div>
  );
}

/**
 * The *Web surface* of an agent-hosted plugin: what its installed version
 * declares (`userSurface.web`), the site it owns and whether that site
 * serves the shell and the API (and why not), the web trees the relay
 * holds, and the actions — create the site on the offered subdomain, move
 * the hostname of the tunnel bound as its user surface, delete the site.
 */
export default function PluginWebSurface({ plugin }) {
  const client = useAdminClient();
  const [open, setOpen] = useState(false);
  // A host whose client predates web surfaces shows nothing rather than failing.
  const supported = typeof client.getPluginWebSurface === 'function';
  const query = useQuery({
    queryKey: ['plugin-web-surface', plugin.name],
    queryFn: () => client.getPluginWebSurface(plugin.name),
    enabled: supported,
    refetchInterval: open ? 10000 : 60000,
  });
  if (!supported) return null;
  if (query.isError) {
    return (
      <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 mb-4 text-xs text-red-400">
        Web surface: {errorMessage(query.error)}
      </div>
    );
  }
  const view = query.data?.webSurface;
  if (!view || (!view.declared && !view.site)) return null;
  const served = servedText(view);

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 mb-4 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2 text-left"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Globe size={12} className="text-cyan-400" />
        <span className="text-zinc-300 font-medium">Web surface</span>
        {view.site ? (
          <span className="font-mono text-zinc-400">{view.site.fqdn}</span>
        ) : (
          <span className="text-zinc-500">no site</span>
        )}
        {view.site &&
          (served.served ? (
            <span className="inline-flex items-center gap-1 text-green-400">
              <Check size={11} /> served
            </span>
          ) : (
            <span className="text-yellow-400" title={served.text}>
              {view.reason?.replace(/_/g, ' ') ?? 'not served'}
            </span>
          ))}
        {!view.site && view.boundTunnel && (
          <span className="text-zinc-500">served by tunnel {view.boundTunnel.fqdn}</span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          <StatusSection view={view} />
          <TreesSection tree={view.tree} />
          {!view.site && view.boundTunnel && <MoveSection plugin={plugin} view={view} />}
          {!view.site && view.declared && (
            <CreateSection
              // A fresh form when the offer changes (another subdomain freed or taken).
              key={`${view.offer?.subdomain ?? ''}:${view.offer?.accessMode ?? ''}`}
              plugin={plugin}
              view={view}
            />
          )}
          {view.site && <DeleteSection plugin={plugin} view={view} />}
        </div>
      )}
    </div>
  );
}
